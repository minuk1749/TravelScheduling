# 아키텍처

기준: 2026-11-19, T13A 시작 시 원격 `develop`의 `f0b4239`.
[요구사항](requirements.md)의 확정/추천/미정 구분은 그대로 유지한다.
T1–T13/T12B의 현재 연결과 T13A 정리를 기술한다. §7–8은 T7A 당시의 점검 기록이며,
현재 결과 UI와 전체 점검은 §9–10, 공유는 §11, 최종 점검(T15A, 기준 `ee500de`)은 §12를 따른다. 구조나 계약 변경은 관련 문서와 결정 기록을 함께 갱신한다.

## 1. 폴더 구조와 모듈 경계

```text
src/
  app/                         현재: App Router, 홈/manifest, 서버 액션
    api/auth/[...nextauth]/     현재: Auth.js HTTP 진입점
    api/trips/[id]/             현재: 소유권 확인 후 { id }만 반환
    api/trips/[id]/itinerary/   현재 T12: 인증·소유권 확인 후 동선 생성 POST
    trips/[id]/result/          현재 T13: 지도·타임라인·비교·제약 편집
    api/trips/[id]/constraints/ 현재 T13: 제약 GET/PUT
    trips/[id]/settings/        현재 T11: 생활 설정·시간창/고정 시각 충돌 미리보기
    api/trips/[id]/settings/    현재 T11: 소유자 설정 GET/PUT
    trips/new/                  현재 T10: 여행·항공·숙소·장소 입력
    api/trips/                  현재 T10: 인증된 생성 POST
    api/city-profiles/          현재 T10: 인증된 프로필 GET
    api/places/                 현재 T8: 인증된 한국어 검색·상세·좌표 조회
  components/service-worker.tsx  현재: 프로덕션 서비스워커 등록
  auth.ts                      현재: Google 공급자, JWT/세션 콜백 구성
  lib/
    http.ts                    현재 T13A: private/no-store JSON·Origin 공통 정책. T15A: isCrossSiteRequest
    db.ts                      현재: 명시적 PostgreSQL Pool 팩터리
    migrations.ts              현재 T8A: 적용 이력·기존 DB 검증·트랜잭션 실행기
    auth/                      현재: 인증 포트/콜백, 권한, SQL 저장소
  scheduler/
    index.ts                   현재: 시간창·식사 슬롯, 공개 export
    placement.ts               현재: 고정/필수 배치, 지리적 순서, 삽입·2-opt
    placement-types.ts         현재 T13A: 배치 입출력 계약
    route-evaluation.ts        현재 T13A: 단일 경로의 시간·수단·고정 순서 평가
    transport.ts               현재: 정책·수동 지정에 따른 이동수단 선택
    capacity.ts                현재: 실제 배치 기반 수용량·추천 검증
  fare/index.ts                현재: 도시 프로필 타입, 순수 택시 요금 계산
  places/                      현재 T8: 장소 포트·좌표 캐시·Google 어댑터·HTTP 처리
  travel-time/                 현재 T9: 이동시간 포트·선택적 캐시·Google 어댑터·서버 팩터리
  trips/                       현재 T10: 공유 입력 검증·HTTP 처리·서버 팩터리
  repositories/                현재 T10/T11: 여행 생성·장소 ID 저장·프로필 조회·생활 설정 수정. T12: 입력 스냅샷(trip-snapshot.ts), 일정 저장(itineraries.ts). T15A: details 형식(itinerary-details.ts)
  services/itinerary/           현재 T12: 날짜별 앵커·시간창 조립, 장소·이동시간 조회, 재조회 루프, 비교·효율 요약
  itineraries/                 현재 T12: 동선 생성 HTTP 처리(http.ts)와 조립(server.ts)
  settings/                    현재: 설정 검증·계산·서비스·HTTP·조립, model.ts에 저장소 포트
  results/                     현재 T13: 제약 DTO·검증·표시 변환·HTTP·조립
  repositories/living-settings.ts 현재 T11: 설정 읽기·잠금/revision/원자적 수정
migrations/                    현재: 001 인증 → 002 여행 → 003 심야 시간대 → 004 DB 기반 정비 → 005 일정 저장 필드 → 006 구간 고정
public/                        현재: 온라인 전용 sw.js, 아이콘
tests/                         현재: node:test + tsx, SQL/HTTP/순수 함수 검사
scripts/verify-pwa.mjs          현재: 빌드 산출물 검사
scripts/migrate.ts              현재 T8A: npm run migrate 진입점
docs/decisions/                설계 결정과 대안
```

| 경계 | 책임과 허용 의존성 | 경계 밖의 일 |
|---|---|---|
| `src/app`, `src/auth.ts` | 세션 확인, 입력 검증, HTTP/화면 변환, 서버 서비스 호출 | 스케줄링 알고리즘, 브라우저에서 DB/비밀 키 접근 |
| 인증 코어 | [AuthStore](../src/lib/auth/callbacks.ts)와 `authorizeTrip` 콜백에만 의존 | Google/SQL 구현을 콜백에 직접 결합 |
| `src/scheduler` | 호출자가 제공한 시간창·행렬만 계산. 런타임 의존성은 내부 모듈과 Temporal | DB, fetch, 공급자 호출, 환경 변수, 현재 시각·난수 읽기 |
| `src/fare` | 프로필·거리·주행시간·출발 instant·시간대에서 추정 요금 산출 | 요금표 조사, DB 조회, 환율 조회 |
| 일정 서비스 (T12) | 저장소/제공자 포트 주입, 좌표·영업시간 조회, 순수 함수 호출 순서, 재검증 | HTTP 객체를 코어에 전달, 고정 제약의 임의 해제, SQL |
| 제공자 | 외부 응답/단위 정규화, 캐시, 네트워크 실패 구분 | 정책에 맞는 이동수단 선택, 사용자 입력 변경 |
| 저장소 | SQL, 트랜잭션, 행→도메인 변환, 소유 데이터 연쇄 삭제 | 스케줄러 실행, 외부 API 호출 |

배치 계약의 `CityProfile`/시간창 참조는 **type import**다. 런타임에는
`index → capacity → placement → route-evaluation → transport`와
`index → placement/transport`가 연결된다. `placement-types.ts`의 타입 참조는 런타임 의존이 아니다. 전역 가변 캐시를 코어에 넣지 않는다.
`ReadonlyMap`/readonly 배열 입력을 바꾸지 않고 결과를 새로 반환한다.

현재 SQL 구현은 [auth/store.ts](../src/lib/auth/store.ts)에 있다. 새 저장소는 같은 `pg` 풀을
주입받는 방식으로 추가하고 기존 인증 저장소 이동은 별도 작업에서 필요할 때 결정한다.
풀은 서버 프로세스에서 재사용하고 종료 시 닫는다. 빌드·모듈 import 시 연결하지 않는다.

