# T9: 이동시간 서비스 인계

## 변경 요약

`src/travel-time`에 공개 타입/포트, 입력 검증, Google Routes 어댑터, 선택적 메모리 캐시와
서버 팩터리를 추가했다. 세 이동수단의 방향성 행렬과 실제 출발 시각의 구간 재조회,
대중교통 요금 추출을 제공한다. 새 패키지·DB 변경·HTTP 엔드포인트는 없다.
보호 파일은 수정하지 않았고 커밋/푸시/PR 생성은 러너에 맡긴다.
PR 제목은 `T9: 이동시간 서비스`, base는 `develop`이다.

## 완료 기준 충족 근거

[tests/travel-time.test.ts](../tests/travel-time.test.ts)는 실제 키 없이 합성 Google 응답으로 검증한다.

| 완료 기준 | 자동 테스트 |
|---|---|
| TRANSIT/WALK/DRIVE 행렬 반환 | `T9 returns directed...`: 방향별 시간/거리와 세 수단, 최소 필드·좌표·한국어 요청. `matrix tiling...`: 26개 장소의 전체 676쌍×3수단, 100/625요소 제한·순서 뒤섞임·타일 인덱스 검증 |
| 대중교통 요금 포함/없으면 null | `T9 returns directed...`, `T9 actual-departure...`, `valid no-route...`: 통화, units/nanos, 요금 미상, 무료 요금, 경로 없음의 구분 |
| 같은 요청 반복 시 추가 외부 호출 0회 | `T9 permitted cache...`: 캐시 허용 구성에서 행렬·구간 순차 반복 및 정규화한 동등 입력 검증. **Google 기본 구성은 미충족**이며 `default Google cache...`가 완료 후 재호출을 검증 |
| 구간 재조회 | `T9 actual-departure...`: 실제 출발 instant 전달. `T9 permitted cache...`와 `cache keys distinguish...`: 행렬을 구간 결과로 오용하지 않음, 출발 시각 1ns 차이도 재조회 |
| 입력·장애·캐시 안전성 | 나머지 테스트: 잘못된 시간대/숫자/중복 ID, 요청 실패·잘못된 JSON/단위/요금·누락/중복 요소, 결과 복제, 동시 호출 병합, 만료·용량·dispose·실패 후 재시도 |

검증 환경은 Node 24.22.3이다(기본 Node 26 대신 `/private/tmp`에 임시 설치해 사용).

| 명령 | 결과 |
|---|---|
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과, PWA 산출물 검증 포함 |
| `npm test` | 총 79개 중 63개 통과, DB 의존 16개 실패, skip 0개. 모든 실패 원인은 `DATABASE_URL must be set to a PostgreSQL connection string` |

T9 테스트 12개와 아키텍처 계약/문서 검사는 모두 통과했다. 로컬 DB 환경을 임의로 바꾸거나
DB 테스트를 건너뛰지 않았다. CI의 PostgreSQL 16과 DATABASE_URL 환경에서 전체 테스트를 재검증해야 한다.

## 남은 이슈 / 가정

- Google 시간·거리·요금 응답 캐시 허용을 확인하지 못해 기본 팩터리는 완료 응답을 보관하지 않는다.
  일반 캐시는 TTL을 명시하면 동작하지만 Google에서 이를 활성화하는 배포 설정은 추가하지 않았다.
  근거/대안은 [ADR 0005](decisions/0005-travel-time-provider-and-cache.md), 질문은 [questions](questions.md).
- TRANSIT만 Google에 출발 시각을 보낸다. DRIVE는 TRAFFIC_UNAWARE이며 WALK와 함께 시간표를 사용하지 않는다.
- Google TRANSIT의 현재 기준 과거 7일/미래 100일 조회 범위를 벗어나면 제공자가 실패할 수 있다.
  이를 근사치나 경로 없음으로 대체하지 않는다. 날짜 입력 안내는 후속 UI/API에서 처리한다.
- 캐시가 활성화된 제공자도 프로세스/인스턴스/만료/용량을 넘어서는 재사용은 보장하지 않는다.

## 사람 확인 필요

- Google 기본 구성의 순차 반복 호출 0회 미충족을 해소할 적용 계약/제공자/완료 기준 해석 결정.
- 실제 제한된 서버 키로 Routes API 활성화·과금/쿼터, 지원 도시의 TRANSIT 요금과 재조회 결과 확인.
- T12/T13에서 Google 표시 출처와 지도 이용 정책을 UI/API에 반영하고 응답 보관 정책을 검토한다.

## 다음 작업자 인계

- T12는 인증·여행 소유권 확인 후 `createGoogleTravelTimeProvider()`를 호출하고 사용 후
  `dispose()`한다. 모듈 import/빌드는 키·네트워크·DB가 필요 없다. 환경 변수는 `GOOGLE_ROUTES_API_KEY`다.
- `matrix({ locations, departure, timeZone, modes })`는 장소 ID 기반 Map의 Map을 반환한다.
  ID는 `places.id`이고 좌표는 호출자가 장소 포트에서 얻는다. 방문 ID/google place ID와 혼용하지 않는다.
- 대표 시각 행렬로 스케줄링한 다음 `route({ from, to, departure: 실제출발, timeZone, modes })`로
  재조회한다. 바뀐 시간/영업시간을 재검증하고 필요하면 제한된 재배치 루프를 수행하는 것은 T12 책임이다.
- 초→분, 미터→km 변환 후 DRIVE의 주행시간/거리로 택시 요금을 추정한다. 호출 버퍼는 기존
  스케줄러에서 한 번만 더한다. WALK 요금 null을 화면의 무료 표시로 바꿀지 서비스에서 명시적으로 결정한다.
- `TravelInputError`는 400, `TravelProviderError.UNAVAILABLE`은 503,
  `INVALID_RESPONSE`는 502로 변환한다. 모드 생략(경로 없음)과 fare null(요금 미상)을 유지한다.
- Google 내용의 영구 일정 저장 허용 여부는 별도로 확인한다. T9는 결과를 DB에 저장하지 않는다.
