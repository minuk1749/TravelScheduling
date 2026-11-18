# 프로젝트 구조 요약

작업 전에 읽는 짧은 지도다. 상세 계약과 데이터 흐름은 [아키텍처](architecture.md), 결정 근거는 [결정 기록](decisions/)에 있다.
모듈을 추가·이동하거나 연결 방식이 바뀌면 **같은 PR에서 이 문서를 갱신**한다. (기준: T13A 시작 시 원격 `develop` f0b4239)

## 기술과 검증 명령

Next.js App Router · TypeScript strict · Node 24 · PostgreSQL 16(`pg`) · Auth.js(Google) · `Temporal`(시간대) · `node:test` + `tsx`

```bash
npm ci                 # 의존성 설치
npm run migrate        # DB 스키마 적용 (DATABASE_URL 필요)
npm run lint           # ESLint
npm run typecheck      # Next 타입 생성 + tsc --noEmit
npm run build          # 빌드 + PWA 산출물 검사 (scripts/verify-pwa.mjs)
npm test               # tests/*.test.ts 전체 (DB 테스트는 DATABASE_URL 필요, PWA 테스트는 build 먼저)
```

CI(`agent-review`)는 PostgreSQL 16에서 `npm ci → lint → typecheck → build → test` 순서로 실행한다.

## 모듈과 책임

| 경로 | 책임 | 의존해도 되는 것 | 의존하면 안 되는 것 |
|---|---|---|---|
| `src/app/` | 화면, 서버 액션, API 라우트(`api/auth`, `api/places`, `api/trips`, `api/trips/[id]/itinerary`). 세션 확인·입력 검증·응답 변환 | 서비스, 각 모듈의 `server.ts`, `auth` | 스케줄링 알고리즘 직접 구현, 브라우저에서 DB·비밀 키 접근 |
| `src/services/itinerary/` | **동선 생성 서비스(T12).** 날짜별 앵커·짐 구간(`day-plan.ts`), 시간창·자정을 넘는 공항 이동 반영·행렬(`days.ts`), 공항 이동 조회(`transfers.ts`), 장소 조회(`places.ts`), 단위·요금 변환과 구간 조회(`routes.ts`), 실제 출발 시각 재조회 루프(`verification.ts`), 비교·효율 요약(`efficiency.ts`), 포트·결과 타입(`types.ts`) | `scheduler`, `fare`, `places`·`travel-time`의 포트 타입 | SQL, HTTP 객체, 구체 Google 어댑터, 환경 변수 |
| `src/itineraries/` | 동선 생성 HTTP 처리(`http.ts`: 인증·소유권·오류 변환)와 구체 구현 조립(`server.ts`) | 서비스, 저장소, 각 모듈 `server.ts` | 스케줄링 계산 |
| `src/repositories/` | 여행 생성(`trip-inputs.ts`), 도시 프로필, 입력 스냅샷·해시(`trip-snapshot.ts`), 일정 저장(`itineraries.ts`), 생활 설정/제약 읽기·원자적 수정 | `pg`, 서비스 타입 | 스케줄러 실행, 외부 API |
| `src/auth.ts`, `src/lib/auth/` | Google 로그인, 세션, 여행 소유권 확인(`authorizeTrip`), 인증 SQL(`store.ts`) | `lib/db` | 화면 |
| `src/lib/http.ts` | 공통 private/no-store JSON 응답과 Origin 비교 | 표준 Request/Response | DB·인증·도메인 오류 정책 |
| `src/lib/db.ts` | PostgreSQL 연결 풀 팩터리(명시적 생성) | `pg` | 모듈 import 시 연결 |
| `src/lib/migrations.ts`, `scripts/migrate.ts`, `migrations/*.sql` | 스키마 적용과 이력(`schema_migrations`) | `pg` | 앱 실행 경로 |
| `src/scheduler/` | **순수 계산.** 하루 시간창·식사 슬롯(`index.ts`), 방문 배치·순서(`placement.ts`), 배치 계약(`placement-types.ts`), 단일 경로 평가(`route-evaluation.ts`), 이동수단 선택(`transport.ts`), 수용량·추천(`capacity.ts`) | 내부 모듈, `Temporal`, `fare`의 타입 | DB, 네트워크, 환경 변수, 현재 시각·난수 |
| `src/fare/` | **순수 계산.** 도시 프로필 타입, 택시 요금 추정·동일 출발 시각의 준비 재사용 | `Temporal` | DB, 네트워크 |
| `src/places/` | 장소 포트(`index.ts`), Google 어댑터, 좌표 캐시, 입력 검증, 영업시간 변환, HTTP 핸들러, 조립(`server.ts`) | `scheduler` 타입, `auth` | 이름·영업시간 등 상세 저장(약관) |
| `src/travel-time/` | 이동시간 포트(`index.ts`), Google 어댑터, 캐시, 검증, 조립(`server.ts`) | `scheduler` 타입 | 이동수단 선택(스케줄러 책임), 택시 요금 계산(`fare` 책임) |
| `src/components/` | T10 입력·장소 검색·프로필, T11 생활 설정 폼/필드/미리보기 | 브라우저용 검증·계산, HTTP | DB·비밀 키 |
| `src/trips/` | T10 입력 검증·생성 HTTP·서버 조립 | 인증, 여행 생성·도시 프로필 저장소 | 전체 동선 생성 |
| `src/settings/` | 생활 설정 타입/저장소 포트(`model.ts`)·검증·시간창 재계산·서비스·HTTP·서버 조립 | scheduler 공개 함수, 저장소 포트, 인증 | 전체 경로 생성 중복 구현 |
| `tests/` | 순수 함수·SQL·HTTP·구조 검사. `fixtures/`(가짜 외부 응답), `helpers/database.ts` | 모든 모듈 | 실제 Google 키 |