## 2. 데이터 흐름

현재 연결된 실행 흐름은 `홈/서버 액션 → Auth.js → 인증 저장소 → PostgreSQL`,
`GET /api/trips/[id] → auth → authorizeTrip → tripOwner → { id }`,
`GET /api/places → auth → PlaceProvider → Google/좌표 캐시`,
`/trips/new → POST /api/trips → auth → parseTripDraft → tripInputRepository → PostgreSQL`,
`GET /api/city-profiles → auth → cityProfileRepository`,
`POST /api/trips/[id]/itinerary → auth → authorizeTrip → ItineraryService → 저장소·장소·이동시간 포트 → 스케줄러·요금 → 저장`이다.
T11 생활 설정은 `/trips/[id]/settings → GET/PUT /api/trips/[id]/settings → LivingSettingsService → LivingSettingsRepository`로 연결한다. 공용 계산은 기존 calculateDayWindow를 호출한다. 설정 저장 뒤 전체 동선은 T12 생성 API를 다시 호출해 계산하며, 화면 연결은 T13이다.

아래는 T8–T13의 전체 흐름이다(화면 부분은 T13). 화살표는 데이터 이동이며 호출 주체는 API의 서비스다.

```mermaid
flowchart TD
  UI[입력 화면: 여행·장소·제약] --> API[API: 인증·소유권·입력 검증]
  API --> S[일정 서비스]
  S <--> DB[저장소 / PostgreSQL]
  S <--> P[장소 제공자 / 캐시]
  S <--> T[이동시간 제공자 / 대표 시각 행렬]
  T --> F[요금 계산: DRIVE → TAXI 추정]
  F --> I[입력 조립: 시간창·행렬·제약]
  P --> I
  DB --> I
  I --> C[순수 스케줄러: 시간창 → 수용량·배치]
  C --> R[서비스: 실제 출발 시각 재조회·요금 재계산]
  R -->|제약 위반: 갱신한 입력| C
  R --> O[효율 요약·트랜잭션 저장]
  O --> A[API 응답: 정상 / 초과 / 충돌]
  A --> V[화면: 타임라인·지도·비교·필수 재선택]
  V -->|입력 제약 변경| UI
```

1. 서버가 사용자와 여행 소유자를 확인한다. 클라이언트의 `ownerId`, 비용, 계산 결과는 신뢰하지 않는다.
2. 여행 기본값과 날짜별 덮어쓰기를 조합하고 장소 캐시의 유효성을 확인한다. 미완성 T2 여행은
   누락 필드를 알려 입력 완료를 요청한다. 임의 도시·시간대를 넣지 않는다.
3. 날짜별 대표 출발 instant로 방향성 이동 행렬을 조회한다(제공자 한도 100개를 넘으면 나눠 요청해 병합).
   공항↔숙소 경유·짐 처리 시간을 합산해 `calculateDayWindow`에 전달한다. 공항 이동은 일일 행렬 경로와
   중복 차감하지 않는다. 출국 이동이 체크인 마감 준수로 확인되지 않거나(`transferIssues`), 같은 날
   입국 완료가 출국 이동 시작 마감보다 늦으면(`flightConflicts`) 방문 유무와 무관하게 `CONFLICT`다.
4. DRIVE의 거리와 **주행시간**으로 택시 요금을 계산한 뒤 `RouteOptions.TAXI`로 바꾼다.
   호출 대기 버퍼는 `selectTravelMode`가 시간에 한 번 더한다. 모든 비교 비용은 같은 현지 통화다.
5. `checkCapacity`가 내부에서 `scheduleVisits`를 반복 실행한다. 단계 3의 판정은 단계 4–6의
   실제 배치 성공에 근거한다. 희망 장소는 고정한 경우에만 배치한다.
6. T12 서비스가 선택된 구간을 실제 출발 instant로 재조회하고 요금·영업시간·시간창을 다시 검사한다.
   위반 시 고정 제약을 유지한 입력으로 재배치한다. 시도 상한(`MAX_ROUTE_ATTEMPTS` = 8)과 같은
   미검증 구간 집합의 반복 탐지로 종료한다. 상한 근거와 루프 설계는 [ADR 0008 동선 생성](decisions/0008-itinerary-generation.md)에 있다.
   검증되지 않은 일정은 `CONFLICT`로 보고하며 `OK`로 저장하지 않는다.
7. 대중교통 기준과 정책 적용 결과의 이동시간·요금을 집계한다. 미상 요금은 0으로 합산하지 않는다.
   입력 해시와 결과를 함께 저장하고 API에서 JSON으로 직렬화한다.
8. 초과 시 원래 요청의 실패 진단, 검증된 추천 조합, 희망 장소를 구분해서 표시한다.
   선택 변경은 `REQUIRED`/`WISH` 및 고정 제약을 다시 저장하고 같은 파이프라인을 실행한다.

서비스가 I/O를 수행하며 스케줄러가 이동시간/요금 제공자를 호출하는 역방향 의존은 없다.
상세 판단 근거는 [ADR 0001](decisions/0001-pure-core-and-service-boundaries.md)에 있다.

## 3. 현재 핵심 인터페이스

실제 정의는 [scheduler/index.ts](../src/scheduler/index.ts),
[placement.ts](../src/scheduler/placement.ts), [capacity.ts](../src/scheduler/capacity.ts),
[transport.ts](../src/scheduler/transport.ts), [fare/index.ts](../src/fare/index.ts)를 따른다.
이 문서의 TypeScript 블록은 한 모듈로 합쳐 실제 export와 함께 strict 타입 검사한다.

```typescript
import {
  calculateDayWindow, checkCapacity, scheduleVisits, selectTravelMode,
  type DayWindowInput, type DayWindowResult, type MealSlot, type MealWindows,
  type TimeWindow, type ScheduleInput, type ScheduleResult, type CapacityResult,
  type Visit, type TaxiPolicy, type RouteOptions,
} from '../src/scheduler';
import { estimateTaxiFare, type CityProfile } from '../src/fare';

export const schedulerContract: {
  calculateDayWindow(input: DayWindowInput): DayWindowResult;
  scheduleVisits(input: ScheduleInput): ScheduleResult;
  checkCapacity(input: ScheduleInput): CapacityResult;
  selectTravelMode: typeof selectTravelMode;
} = { calculateDayWindow, scheduleVisits, checkCapacity, selectTravelMode };

export interface FareProvider {
  estimateTaxiFare: typeof estimateTaxiFare;
}
export const fareProvider: FareProvider = { estimateTaxiFare };
```

