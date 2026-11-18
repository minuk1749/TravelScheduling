# ADR 0007: T12 동선 생성 파이프라인, 재조회 루프와 저장

## 결정

- 진입점은 인증된 `POST /api/trips/{id}/itinerary`다. [HTTP 처리기](../../src/itineraries/http.ts)가
  동일 출처와 `authorizeTrip`(401/403/404)을 먼저 확인하고, 그 뒤에만 이동시간 제공자를 만든다.
  응답이 끝나면 제공자를 `dispose()`한다. `OK / OVER_CAPACITY / CONFLICT`는 모두 200 본문의 `status`다.
- [일정 서비스](../../src/services/itinerary/index.ts)는 포트(`ItineraryRepository`, `CityProfileSource`,
  `PlaceProvider`의 details/location, `TravelTimeProvider`)만 생성자로 받는다. 순서:
  1. 저장소가 입력 스냅샷과 `inputHash`를 읽는다. 누락 필드는 `INCOMPLETE`(409).
  2. [날짜별 앵커](../../src/services/itinerary/day-plan.ts): 첫날 공항 → 숙소(짐 맡김) → 일정,
     마지막 날 일정 → 숙소(짐 찾음) → 공항(`VIA_LODGING`) 또는 일정 → 공항(`DIRECT_TO_AIRPORT`, 공항행 구간은
     짐 구간). 숙소 없는 당일 여행은 공항에서 시작·종료한다. 숙박일 누락, `[DINNER]` 같은 끼니 집합,
     날짜 없는 고정 시각, DST로 존재하지 않는 고정 시각은 `ItineraryInputError`(409 + fields)다.
  3. 장소는 계산 1회당 장소별 1회 조회한다. 방문 장소는 details(여행 날짜의 영업시간), 공항·숙소는 좌표 캐시.
  4. 공항 이동: 도착은 입국 버퍼가 끝나는 instant로 구간 조회, 출발은 체크인 마감 instant에서 거꾸로
     조회하여 조회한 출발 시각의 소요시간이 확보한 시간 안에 들어올 때까지(최대 4회) 반복한다. 짐 구간이므로
     `selectTravelMode(..., { luggage: true })`로 고른다. 허용 수단이 없으면 `transferIssues`와 `CONFLICT`.
  5. 비행일에는 항공 제약 때문에 식사 시간창이 없거나 식사 시간보다 짧은 끼니를 `skippedMeals`로 빼고 충돌로
     보지 않는다. 비행이 없는 날의 같은 상황은 사용자 설정 충돌로 남긴다.
  6. 날짜별로 시간창 시작 instant의 대표 행렬(TRANSIT/WALK/DRIVE)을 조회해 `RouteOptions`로 바꾼다.
     초→분, DRIVE→TAXI(도시 프로필로 출발 instant의 택시 요금 추정), WALK 요금 0, 다른 통화의 대중교통 요금은 null.
  7. [재조회 루프](../../src/services/itinerary/verification.ts): `checkCapacity` → 결과 일정(OK는 전체, 초과는
     추천 일정)의 구간 중 실제 출발 시각으로 조회되지 않은 것을 `route()`로 조회 → 그 날짜·구간의 경로를
     실제 값으로 바꿔 3–6단계를 다시 실행(영업시간·시간창 재검사). 모든 구간이 자기 출발 시각으로 조회된
     값이면 검증 완료. 같은 (구간, 출발 시각) 조회는 한 계산 안에서 한 번만 제공자에 보낸다.
  8. [비교·효율](../../src/services/itinerary/efficiency.ts): 구간마다 대중교통·도보·택시(호출 대기 포함)의
     시간·요금, 같은 구간의 “대중교통·도보만” 선택(`NEVER` 정책 규칙 재사용), 여행 전체 합계. 미상 요금이
     하나라도 있으면 그 합계는 null이다. `CONFLICT`에는 비교·효율이 없다.
- 시도 상한 `MAX_ROUTE_ATTEMPTS = 8`. 같은 미검증 구간 집합이 반복되면 즉시 멈춘다. 상한에 도달하거나 반복으로
  멈춘 결과는 `verification.verified = false`, 최종 `status = CONFLICT`이며 OK로 저장하지 않는다.
- 저장: [저장소](../../src/repositories/itineraries.ts)가 `trips` 행을 `FOR UPDATE`로 잠그고 같은 트랜잭션에서
  입력을 다시 읽어 해시를 비교한다. 다르면 `STALE`(409)이며 아무것도 쓰지 않는다. 같으면 `itineraries`
  (상태, 원래 요청의 미배치, 효율 요약, `details` JSONB: 시간 요약·이슈·추천 ID·검증·공항 이동)와, 검증된
  일정이 있을 때(OK는 `FULL`, 초과는 `RECOMMENDATION`) `day_plans`/`stops`/`legs`를 집합 INSERT 3회로 쓴다.
  [005 마이그레이션](../../migrations/005_itinerary_details.sql)이 필요한 열과 FK 인덱스를 추가한다.

## 이유

- 대표 시각 행렬은 순서 결정용이고, 실제 출발 시각의 소요시간이 달라지면 영업시간·시간창 위반이 생길 수 있다.
  재조회 값을 입력에 반영하고 순수 스케줄러를 다시 실행하면 검사 규칙이 한 곳(스케줄러)에만 있다.
- 일부 구간만 실제 값으로 바뀌면 배치 휴리스틱이 방문을 다른 날로 옮길 수 있어 몇 라운드가 필요하다.
  도쿄 샘플 픽스처([서비스 테스트](../../tests/itinerary-service.test.ts))에서 정상 일정은 5라운드, 초과 일정은
  3라운드에 검증되었고 한 라운드는 수십 ms다. 8은 샘플보다 여유가 있으면서 외부 호출(라운드당 미검증 구간 수 이하)을 제한한다.
- 트립 행 잠금과 잠금 안의 해시 재계산은 버전 열 없이도 “계산 중 입력 변경”을 확실히 감지한다.
  `trips.updated_at`은 자식 행 수정으로 바뀌지 않아(ADR 0004) 판단 근거로 쓸 수 없다.
- 비행일의 기본 끼니(예: 18시 출발일의 저녁)를 충돌로 보면 거의 모든 여행이 `CONFLICT`가 된다.

## 대안

- 재조회 결과로 시각만 다시 계산하고 재배치하지 않기: 영업시간 위반을 고칠 수 없어 기각.
- 오차 허용(예: ±5분)으로 검증 완료 판정: 라운드는 줄지만 “실제 출발 시각으로 재조회” 요구와 어긋나 보류.
- 입력 버전 열(`trips.input_version`) 추가: 모든 입력 쓰기 경로가 버전을 올려야 해 T11과 결합도가 커져 보류.
- 비행일 끼니도 충돌로 유지: 사용자가 매번 끼니를 고쳐야 하므로 기각. 슬롯별 명시 설정은 T11/T13에서 검토.