결과 화면(T13)은 아래 T13 연결 절을 따른다.

## 연결 방식

- **계층:** 화면/API → 서비스 → 저장소·제공자(포트) → 순수 코어(`scheduler`, `fare`). 의존은 이 방향으로만 흐른다. 코어가 제공자를 호출하는 역방향 의존은 없다.
- **포트와 어댑터:** 외부 API는 `PlaceProvider`, `TravelTimeProvider` 인터페이스 뒤에 있다. Google 구현과 캐시 구현이 같은 인터페이스를 따르고, 캐시는 실제 제공자를 감싼다(`CachedPlaceProvider(new GooglePlaceProvider(key))`).
- **조립 지점:** 구체 구현을 고르는 곳은 각 모듈의 `server.ts` 하나다. 모듈 import 시점에는 연결·네트워크 작업을 하지 않고, 처음 쓸 때 만든다. 테스트는 같은 인터페이스에 가짜 구현을 넣는다.
- **오류:** 입력 오류(`*InputError`)와 제공자 장애(`*ProviderError`)를 구분한다. 장애를 빈 결과나 null로 숨기지 않는다.
- **시간:** 모든 시각은 IANA 시간대와 함께 다룬다. 현지 날짜·시각 문자열과 오프셋이 있는 instant를 구분한다.
- **생활 설정:** `/trips/[id]/settings` → GET/PUT `/api/trips/[id]/settings` → LivingSettingsService → LivingSettingsRepository. 여행 생성 성공 화면에서 진입한다. 설정 변경 즉시 scheduler의 시간창을 다시 계산하며 고정 시각 충돌을 표시한다. 입력 중 결과는 TIME_WINDOWS이며 저장 후 T12 POST로 전체 동선을 재계산한다.

## 중요한 설계 이유