| 입력/출력 | 계약 |
|---|---|
| `DayWindowInput` | 현지 `date`, IANA `timeZone`, 같은 날의 활동 `HH:mm` 구간, `mealCount` 0–3, 선택적 식사창·도착/출발 항공 제약. `travelMinutes`는 숙소 경유/짐 처리까지 포함한 전체 공항 이동시간 |
| `DayWindowResult` | `timeZone`, UTC instant 시간창 `available` 또는 null, `{slot, window|null}[]`, 공항 이동의 시간과 `viaLodging` |
| `ScheduleInput.days` | 날짜, 시간창 결과, 시작·종료 location ID, 방향성 `ReadonlyMap<from, ReadonlyMap<to, RouteOptions>>`, 날짜/방향별 수동 수단·짐 플래그 |
| `ScheduleInput.visits` | 고유 방문 ID, 장소 ID, 좌표, 체류 분, `REQUIRED/WISH`, 선택적 날짜·instant·0부터 세는 방문 순서 고정, 여행 전체의 영업 instant 창 |
| 나머지 `ScheduleInput` | 슬롯별 식사 소요 분, `NEVER/WHEN_NEEDED/PREFER`, 선택적 호출 버퍼·분당 추가비용 기준 |
| `RouteOptions` | `TRANSIT/WALK/TAXI`별 선택적 `{minutes, fare:number|null}`. 수단 없음은 경로 없음, `fare:null`은 요금만 미상. TAXI minutes에는 호출 대기가 아직 없음 |
| `ScheduleResult` | 날짜·IANA 시간대, `VISIT/MEAL` stops, 선택 수단·사용자 고정 여부·요금·instant가 있는 legs, 미배치 ID/사유/고정 여부, 날짜별 issues |
| `CapacityResult` | `OK/OVER_CAPACITY`이면 검증된 `recommendation`, `CONFLICT`이면 null. 원래 요청의 실패 `unplaced/issues`, 가용 분·체류/식사 분·이동/전체 필요시간 하한 |
| `CapacityRecommendation` | `requiredCount` N, `requiredVisitIds`, 실제 재배치한 `schedule`. 고정 필수는 N에 포함, 고정 희망은 제외. 최대해 보장은 아님 |
| `estimateTaxiFare` | `(CityProfile|null|undefined, distanceKm, durationMinutes, departure:Date, timeZone) → TaxiFareEstimate`. 출처·갱신일·통화·`estimated:true` 또는 `UNAVAILABLE/정보 없음` |

고정 순서는 식사를 제외한 방문 위치다. `openingHours` 생략은 미상, `[]`는 방문 불가다.
식사는 직전 위치에서 슬롯 시간을 확보하며 식당 방문과 자동 결합하지 않는다. 직접 고른
이동수단은 택시 정책보다 우선한다. 그 수단이 없으면 대체하지 않고 경로 없음으로 진단한다.
`CONFLICT`는 휴리스틱이 유효한 조합을 찾지 못했다는 뜻이지 불가능성의 수학적 증명이 아니다.
시간 하한만으로 수용 여부를 판단하지 않는다. 다른 N개 조합도 반드시 재검증한다.
[T7 인계](t7-handoff.md)의 추천 재현 방식은 유지한다.

## 4. 현재 제공자와 저장소 계약

장소와 이동시간 포트는 **T8/T9 구현**을 직접 참조하며 저장소는 **T10–T13 구현**을 따른다.
외부 SDK 타입, `pg` 행, Next.js `Request`를 이 경계 너머로 넘기지 않는다.

```typescript
// T8: 구현과 문서가 같은 계약을 사용한다. location은 캐시 가능한 좌표 조회다.
export type {
  PlaceProvider, PlaceSearchRequest, PlaceDetailsRequest, PlaceSummary, PlaceDetails, PlaceLocation,
} from '../src/places';

export type {
  Money, Location, ProviderMode, TravelEstimate, TravelAlternatives,
  TravelRequest, MatrixRequest, RouteRequest, TravelMatrix, TravelTimeProvider,
} from '../src/travel-time';
```

장소 검색은 한국어 요청이며 이름의 한국어 표기가 없는 경우를 허용한다. 내부 `Location.id`는
`places.id`, 방문 ID는 `trip_places.id`, 외부 조회 키는 `google_place_id`다. ID를 혼용하지 않는다.
영업정보 미상은 생략하고, 닫힌 날짜에는 빈 창을 반환한다. null 상세는 장소 없음이다.
외부 장애/쿼터 초과를 null 또는 빈 경로로 숨기지 않는다. DRIVE 요금은 null이며 택시 추정은
FareProvider가 맡는다. 대중교통 요금이 없으면 null을 유지한다.

T8 장소 캐시는 `google:v1:{googlePlaceId}:id,location` 키로 좌표만 기본 24시간 보관한다.
같은 프로세스의 유효 좌표 재조회는 외부 호출이 없고, 동시 요청도 한 번으로 합친다.
이름·유형·영업시간·검색 결과는 저장하지 않으며 상세 응답은 즉시 만료다. 따라서 전체 상세
반복 조회는 외부 호출이 발생한다. 최신 약관 근거, T8 완료 기준 해석의 차이와 저장소 계약
조정은 [ADR 0003](decisions/0003-places-cache-policy.md)에 기록했다. 장소 ID와 Google 상세의
수명을 분리하며 기존 places의 상세 열을 이 프록시에서 채우지 않는다.

API는 `GET /api/places?query=도쿄&regionCode=JP`,
`GET /api/places/{id}?timeZone=Asia/Tokyo&date=2026-11-23`(date 반복 가능),
`GET /api/places/{id}?fields=location`이다. 한국어만 요청하며 인증 전에는 제공자를 만들지 않는다.
응답은 `{places, attribution}` 또는 `{place, attribution}`이며 공급자 attribution도 전달한다.
세부 통합과 UI 표시 책임은 [T8 인계](t8-handoff.md)를 따른다.

T9 [이동시간 제공자](../src/travel-time/index.ts)는 기존 matrix/route 계약을 구현한다.
`matrix`는 고유 장소 ID(최대 100개)의 방향성 행렬이며 대각선도 Google 응답을 따른다.
`GoogleTravelTimeProvider`는 `computeRouteMatrix`를 TRANSIT 10×10, WALK/DRIVE 25×25로
분할하고 응답 인덱스로 복원한다. 수단별 경로 없음은 해당 키 생략, 요금 없음은 null이다.
TRANSIT 요금의 units/nanos를 통화와 함께 숫자로 변환하고 WALK/DRIVE 요금은 null이다.
`route`는 행렬 응답 대신 `computeRoutes`를 사용한다. TRANSIT에 정확한 출발 instant를 전달하며
실시간 교통 제외 요구에 따라 DRIVE는 `TRAFFIC_UNAWARE`를 사용한다. WALK/DRIVE 외부 요청에는
출발 시각을 보내지 않는다. 서비스 요청에는 항상 IANA 시간대와 오프셋 있는 instant가 필요하다.
주행시간에 택시 호출 대기를 추가하지 않는다. 초→분, 미터→km 및 DRIVE→TAXI 변환은 T12 책임이다.

[캐시](../src/travel-time/cache.ts)는 인스턴스별로 요청 종류/정규화한 instant/시간대/모드/방향/ID/좌표를
키에 담고, 명시적으로 TTL을 설정했을 때만 완료 응답을 보관한다(최대 24시간, 기본 32개 요청).
행렬 장소와 모드 순서만 정규화하며 시각·좌표를 반올림하지 않는다. 만료 타이머·용량 초과로
삭제하고 오류는 보관하지 않는다. 동시 요청은 합치되 반환 결과는 복제하며 dispose 후 재사용할 수 없다.
행렬과 구간 캐시는 서로 재사용하지 않아 재조회 의미를 보존한다.

Google 기본 [서버 팩터리](../src/travel-time/server.ts)는 `GOOGLE_ROUTES_API_KEY`를 호출 시 읽고
완료 응답 캐시를 끈다. Google의 시간·거리·요금 보관 허용을 확인하지 못했기 때문이다.
같은 진행 중 요청만 합치고 완료 후 순차 반복에는 외부 호출이 있다. 따라서 T9의 반복 호출 0회
기준은 캐시 허용 제공자에 대해서만 자동 검증되며 Google 기본 연결에서는 **미충족/사람 확인 필요**다.
근거와 대안은 [ADR 0005](decisions/0005-travel-time-provider-and-cache.md), 통합 책임과 테스트는
[T9 인계](t9-handoff.md)에 기록했다. 장소 좌표 캐시 정책을 Routes 응답에 확대하지 않는다.
새 공개 HTTP 엔드포인트는 없으며 T12가 인증·소유권 검증 뒤 제공자를 생성한다.

```typescript
// T12: 일정 서비스의 포트와 데이터 계약. 구현과 문서가 같은 export를 사용한다.
export type {
  PlaceRef, TripInputs, TripLoad, ItineraryResult, LegComparison, EfficiencySummary, RouteAlternatives,
  ItineraryRepository, CityProfileSource, ItineraryPlaces, ItineraryDependencies, GenerateOutcome, SaveOutcome,
} from '../src/services/itinerary';
export { ItineraryService, ItineraryInputError, MAX_ROUTE_ATTEMPTS, MEAL_MINUTES } from '../src/services/itinerary';
```

위 저장소 계약은 서버 내부에서만 사용한다. [입력 스냅샷](../src/repositories/trip-snapshot.ts)은
SQL time·JSONB·`WISHLIST`를 검증·변환하고 누락 필드를 `INCOMPLETE`로 돌려준다(초가 0이 아닌 시각도 포함).
행 순서를 고정해 같은 입력은 같은 SHA-256 `inputHash`를 갖는다. `TripInputs`의 장소는 `places.id`와
Google ID를 함께 갖는 `PlaceRef`이며 ownerId는 담지 않는다(소유권은 HTTP 처리기가 먼저 확인한다).
[일정 저장](../src/repositories/itineraries.ts)은 `trips` 행을 `FOR UPDATE`로 잠근 뒤 같은 트랜잭션에서
입력 해시를 다시 계산하고, 다르면 아무것도 쓰지 않고 `STALE`을 반환한다. T11 [생활 설정 저장소](../src/repositories/living-settings.ts)도
같은 `trips` 행을 `FOR UPDATE`로 잠그므로 설정 수정과 일정 저장이 직렬화된다. 상세는 [ADR 0008 동선 생성](decisions/0008-itinerary-generation.md).
T7A의 전체 상세 PlaceRepository 계약은 ADR 0003에 따라 철회했다. 장소 ID 영구 저장은 T10 생성 저장소에서 연결한다.

T10 현재 생성 DTO·한도·기본값·프로필 추천은 [ADR 0006](decisions/0006-trip-input-creation.md)에 기록한다.
[TripDraft 검증기](../src/trips/input.ts)는 클라이언트 단계 검사와 서버 전체 검사에 공용이며,
[HTTP 처리기](../src/trips/http.ts)는 인증·JSON·동일 출처·필드 오류를 확인한다.
[여행 생성 저장소](../src/repositories/trip-inputs.ts)는 세션 ownerId만 받아 트랜잭션으로 저장한다.
[프로필 저장소](../src/repositories/city-profiles.ts)는 SQL numeric/time/JSONB를 정규화한다.
이 생성 계약과 별개로 loadInputs/saveItinerary는 T12 저장소가 구현하며, 기존 여행 수정(saveInputs)은 T11 범위다.
UI는 Google Maps와 제공자 attribution을 표시하며 외부 링크는 http/https만 허용한다.
입력 이름과 검색 결과는 화면 메모리에만 존재한다. 새로고침 시 미저장 입력 복구는 제공하지 않는다.

### T11 생활 설정 계약

[ADR 0007](decisions/0007-living-settings.md)에 설정 상속·동시 편집·재계산 범위를 기록한다.
[타입](../src/settings/model.ts)의 `LivingSettings`는 기본 시각·식사 슬롯/시간대·택시 정책과
날짜별 nullable 덮어쓰기다. `GET/PUT /api/trips/[id]/settings`는 세션 소유권을 확인한다.
PUT은 `{ revision, settings }`, 응답은 `{ snapshot, calculation }`이다.
[서비스](../src/settings/service.ts)는 [공유 검증](../src/settings/input.ts)과
[계산](../src/settings/calculate.ts)을 호출하고 [저장소](../src/repositories/living-settings.ts)가
여행 행 잠금 뒤 소유권·revision을 다시 검사해 기본값/날짜별 행만 원자적으로 저장한다.
기존 고정 방문과 결과는 수정하지 않는다. 읽기는 repeatable read 스냅샷이다.
날짜별 0끼와 null 상속은 구별하며 기존 날짜 행의 created_at은 유지한다.

`calculation.scope = TIME_WINDOWS`: 활동/식사창과 항공 버퍼, 고정 시각·체류시간의
시간창 충돌만 검사한다. 공항 이동은 0분으로 두며 실제 이동·영업시간·고정 순서·수단·식사
배치와 택시 정책별 경로 재선택은 이 미리보기에 포함되지 않는다. T13에서는 저장 후
T12 생성 API를 호출해 전체 동선도 검증하며, 화면에서 두 검증의 범위를 구분한다(§9).
서버 저장 실패 시 UI는 초안을 보존하고 재시도한다. 변경된 입력은 409로 거부하며 사용자가
명시적으로 다시 불러온다. 전체 itinerary input_hash는 이 설정 revision과 별도로 계산해야 한다.
검증/후속 연결은 [T11 인계](t11-handoff.md)에 기록한다.