| 결정 | 이유 | 기록 |
|---|---|---|
| 스케줄러·요금은 순수 함수 | 외부 요인 없이 테스트하고, 동선 재계산 루프에서 같은 입력에 같은 결과를 보장하기 위해 | [ADR 0001](decisions/0001-pure-core-and-service-boundaries.md) |
| 시각 저장·변환 규칙, 오류 계약 | 해외 시간대·서머타임 버그를 원칙으로 차단하기 위해 | [ADR 0002](decisions/0002-time-storage-and-error-contracts.md) |
| 장소는 좌표만 캐시 | Google 약관이 상세 정보 저장을 허용하지 않기 때문 | [ADR 0003](decisions/0003-places-cache-policy.md) |
| 마이그레이션 이력·행 시각 | 스키마 변경이 쌓여도 환경 간 상태가 어긋나지 않게 하기 위해 | [ADR 0004](decisions/0004-database-migrations-and-timestamps.md) |
| 이동시간 제공자와 캐시 | 행렬 한도 분할, 요금 없음/경로 없음 구분, 약관 범위 안의 캐시 | [ADR 0005](decisions/0005-travel-time-provider-and-cache.md) |
| 생활 설정 상속·저장·부분 재계산 | null/0끼 구별, 동시 편집 방지, 전체 동선과 시간창 미리보기 구분 | [ADR 0007 생활 설정](decisions/0007-living-settings.md) |
| 동선 생성 재조회 루프·저장 | 실제 출발 시각 재조회 후 순수 스케줄러 재실행으로 검사 규칙을 한 곳에 두고, 트립 잠금 + 입력 해시로 계산 중 변경을 감지 | [ADR 0008 동선 생성](decisions/0008-itinerary-generation.md) |

`tests/architecture.test.ts`가 코어의 I/O 금지, 아키텍처 문서의 타입 계약과 실제 export 일치, 문서 링크 유효성을 검사한다.

## T13 결과 UI 연결

- 기준: 작업 시작 원격 `develop` fed5c6f. `/trips/[id]/result`와 `src/components/itinerary/`가 지도·타임라인·구간 비교·전체 효율·장소 제약 편집을 제공한다.
- `src/results/`: 공유 DTO·검증·표시 변환과 HTTP/서버 조립. 공유 코드는 DB·네트워크에 의존하지 않는다.
- `src/services/itinerary/editing.ts`: 저장소·장소 포트를 통한 조회/제약 저장. `constraints.ts`: 기존 짐 설정을 유지하면서 구간 수단 고정을 적용한다.
- `src/repositories/itinerary-constraints.ts`: 여행 행 잠금·소유권·입력 해시 검사와 원자적 제약 저장. 006은 `trips.leg_modes`를 추가한다.
- GET/PUT `/api/trips/[id]/constraints` → ResultEditService → ConstraintRepository. 저장 뒤 기존 POST `/api/trips/[id]/itinerary`로 재검증하며 생성 응답의 inputHash를 확인한다. 이름·귀속 정보는 DB에 보관하지 않는다.
- 생활 설정 저장 후에도 T12 POST로 전체 동선을 재계산한다. 입력 중 미리보기는 TIME_WINDOWS로 유지한다.
- 지도는 브라우저 Google Maps 어댑터를 통해 접근한다. 서버 Places/Routes 키를 전달하지 않는다. 상세: [T13 결정](decisions/T13-result-ui-and-constraints.md).

## T13A 전체 점검 후 경계

- 배치 타입·경로 평가를 분리해 `placement.ts`가 300줄 이내이며 기존 scheduler export는 유지한다.
- `FareConverter.table`은 `fare.createTaxiFareEstimator`로 행렬별 출발 instant/시간대 준비를 한 번 수행한다.
  실제 구간 재조회마다 새 estimator를 사용한다. 전역 캐시나 외부 응답 저장은 추가하지 않는다.
- `settings/service`는 `settings/model`의 저장소 포트에 의존한다. 구체 저장소는 server.ts에서 주입한다.
- 5개 HTTP 모듈은 공통 `lib/http` 정책을 사용하며 인증/입력/오류 계약은 각 모듈이 유지한다.
- `tests/architecture-layers.test.ts`는 전체 소스 런타임 순환, 클라이언트의 전이 서버 의존,
  서비스/저장소 경계와 소스 300줄 상한을 검사한다. `fare-matrix.test.ts`는 행렬별 준비 횟수와 동등성을 검사한다.