## 5. 저장 형식·시간대 변환

결정 근거: [ADR 0002](decisions/0002-time-storage-and-error-contracts.md),
[ADR 0004](decisions/0004-database-migrations-and-timestamps.md).
스키마 원본은 [001](../migrations/001_auth.sql), [002](../migrations/002_travel_model.sql),
[003](../migrations/003_city_profile_night_hours.sql), [004](../migrations/004_database_foundations.sql) 순서다.
`DATABASE_URL`을 설정하고 `npm run migrate`로 준비한다. [실행기](../src/lib/migrations.ts)는
`schema_migrations(version, checksum, applied_at, origin)`과 SQL 파일의 SHA-256을 대조하여
미적용 파일만 순서대로 실행한다. 이력 없는 기존 DB는 001/001–002/001–003 중 어느 스키마인지
검증용 임시 스키마의 열·타입·기본값·제약조건과 비교해 기존 이력을 등록한다. 임시 스키마는
롤백하고 사용자 데이터는 그대로 둔다. 부분 적용·불일치 상태는 실패시키며 이력을 추측하지 않는다.
이관 시 DB `CREATE` 권한과 앱 쓰기 중지가 필요하다. 정상 이력 이후에는 임시 스키마가 필요 없다.
현재 스키마에 대한 트랜잭션 advisory lock으로 동시 실행을 직렬화하고, 한 실행의 모든 SQL과
이력을 함께 커밋하거나 롤백한다. SQL 파일 자체에 트랜잭션 제어를 넣지 않는다.
테스트와 CI는 동일 실행기로 격리 스키마를 준비하며 [통합 테스트](../tests/migrations.test.ts)는 CLI도 실행한다.

모든 사용자 소유 테이블(`users`, `trips`, `day_settings`, `flights`, `lodgings`, `trip_places`,
`itineraries`, `day_plans`, `stops`, `legs`)에 `created_at/updated_at timestamptz NOT NULL DEFAULT now()`가 있다.
사용자의 기존 생성 시각은 유지하고, 과거 시각이 없는 행은 이관 시각으로 채운다. 사용자 소유 테이블과
공유 `places`의 `updated_at`은 `BEFORE UPDATE` 트리거가 `statement_timestamp()`로 갱신한다.
동일 값 UPDATE와 UPSERT도 갱신하며 자식 수정이 부모 시각을 바꾸지는 않는다. 따라서 `trips.updated_at`만으로
입력 버전이나 stale 여부를 판단하지 않는다. `city_profiles.updated_at`은 요금 출처의 갱신일로 계속 호출자가 관리한다.
모든 FK 열은 기존 PK/UNIQUE 또는 새 인덱스의 첫 열로 포함되며 [카탈로그 검사](../tests/database-foundations.test.ts)가 검증한다.

최신 일정은 `itineraries.generation bigint GENERATED ALWAYS AS IDENTITY`의 가장 큰 값이다.
`SELECT ... FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1`을 사용하며
`(trip_id, generation DESC)` 고유 인덱스로 지원한다. 생성 시각이 같아도 INSERT 순서를 구별하고
과거 결과·하위 행을 지우지 않는다. 기존 행의 번호는 과거 생성 순서 복원이 아니며, 새 결과부터 순서가 보장된다.
이는 INSERT 순서이지 트랜잭션 커밋 순서가 아니다. T12는 같은 여행의 저장을 잠금으로 직렬화하고
입력 해시 재검증을 함께 구현해야 한다. 생성 번호는 입력 버전이나 일정의 정상 상태를 뜻하지 않는다.

| DB/외부 표현 | 코어 입력으로 변환하는 책임 |
|---|---|
| `date`, `time`, `flights.local_datetime` (timestamp without time zone) | 저장소는 현지 달력 문자열로 읽는다. 호스트 로컬 `Date`로 재해석하지 않는다. 서비스가 Trip의 IANA 시간대로 instant 변환 |
| `timestamptz`, `updated_at`, `cache_expires_at` | 오프셋 있는 ISO instant. 요금 함수에만 `Date`로 전달 |
| PostgreSQL numeric | 저장소에서 유한·비음수 숫자로 검증. `pg`의 기본 numeric 문자열을 그대로 산술에 쓰지 않음 |
| PostgreSQL time `22:00:00` | 분 단위 설정은 `22:00`으로 정규화. 초가 0이 아니면 조용히 자르지 않고 입력 오류 |
| DB 우선순위 `WISHLIST` | 코어 `WISH`로 양방향 명시 변환. SQL enum을 바로 `Visit`로 단언하지 않음 |
| `fixed_date` + `fixed_time` | 여행 시간대에서 `fixedStart` instant로 변환. 날짜 없이 시각만 저장된 행은 입력 보완 필요 |
| 날짜별 null 설정 | 여행 기본값 상속. `meal_slots: []`는 끼니 없음이며 null과 다름 |
| `meal_slots`, `meal_windows` JSONB | 슬롯 집합과 `{start,end}` 검증. 현재 SQL 테스트의 `["11:30","14:00"]` 형태도 변환 필요 |
| 슬롯 집합 → T5의 `mealCount` | `[]/[LUNCH]/[LUNCH,DINNER]/[BREAKFAST,LUNCH,DINNER]`만 수로 직접 변환 가능. `[DINNER]` 등을 길이만 세어 점심으로 바꾸지 않음. 변환 규칙은 scheduler의 `mealCountForSlots` 하나이며 T11 `countForSlots`(거부 시 RangeError)와 T12 일정 생성(필드 오류)이 함께 쓴다. 임의 조합은 거부 |
| `stops`/`legs` SQL | T12의 [005](../migrations/005_itinerary_details.sql)가 stop 종류·식사 슬롯, leg 양 끝점·출발/도착 instant·요금, 일정 `details` JSONB를 추가. 사용자 구간 이동수단 고정 입력은 T13에서 보완 |

시간은 여행의 IANA 시간대를 항상 함께 전달한다. 현지 입력은 `Temporal`의
`disambiguation: 'reject'`로 변환해 DST에서 존재하지 않거나 두 번 나타나는 시각을 거부한다.
고정 시작·영업시간·행렬 출발은 오프셋 있는 instant다. 산술과 수용량은 실제 경과시간 기준이며
하루를 무조건 24시간으로 계산하지 않는다. 활동/식사창은 같은 현지 날짜의 `[start,end)`로,
자정을 넘기는 활동창은 현재 지원하지 않는다. 종료 시각에 딱 맞게 끝나는 방문/이동은 허용한다.

기본 항공 버퍼는 입국 90분, 출국 150분이다. 가용 시간 교집합이 없으면 null로 반환한다.
공항 이동시간과 버퍼는 비음수 정수 분, 방문/경로 시간은 비음수 유한 분이며 배치 시 ms로
올림한다. 요금의 심야 구간은 현지 출발 시각에서 시작 포함/끝 제외로 평가하고 자정 통과를 지원한다.
화면은 원래 시간대로 다시 표시한다. 시스템 시간대를 도쿄나 서울로 가정하지 않는다.

사용자 삭제는 `users → trips → day_settings/flights/lodgings/trip_places/itineraries →
day_plans → stops/legs`의 FK cascade로 실행한다. 공유 장소 캐시와 도시 프로필은 사용자
소유 데이터가 아니므로 남는다. 세션은 매 요청 사용자 존재 여부를 확인한다.

## 6. 오류 처리와 API 경계

| 상황 | 현재 동작 | 후속 API 처리 계약 |
|---|---|---|
| 로그인 없음/타인 소유/여행 없음 | `authorizeTrip`: 401/403/404. 현재 GET은 공통 한국어 오류 메시지 | 같은 상태 유지, 서버 액션도 소유권 확인 |
| 잘못된 시각·기간·숫자/중복 방문 ID | 순수 함수에서 `RangeError` 등 발생. T10 생성 입력은 공유 검증기로 400 + 필드 오류 반환 | 입력 검증 단계에서 400 + 필드별 오류. 모든 내부 예외를 400으로 일괄 변환하지 않음 |
| 여행 입력 미완성/계산 중 변경 | T12: 누락 필드·일정으로 만들 수 없는 입력은 409 + `fields`, 저장 시 입력 변경은 409 재생성 안내 | 같은 상태 유지 |
| `OK/OVER_CAPACITY/CONFLICT` | 정상적인 도메인 결과. `OVER_CAPACITY`에도 유효 추천 있음 | 계산 요청의 200 응답 본문에 상태를 유지. 고정 충돌을 임의 수정하지 않음 |
| `unplaced.TIME_WINDOW/UNREACHABLE/FIXED_ORDER` | 방문 ID에 연결된 실패 원인. `WISH`는 오류가 아닌 의도적 미배치 | 원래 실패와 추천에서 제외된 목록을 구분 |
| `issues.MEAL_UNAVAILABLE/UNREACHABLE/TIME_WINDOW` | 식사 슬롯/연결 실패/일일 경로의 시간창 실패. 마지막 것은 T7A 추가 | 날짜별 진단으로 표시. 방문 없는 숙소 이동 초과도 `CONFLICT` |
| 요금 없음 | null 또는 `TaxiFareEstimate.UNAVAILABLE` | 이동 가능 여부와 분리하고 정보 없음 표시 |
| 외부 API 장애·쿼터/DB 장애 | T8: 제공자 실패 503, 잘못된 외부 응답 502, 내부 실패 500. T9: TravelProviderError의 UNAVAILABLE/INVALID_RESPONSE. T12 동선 생성: 장소·이동시간 장애를 503/502, 입력 오류를 400, 내부 오류를 500으로 변환 | 비밀 값·SQL·공급자 원문을 응답에 노출하지 않음 |

가용 시간도 없고 시작/종료가 같은 빈 날은 이동이 필요 없어 빈 일정이 가능하다.
시작/종료가 다르면 이동을 생략해 성공으로 처리할 수 없다. 진단은 해당 휴리스틱 시도의
실패이며 최소 충돌 집합을 보장하지 않는다. T9의 TravelInputError는 입력 오류이며
TravelProviderError는 외부 장애다. 누락·중복 행렬 요소, 잘못된 단위/요금은 INVALID_RESPONSE,
HTTP/네트워크/행렬 요소의 nonzero status는 UNAVAILABLE로 실패한다. 부분 성공을 반환하지 않는다.
T12는 캐시 만료/네트워크 실패를 영업 종료나 이동 불가와 섞지 않는다.

## 7. T1–T7 코드와 문서 차이 점검

전체 T1–T7 소스·마이그레이션·기존 테스트를 기준으로 점검했다. 아래의 후속 항목은
새 요구사항이나 T7A 완료 구현으로 간주하지 않는다. README는 T1 시점 설명이 남아 있으므로
아래 현재 상태와 소스 링크가 기술 구조의 기준이다.

| 작업 | 코드/문서 차이 또는 결함 | T7A 처리와 후속 담당 | 검증 |
|---|---|---|---|
| T1 | README의 정적 홈·T2/T3 예정 설명은 현재 인증/스키마와 다름. DB 테스트가 읽기 전용이라는 설명도 오래됨 | 현재 구조를 이 문서와 README에 정정. 테스트는 격리 스키마를 만들고 지움 | [PWA](../tests/pwa.test.ts), [SW](../tests/service-worker.test.ts), [DB](../tests/db.test.ts) |
| T2 | 다른 사용자 403은 순수 권한 함수 검사. 실제 Google OAuth 브라우저 흐름은 미검증 | 현재 보장 범위를 명시. 실제 로그인·로그아웃은 사람 확인 | [인증](../tests/auth.test.ts) |
| T2/T3 | 탈퇴 SQL 테스트에서 flights/lodgings/trip_places/stops 삭제 검증 누락 | 해당 행을 생성하고 모든 소유 테이블 삭제·공유 places 보존을 검사하도록 보강 | [여행 모델](../tests/travel-model.test.ts) |
| T3 | 스키마/SQL 테스트는 있고 여행 저장소·생성/수정 API는 없음. GET은 `{id}`만 반환 | 후속 저장소 계약 정의, T10/T12 구현. 기존 T2 nullable 여행도 명시적으로 처리 | [SQL 모델](../tests/travel-model.test.ts), 문서 계약 타입 검사 |
| T3/T5/T6 | `WISHLIST/WISH`, 슬롯 집합/mealCount, 현지 time/instant, JSONB 창 모양 불일치. 아직 연결하는 코드 없음 | §5에 명시적 변환과 미완성 입력 처리 규칙 기록. T10–T12 연결 때 회귀 테스트 추가 | [SQL 모델](../tests/travel-model.test.ts), [T5](../tests/scheduler.test.ts), [T6](../tests/scheduler-placement.test.ts) |
| T3/T12/T13 | stop 종류·식사 슬롯, leg 시각/끝점, 사용자 구간 고정 입력, 추천 상세 저장 필드 부족 | 현재 저장 성공으로 주장하지 않음. T12/T13 스키마 보완 범위로 인계 | 스키마 대조, 문서 계약 타입 검사 |
| T4 | 순수 추정/프로필 스키마만 존재. 실제 10개 도시/환율/저장소 없음. SQL numeric/time과 요금 입력 표현이 다름 | 변환 규칙 기록. 실제 요금표 T4D, 제공자 연결·환율/효율 요약 T12에서 구현 | [요금](../tests/fare.test.ts), [심야 SQL](../tests/travel-model.test.ts) |
| T5 | 식사 결과는 예약 시간창이며 식당과 자동 결합하지 않음. 공항 이동은 호출자가 합산 | 기존 가정을 명시하고 T12 입력 조립 책임으로 유지 | [시간창](../tests/scheduler.test.ts) |
| T6 | 대표 시각 행렬만 사용, 실제 출발 시각 재조회·구간 대안·전체 효율 없음 | T9/T12로 인계. 순수 계산에서 외부 호출 금지 | [배치](../tests/scheduler-placement.test.ts), 의존 경계 검사 |
| T6/T7 | 방문 없는 날의 숙소 간 이동이 시간창보다 길어도 실패 진단이 없어 `OK` 추천 | **결함 수정**: 최종 경로 시간창 실패를 issues에 전달. 창이 없는 필수 이동도 충돌. 정확한 경계/경유 성공은 유지 | [수용량](../tests/scheduler-capacity.test.ts)의 `overlong daily transfer`, `no available window` 회귀 |
| T7 | “최대 N”은 최적해가 아닌 검증된 휴리스틱 조합. 시간 합은 하한이며 CONFLICT는 탐색 실패 | 구현 변경 없이 의미를 보존하고 API/화면 계약에 명시 | [수용량](../tests/scheduler-capacity.test.ts)의 재현·같은 N 재선택·성능·입력 불변성 |