- 전체 목록·전후 성능·후속 범위: [T13A 점검](t13a-audit.md), [결정](decisions/T13A-audit-and-fare-preparation.md).

## T15 종단 간 시나리오

- `tests/e2e/journey.spec.ts`: 375px 한 세션에서 흐름 1–10(로그인 → 여행 생성 → 생활 설정 → 수용량 초과 → 필수 선택 → 재검증 → 결과·지도·수정 → 공유 → 탈퇴)을 검증한다. 소스(`src/`) 변경 없음.
- **실제 서버·Auth.js 세션·PostgreSQL·서비스를 그대로 쓰고 Google만 대체한다.** 앱 API를 `page.route`로 가로채지 않는다. 화면 입력이 DB에 저장되고(`trips`, `trip_places` 조회로 확인), 설정·제약 변경과 계산·공유가 같은 저장 상태를 읽는다.
  - 서버 쪽: `tests/e2e/support/google-doubles.mjs`를 `NODE_OPTIONS=--import`로 서버에 미리 불러와 `accounts.google.com`/`oauth2.googleapis.com`(OpenID 설정·JWKS·토큰, RS256 id_token), Places, Routes로 가는 `fetch`만 결정적 응답으로 바꾼다. 브라우저 쪽 동의 화면은 `page.route`가 인가 요청을 콜백으로 되돌린다.
  - 지도: `tests/helpers/e2e-maps.ts`가 `google.maps.importLibrary`를 기록용 스텁으로 바꾼다. 실제 `GoogleResultMap`이 만든 마커(이름·배치/희망/미배치 상태)를 읽고 마커 클릭으로 편집 카드를 선택한다. 지도를 그리는 모든 e2e는 이 스텁을 설치한다.
  - `playwright.config.ts`의 webServer는 가짜 `NEXT_PUBLIC_GOOGLE_MAPS_*`를 포함해 다시 빌드한 뒤 `localhost:3210`에서 시작한다(세션 쿠키·Auth.js 리다이렉트 호스트 일치). `TOKYO` 도시 프로필은 테스트가 upsert하고, 테스트 사용자는 시작·종료 때 삭제한다.
- 공용 장소 검색 헬퍼: `tests/helpers/e2e-places.ts`.

## T14 읽기 전용 공유 연결

- `src/sharing/`: 공유 DTO·저장소 포트, 소유자 토큰 재발급/비로그인 조회 HTTP, 서버 조립.
- `src/services/sharing.ts`: 토큰 생성·해시·조회 후 유효성 재검사. 저장소·장소 포트에 의존하며 SQL·HTTP·동선 생성에 의존하지 않는다.
- `src/repositories/sharing.ts`, `shared-itinerary.ts`: 해시 원자적 교체, 일관된 입력·최신 저장 결과 조회와 정규화 일정 복원. 외부 API·스케줄러 실행은 금지한다.
- 결과 화면의 `share-controls.tsx` → 소유자 POST `/api/trips/[id]/share` → SharingService → PostgresShareRepository.
- 공개 `/share/[token]`의 `shared.tsx` → GET `/api/share/[token]` → 저장 결과 조회 → 장소 표시 정보 조회.
- 기존 `trips.share_token`에 SHA-256 해시를 저장한다. 재발급으로 이전 링크를 무효화한다.
- 표시 컴포넌트는 `ResultDisplayView`를 사용하고 편집 콜백이 없으면 수정 UI를 노출하지 않는다.
- `services/itinerary/display-places.ts`는 편집·공유 조회의 실시간 표시 정보 조회를 공유한다.
- 계약과 검증: [T14 결정](decisions/T14-read-only-sharing.md), [아키텍처 §11](architecture.md#11-t14-읽기-전용-공유).