폴더 이동, 코어 추상화 재작성, 신규 API/DB 열/패키지 추가는 수행하지 않았다.
이슈 없는 구현을 설계 문서에 맞추기 위한 리팩터링도 하지 않았다.

## 8. 검증과 다음 작업

| T7A 완료 항목 | 자동 검사와 근거 |
|---|---|
| 구조·경계·흐름·핵심 인터페이스·시간대·오류 문서 | [architecture.test.ts](../tests/architecture.test.ts): 문서 구성/실제 소스·테스트·ADR 링크, TypeScript 계약 블록 strict 검사, 코어 의존 경계 |
| 차이 목록과 결함만 수정 | §7에 T1–T7 추적, 수용량 회귀 테스트와 전체 소유 데이터 삭제 SQL 검사. 범위는 diff로도 확인 |
| 주요 결정 기록 | ADR 0001/0002 링크 및 결정·이유·대안의 문서 검사 |
| 기존 동작 보존 | `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` |

Node 24와 PostgreSQL 16을 사용한다. `npm test`는 빌드 이후 실행하고 DB는 환경 변수
`DATABASE_URL`로 받는다. DB 테스트는 연결이 없어도 skip하지 않는다. 실제 API 키 없이
목/픽스처로 테스트하며 외부 연동 확인과 실제 도시 데이터 검토는 사람이 수행한다.
실행 결과·환경 한계·다음 작업 체크포인트는 [T7A 인계](t7a-handoff.md)에 남긴다.

## 9. T13 결과 UI와 제약 저장

이 절은 T11/T12에서 후속 연결로 남겼던 결과 화면·전체 재계산·구간 수동 지정의 현재 구현을 보완한다.

- `/trips/[id]/result`와 [결과 컴포넌트](../src/components/itinerary/index.tsx)가 지도/타임라인/비교/초과 선택을 연결한다.
- [공유 DTO](../src/results/model.ts), [검증](../src/results/input.ts), [표시 변환](../src/results/presentation.ts)은 브라우저/서버 공용이며 DB·네트워크에 의존하지 않는다.
- [결과 서비스](../src/services/itinerary/editing.ts)는 ConstraintRepository와 장소 제공자 포트만 사용한다. [HTTP](../src/results/http.ts)가 인증·소유권·동일 출처·오류를 처리하고 server.ts가 구체 구현을 조립한다.
- [저장소](../src/repositories/itinerary-constraints.ts)는 여행 행 잠금 아래 소유권과 전체 입력 해시를 재검사하고 방문/수단 제약을 원자적으로 저장한다.
- GET `/api/trips/[id]/constraints`는 `{ input, revision, places }`, PUT은 `{ revision, constraints: { visits, legModes } }`를 받고 `{ input, revision }`을 반환한다. revision은 동선 입력 해시다. 누락/중복/다른 여행 ID·기간 밖 날짜·DST 모호 시각을 거부한다.
- 방문 제약은 기존 trip_places에, 구간 제약은 [006](../migrations/006_itinerary_constraints.sql)의 trips.leg_modes에 저장한다. 후자는 날짜·출발/도착 장소 ID·수동 수단 배열이다. 장소 이름/귀속 정보는 실시간 응답에만 포함한다.
- [일상 구간 적용](../src/services/itinerary/constraints.ts)은 기존 짐 속성을 유지하고, 공항 이동은 기존 transfer 선택에 fixedMode를 전달한다. 입력 해시에 수단 제약도 포함된다.
- PUT 성공 뒤 기존 POST `/api/trips/[id]/itinerary`로 재검증한다. POST 응답에 inputHash를 추가해 다른 입력으로 생성된 결과 표시를 막는다. 생성 실패 시 저장한 제약은 유지된다. 화면 재접속은 입력을 복원하고 버튼으로 재생성한다.
- 생활 설정 저장 뒤 [전체 검증](../src/components/living-settings/itinerary-preview.tsx)도 기존 POST를 호출한다. 입력 중 TIME_WINDOWS 미리보기는 전체 검증과 구분한다.
- [지도 어댑터](../src/components/itinerary/google-map.ts)는 브라우저 전용 Maps 키/지도 ID로 고급 마커를 표시한다. 지도 로딩 실패에도 장소 목록에서 편집할 수 있다.

이 결정의 이유·대안·검증은 [T13 ADR](decisions/T13-result-ui-and-constraints.md)에 기록한다. T12B의 날짜별 짐 처리 모듈은 변경하지 않는다.

## 10. T13A 전체 점검과 성능

[전체 점검 목록](t13a-audit.md)에 책임 혼합·중복·순환/경계·변경 지점·불필요 코드와
시작 시 300줄 초과 파일을 모두 기록했다. 동작 보존 정리의 이유와 대안은
[T13A 결정](decisions/T13A-audit-and-fare-preparation.md)을 따른다.

- `scheduler/placement-types.ts`는 타입, `route-evaluation.ts`는 단일 경로 평가,
  `placement.ts`는 배치/개선 탐색이다. `scheduler/index.ts`와 `placement.ts`의 기존 export를 유지한다.
- `fare.createTaxiFareEstimator(profile, departure, timeZone)`는 동일 출발 시각의 요금 준비를
  최초 사용 시 한 번 수행하고, 매 구간의 거리·시간 검증과 금액 계산은 계속 수행한다.
  `FareConverter.table`은 행렬 내에서만 재사용하며 실제 출발 시각 route는 별도 준비한다.
  기존 `estimateTaxiFare` 시그니처/오류/금액은 유지하며 프로세스 전역 상태는 추가하지 않는다.
- `LivingSettingsStore`는 소비자인 `settings/model.ts`에 두고 구현체는 repositories가 제공한다.
  저장소 모듈의 기존 타입 export도 유지해 호출 지점의 호환성을 보존한다.
- `lib/http.ts`는 캐시 금지 JSON과 Origin 비교만 공유한다. 기존 endpoint별 입력 크기,
  Content-Type/Sec-Fetch-Site 검사, 인증 순서와 400/401/403/404/409/500 계약은 바꾸지 않는다.
- 구조 검사: [계층](../tests/architecture-layers.test.ts), [전체 소스 의존 그래프](../tests/helpers/source-graph.ts).
  클라이언트 코드의 전이 의존까지 검사하되 타입 import와 공개 빌드 상수 `NODE_ENV`는 구별한다.
- 성능 회귀: [요금 행렬](../tests/fare-matrix.test.ts). 시간 비율 대신 행렬별 준비 1회와
  단일 변환 동등성을 검사한다. [오프라인 벤치마크](../scripts/benchmark-itinerary.ts)의 전후 중앙값과
  전체 결과 해시는 점검 문서에 남긴다. Google/DB 네트워크 지연을 측정한 결과는 아니다.

HTTP/DB 스키마·수단 선택·추천 탐색·공항 직행일 짐 처리의 기존 동작은 유지한다.

## 11. T14 읽기 전용 공유

- 소유자 POST `/api/trips/[id]/share`는 `{ path: "/share/{token}" }`를 반환한다.
  세션·여행 소유권·동일 출처를 검사하며 재발급은 이전 링크를 무효화한다.
- 공개 GET `/api/share/[token]` → [SharingService](../src/services/sharing.ts) →
  [ShareRepository](../src/sharing/model.ts) → [SQL 구현](../src/repositories/sharing.ts).
  `load`는 입력 스냅샷·결과, 미준비 `UNAVAILABLE`, 잘못된 토큰 `null`을 구분한다.
  표시 입력 축소와 장소 참조 목록은 서비스가 계산한다(T15A).
- 기존 `trips.share_token`에 256비트 난수 토큰의 SHA-256 해시를 저장한다. 스키마 변경은 없다.
  재발급 UPDATE도 owner_id를 검사하고, 장소 조회 후 유효성을 재확인한다.
- [결과 읽기](../src/repositories/shared-itinerary.ts)는 itineraries/day_plans/stops/legs를
  고정 개수 쿼리로 복원한다. REPEATABLE READ 트랜잭션 안에서 입력 해시를 비교하고
  최신 generation만 선택한다. 이전 결과·현재 입력 혼합은 409로 거부한다.
- [표시 정보 조회](../src/services/itinerary/display-places.ts)는 편집·공유 서비스에서 재사용하며
  Google 장소 ID별로 중복 요청을 제거한다. 이름·귀속 정보의 영속 저장은 추가하지 않는다.
- 공개 응답은 `SharedItinerary`의 표시용 `ResultDisplayView`와 계산 결과만 포함한다.
  원본 여행 설정·사용자 정보·revision은 제외한다. 공유 화면은 편집 콜백 없이 기존
  지도·타임라인·효율 표시를 사용하며 기존 수정 API의 인증 계약은 유지한다.
- 잘못된/폐기된 토큰 404, 결과 없음/오래된 입력 409, 외부 장애 502/503, 내부 오류 500.
  API는 private/no-store 및 검색·referrer 차단 헤더, 페이지는 동적 렌더링·동일 메타 정책을 사용한다.
- 검증·대안·제약은 [T14 결정](decisions/T14-read-only-sharing.md)에 기록한다.

## 12. T15A 최종 전체 점검

[최종 점검 목록](t15a-audit.md)에 T13A와 같은 체크리스트·300줄 초과 파일·남은 문제를 기록했다.
이유와 대안은 [T15A 결정](decisions/T15A-final-audit.md)을 따른다. 공개 API·스키마·화면 동작은 바꾸지 않았다.

- [details 형식](../src/repositories/itinerary-details.ts)이 `itineraries.details` JSONB의 타입·인코더·레거시 판정을
  한 곳에서 정의한다. 일정 저장과 공유 결과 읽기가 함께 사용한다.
- `ShareRepository.load`는 `TripInputs`와 결과를 돌려준다. [공유 서비스](../src/services/sharing.ts)가
  `displayInput`으로 공개 입력을 줄이고 `tripPlaceRefs`(편집 서비스와 공용)로 장소 참조를 만든다.
- `lib/http.isCrossSiteRequest`는 설정·공유 쓰기가 이미 하던 Origin + `Sec-Fetch-Site` 검사를 합친 것이다.
  나머지 쓰기 경계의 정책 통일은 [질문](questions.md)의 사람 결정 항목이다.
- [여행 생성](../src/repositories/trip-inputs.ts)은 자식 테이블당 INSERT 1회다. 장소 upsert는 잠금 순서를 위해 정렬된 행별 실행을 유지한다.

## 13. T16 디자인 시스템

- 화면의 시각 규칙은 [디자인 규칙](design.md)을 따르고, 색·글자·간격 토큰은 `src/app/globals.css`의 `:root` 변수 한 곳에 둔다. 컴포넌트·페이지 CSS는 변수만 쓴다.
- 글꼴(`pretendard`)은 빌드 산출물로 자체 호스팅한다. 서비스워커의 온라인 전용 정책은 바꾸지 않는다.
- 데이터 흐름·API·저장 형식은 바꾸지 않는다. 화면 구성 변경은 T17–T20에서 화면별로 하며, 도로 경로 모양(polyline)처럼 새 외부 조회가 필요한 표현은 사람 결정 후 추가한다.
- 이유와 대안은 [T16 결정](decisions/T16-design-system.md)을 따른다.
- 입력 화면(T17)은 `components/form-rows.tsx`의 표시 요소(구역 카드·값 줄·항목 오류)를 쓴다. 검증 규칙·API·흐름은 그대로이며 기본 입력칸을 줄 안에 둔다. 근거는 [T17 결정](decisions/T17-input-screens.md).
- 장소 단계(T18)는 `components/visit-entries.tsx`가 그리고 필수/희망을 아이콘+글자로 표시한다. 장소 검색은 같은 목록의 중복을 표시·경고만 하고 판정은 기존 검증에 둔다. 고정 조건은 결과 화면에서 설정한다. 근거는 [T18 결정](decisions/T18-place-step.md).
