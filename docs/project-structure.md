# 프로젝트 구조 요약

작업 전에 읽는 짧은 지도다. 상세 계약과 데이터 흐름은 [아키텍처](architecture.md), 결정 근거는 [결정 기록](decisions/)에 있다.
모듈을 추가·이동하거나 연결 방식이 바뀌면 **같은 PR에서 이 문서를 갱신**한다. (기준: T17 시작 원격 `develop` 9512b21; T13A·T15A 점검 기록 유지)

## 기술과 검증 명령

npm workspaces · Next.js App Router · Expo SDK 58/expo-router · TypeScript strict · Node 24 · PostgreSQL 16(`pg`) · Auth.js(Google) · `Temporal`(시간대) · `node:test` + `tsx` · `jest-expo`

```bash
npm ci                 # 의존성 설치
npm run migrate        # DB 스키마 적용 (DATABASE_URL 필요)
npm run lint           # 구현된 모든 워크스페이스 ESLint
npm run typecheck      # 앱·서버 Next 타입 + 공용 strict 타입 검사
npm run build          # 앱 iOS·Android export + 서버/PWA + core·토큰 JS/선언 파일
npm test               # 앱·서버·core·토큰 전체 (DB는 DATABASE_URL 필요, PWA는 build 먼저)
```

CI는 PostgreSQL 16에서 `npm ci → lint → typecheck → build → test` 순서로 실행한다. Claude 작업은 구현·검증·게시를 각각 별도 러너에서 실행한다. 검증 러너가 확인한 Git 커밋을 게시 러너가 같은 번들에서 읽어 PR에 올린다. 자동 작업 PR의 검사와 머지 기록은 [자동 협업 루프](agent-loop.md#리뷰-판정과-머지)를 참고한다.

## 모듈과 책임

| 경로 | 책임 | 의존해도 되는 것 | 의존하면 안 되는 것 |
|---|---|---|---|
| `apps/server/src/app/` | 화면, 서버 액션, API 라우트(`api/auth`, `api/places`, `api/trips`, `api/trips/[id]/itinerary`). 세션 확인·입력 검증·응답 변환 | 서비스, 각 모듈의 `server.ts`, `auth` | 스케줄링 알고리즘 직접 구현, 브라우저에서 DB·비밀 키 접근 |
| `apps/server/src/services/itinerary/` | **동선 생성 서비스(T12).** 날짜별 앵커·짐 구간(`day-plan.ts`), 시간창·자정을 넘는 공항 이동 반영·행렬(`days.ts`), 공항 이동 조회(`transfers.ts`), 장소 조회(`places.ts`), 단위·요금 변환과 구간 조회(`routes.ts`), 실제 출발 시각 재조회 루프(`verification.ts`), 비교·효율 요약(`efficiency.ts`), 포트·결과 타입(`types.ts`) | `scheduler`, `fare`, `places`·`travel-time`의 포트 타입 | SQL, HTTP 객체, 구체 Google 어댑터, 환경 변수 |
| `apps/server/src/itineraries/` | 동선 생성 HTTP 처리(`http.ts`: 인증·소유권·오류 변환)와 구체 구현 조립(`server.ts`) | 서비스, 저장소, 각 모듈 `server.ts` | 스케줄링 계산 |
| `apps/server/src/repositories/` | 여행 생성·소유 목록(`trip-inputs.ts`), 날짜별 설정 쓰기(`day-settings.ts`), 도시 프로필, 입력 스냅샷·해시(`trip-snapshot.ts`), 일정 저장(`itineraries.ts`)과 details 형식(`itinerary-details.ts`), 생활 설정/제약 읽기·원자적 수정 | `pg`, 서비스 타입 | 스케줄러 실행, 외부 API |
| `apps/server/src/auth.ts`, `apps/server/src/lib/auth/` | 웹 Google 로그인(Auth.js, T25까지), 여행 소유권 확인(`authorizeTrip`), 인증 SQL(`store.ts`). **T18:** 포트(`ports.ts`), Google ID 토큰 검증(`google-id-token.ts`), 모바일 세션 발급·폐기(`mobile-sessions.ts`), Bearer/쿠키 요청 인증(`request-authenticator.ts`), 세션 SQL(`session-store.ts`), 조립(`server.ts`: `requestAuthenticator`·`bearerAuthenticator`) | `lib/db`, `lib/opaque-token`, `jose` | 화면, 도메인 서비스 |
| `apps/server/src/sessions/` | T18 `POST`·`DELETE /api/session`, `DELETE /api/account` HTTP(`http.ts`)와 조립(`server.ts`) | `lib/auth`, `lib/http` | SQL 직접 작성 |
| `apps/server/src/lib/http.ts` | 공통 private/no-store JSON 응답, 오류 본문(`apiError`·`accessError`·`providerError`: `{ code, error, fields? }`), Origin 비교, 설정·공유 쓰기용 교차 사이트 검사(`isCrossSiteRequest`) | 표준 Request/Response, core `contracts/errors` 타입 | DB·인증·도메인 오류 정책 |
| `apps/server/src/lib/opaque-token.ts` | 43자 불투명 토큰 생성·형식 검사·SHA-256 해시(공유 링크·모바일 세션 공통) | `node:crypto` | DB |
| `apps/server/src/lib/db.ts` | PostgreSQL 연결 풀 팩터리(명시적 생성) | `pg` | 모듈 import 시 연결 |
| `apps/server/src/lib/migrations.ts`, `apps/server/scripts/migrate.ts`, `apps/server/migrations/*.sql` | 스키마 적용과 이력(`schema_migrations`) | `pg` | 앱 실행 경로 |
| `packages/core/src/scheduler/` | **순수 계산.** 하루 시간창·식사 슬롯(`index.ts`), 방문 배치·순서(`placement.ts`), 배치 계약(`placement-types.ts`), 단일 경로 평가(`route-evaluation.ts`), 이동수단 선택(`transport.ts`), 수용량·추천(`capacity.ts`) | 내부 모듈, `Temporal`, `fare`의 타입 | DB, 네트워크, 환경 변수, 현재 시각·난수 |
| `packages/core/src/fare/` | **순수 계산.** 도시 프로필 타입, 택시 요금 추정·동일 출발 시각의 준비 재사용 | `Temporal` | DB, 네트워크 |
| `apps/server/src/places/` | 장소 포트(`index.ts`), Google 어댑터, 좌표 캐시, 입력 검증, 영업시간 변환, HTTP 핸들러, 조립(`server.ts`) | `scheduler` 타입, `auth` | 이름·영업시간 등 상세 저장(약관) |
| `apps/server/src/travel-time/` | 이동시간 포트(`index.ts`), Google 어댑터, 캐시, 검증, 조립(`server.ts`) | `scheduler` 타입 | 이동수단 선택(스케줄러 책임), 택시 요금 계산(`fare` 책임) |
| `apps/server/src/route-shapes/`, `services/route-shapes.ts` | T19 소유자 경로 모양 HTTP·조립·저장소 포트, 저장 구간별 좌표·모양 조회 서비스 | 인증, 저장소·장소·경로 모양 포트, core DTO | 서비스의 SQL·구체 Google 의존, 모양 저장 |
| `apps/server/src/components/` | T10 입력·장소 검색·프로필, T11 생활 설정 폼/필드/미리보기 | 브라우저용 검증·계산, HTTP | DB·비밀 키 |
| `apps/server/src/trips/` | T10 입력 검증 재내보내기·생성 HTTP·서버 조립 | 인증, 여행 생성·도시 프로필 저장소 | 전체 동선 생성 |
| `apps/server/src/settings/` | 저장소 포트(`model.ts`)·서비스·HTTP·조립, core 설정 DTO·검증·계산 재내보내기 | scheduler 공개 함수, 저장소 포트, 인증 | 전체 경로 생성 중복 구현 |
| `apps/server/tests/`, `packages/core/tests/` | 순수 함수·SQL·HTTP·구조 검사. `fixtures/`(가짜 외부 응답), `helpers/database.ts` | 모든 모듈 | 실제 Google 키 |
| `packages/core/src/contracts/` | 공용 DTO·검증·설정 계산. `trips/`, `settings/`, `results/`, `itinerary.ts`, `places.ts`, `travel-time.ts`, `sharing.ts`, `errors.ts`(T18 오류 `code` 목록) | core 내부, Temporal | 서버 포트, Node·DB·네트워크·React·React Native |
| `packages/core/src/presentation/` | 표시 변환·한국어 라벨 | core DTO, Temporal | 화면 프레임워크·I/O |
| `apps/server/src/scheduler/`, `fare/`와 기존 공용 모듈 경로 | `@travel/core` 재내보내기, 기존 호출 지점 유지 | core의 공개 하위 경로 | 계산·검증 복사본 |
| `apps/mobile/app/`, `src/screens/`, `src/components/`, `src/navigation/` | T20 expo-router 보호 라우트, 로그인·첫 화면·로그아웃, T21 여행 생성·하루 생활·장소 입력(`screens/trip-input/`), T22 결과 화면·시트·재계산 흐름(`screens/result/`), 공통 버튼·상태·전환 | 앱 auth·theme·core 검증, `map/`·`result/`, React Native·Expo | 서버 import, 화면에서 토큰 영속 저장, 지도 SDK 직접 import(어댑터 계약만) |
| `apps/mobile/src/auth/`, `src/api/` | T20 세션 상태·복원·폐기, Google/SecureStore 포트·어댑터, 런타임 조립, Bearer HTTP·401 처리, T21 여행·장소·생활 설정 요청(`trips.ts`), T22 경로 모양 요청·`verifyRevision` | core 오류 계약, Expo SecureStore, 네이티브 Google SDK | 서버 코드 import, 평문 저장소·토큰 로그 |
| `apps/mobile/src/map/` | T22 결과 지도 계약(`types.ts`), 순수 계산(`geometry.ts` polyline·구간 색·도심 밖·곡선, `selection.ts` 카드 선택·이전/다음·강조 구간, `scene.ts` 마커·구간 명세), 어댑터 주입(`provider.tsx`)·Google 구현(`google-result-map.tsx`)·화면 밖 공항 이름을 지도 가장자리별로 묶는 `airport-edge-indicators.tsx`·지도 키 확인(`config.ts`) | design-tokens, `result/` 모델 타입, `react-native-maps`(Google 어댑터만) | 화면 import, 서버 코드, 순수 파일의 React Native |
| `apps/mobile/src/result/` | T22 결과 순수 모델: 날짜별 카드·구간·전체 일정 줄(`days.ts`), 충돌 원인(`conflicts.ts`), 제약 수정(`edits.ts`), 문구(`format.ts`) | core 계약·표시, `map/geometry`, Temporal | React Native, I/O |
| `apps/mobile/src/theme/`, `assets/fonts/` | 디자인 값의 RN 스타일 변환, Pretendard 400/600, 동작 줄이기 | design-tokens, React Native·expo-font | 화면별 색·수치 복제 |
| `packages/design-tokens/` | 플랫폼 독립 색·글자·간격·모서리·크기·그림자·움직임 값, T22 결과 화면 값(`result`), 디자인 문서 일치 검사 | 외부 의존 없음 | 플랫폼 타입·I/O |

결과 화면(T13)은 아래 T13 연결 절을 따른다.

## 연결 방식

- **계층:** 화면/API → 서비스 → 저장소·제공자(포트) → 순수 코어(`scheduler`, `fare`). 의존은 이 방향으로만 흐른다. 코어가 제공자를 호출하는 역방향 의존은 없다.
- **포트와 어댑터:** 외부 API는 `PlaceProvider`, `TravelTimeProvider` 인터페이스 뒤에 있다. Google 구현과 캐시 구현이 같은 인터페이스를 따르고, 캐시는 실제 제공자를 감싼다(`CachedPlaceProvider(new GooglePlaceProvider(key))`).
- **조립 지점:** 구체 구현을 고르는 곳은 각 모듈의 `server.ts` 하나다. 모듈 import 시점에는 연결·네트워크 작업을 하지 않고, 처음 쓸 때 만든다. 테스트는 같은 인터페이스에 가짜 구현을 넣는다.
- **오류:** 입력 오류(`*InputError`)와 제공자 장애(`*ProviderError`)를 구분한다. 장애를 빈 결과나 null로 숨기지 않는다. 응답 본문은 `{ code, error, fields? }`이며 `code`는 core `contracts/errors.ts`의 목록만 쓴다(T18).
- **시간:** 모든 시각은 IANA 시간대와 함께 다룬다. 현지 날짜·시각 문자열과 오프셋이 있는 instant를 구분한다.
- **요청 인증(T18)** 시 HTTP 처리기(`trips`, `places`, `itineraries`, `route-shapes`, `settings`, `results`, `sharing`)와 `GET /api/trips/[id]`(`trips/http.ts`의 `tripAccessHandler`)는 각 `server.ts`에서 `lib/auth/server.ts`의 `requestAuthenticator.userId(request)`를 주입받는다. `Authorization` 헤더가 있으면 Bearer 세션을 검증하고 실패 시 401을 반환한다. 헤더가 없으면 Auth.js 쿠키를 사용한다. 이후 `authorizeTrip`과 저장소의 `owner_id` 조건으로 소유권을 검사한다. API 라우트 중 `src/auth.ts`를 직접 참조하는 곳은 Auth.js 라우트뿐이다.
- **모바일 로그인(T18):** 앱 → `POST /api/session { idToken }` → `MobileSessionService` → `JoseGoogleIdTokenVerifier`(Google JWKS, `GOOGLE_MOBILE_CLIENT_IDS`) → `upsertGoogleUser` → `mobile_sessions`(해시·30일) → `{ token, expiresAt }`. 로그아웃 `DELETE /api/session`, 탈퇴 `DELETE /api/account`(Bearer 전용, `users` cascade로 모든 세션 삭제). 상세: [T18 결정](decisions/T18-mobile-session-tokens.md).
- **앱 연결(T20):** 루트 글꼴 로드 → `native-runtime.ts`가 Google/SecureStore를 `runtime.ts`에 주입 → `SessionManager.restore` → `Stack.Protected` 로그인/첫 화면. API가 401을 받으면 해당 요청의 세션만 지우며, 늦은 이전 세션 응답으로 새 로그인을 지우지 않는다. 로그아웃은 서버 실패에도 기기 토큰을 지운다. 저장소 오류는 접근을 막고 삭제 재시도를 제공한다. SDK의 Web ID를 서버 허용 aud 목록에 포함하는 설정은 [앱 README](../apps/mobile/README.md), 결정·검증은 [T20 결정](decisions/T20-mobile-shell-and-auth.md).
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
| 저장 형식·표시 정책·쓰기 경계 정책을 한 곳에 | 쓰기/읽기·편집/공유가 같은 규칙을 따로 고치지 않게 하기 위해(최종 점검) | [T15A 결정](decisions/T15A-final-audit.md), [점검 목록](t15a-audit.md) |

`apps/server/tests/architecture.test.ts`가 코어의 I/O 금지, 아키텍처 문서의 타입 계약과 실제 export 일치, 문서 링크 유효성을 검사한다.

## T13 결과 UI 연결

- 기준: 작업 시작 원격 `develop` fed5c6f. `/trips/[id]/result`와 `apps/server/src/components/itinerary/`가 지도·타임라인·구간 비교·전체 효율·장소 제약 편집을 제공한다.
- `apps/server/src/results/`: 공유 DTO·검증·표시 변환과 HTTP/서버 조립. 공유 코드는 DB·네트워크에 의존하지 않는다.
- `apps/server/src/services/itinerary/editing.ts`: 저장소·장소 포트를 통한 조회/제약 저장. `constraints.ts`: 기존 짐 설정을 유지하면서 구간 수단 고정을 적용한다.
- `apps/server/src/repositories/itinerary-constraints.ts`: 여행 행 잠금·소유권·입력 해시 검사와 원자적 제약 저장. 006은 `trips.leg_modes`를 추가한다.
- GET/PUT `/api/trips/[id]/constraints` → ResultEditService → ConstraintRepository. 저장 뒤 기존 POST `/api/trips/[id]/itinerary`로 재검증하며 생성 응답의 inputHash를 확인한다. 이름·귀속 정보는 DB에 보관하지 않는다.
- 생활 설정 저장 후에도 T12 POST로 전체 동선을 재계산한다. 입력 중 미리보기는 TIME_WINDOWS로 유지한다.
- 지도는 브라우저 Google Maps 어댑터를 통해 접근한다. 서버 Places/Routes 키를 전달하지 않는다. 상세: [T13 결정](decisions/T13-result-ui-and-constraints.md).

## T13A 전체 점검 후 경계

- 배치 타입·경로 평가를 분리해 `placement.ts`가 300줄 이내이며 기존 scheduler export는 유지한다.
- `FareConverter.table`은 `fare.createTaxiFareEstimator`로 행렬별 출발 instant/시간대 준비를 한 번 수행한다.
  실제 구간 재조회마다 새 estimator를 사용한다. 전역 캐시나 외부 응답 저장은 추가하지 않는다.
- `settings/service`는 `settings/model`의 저장소 포트에 의존한다. 구체 저장소는 server.ts에서 주입한다.
- 5개 HTTP 모듈은 공통 `lib/http` 정책을 사용하며 인증/입력/오류 계약은 각 모듈이 유지한다.
- `apps/server/tests/architecture-layers.test.ts`는 전체 소스 런타임 순환, 클라이언트의 전이 서버 의존,
  서비스/저장소 경계와 소스 300줄 상한을 검사한다. `fare-matrix.test.ts`는 행렬별 준비 횟수와 동등성을 검사한다.
- 전체 목록·전후 성능·후속 범위: [T13A 점검](t13a-audit.md), [결정](decisions/T13A-audit-and-fare-preparation.md).

## T15 종단 간 시나리오

- `apps/server/tests/e2e/journey.spec.ts`: 375px 한 세션에서 흐름 1–10(로그인 → 여행 생성 → 생활 설정 → 수용량 초과 → 필수 선택 → 재검증 → 결과·지도·수정 → 공유 → 탈퇴)을 검증한다. 소스(`apps/server/src/`) 변경 없음.
- **실제 서버·Auth.js 세션·PostgreSQL·서비스를 그대로 쓰고 Google만 대체한다.** 앱 API를 `page.route`로 가로채지 않는다. 화면 입력이 DB에 저장되고(`trips`, `trip_places` 조회로 확인), 설정·제약 변경과 계산·공유가 같은 저장 상태를 읽는다.
  - 서버 쪽: `apps/server/tests/e2e/support/google-doubles.mjs`를 `NODE_OPTIONS=--import`로 서버에 미리 불러와 `accounts.google.com`/`oauth2.googleapis.com`(OpenID 설정·JWKS·토큰, RS256 id_token), Places, Routes로 가는 `fetch`만 결정적 응답으로 바꾼다. 브라우저 쪽 동의 화면은 `page.route`가 인가 요청을 콜백으로 되돌린다.
  - 지도: `apps/server/tests/helpers/e2e-maps.ts`가 `google.maps.importLibrary`를 기록용 스텁으로 바꾼다. 실제 `GoogleResultMap`이 만든 마커(이름·배치/희망/미배치 상태)를 읽고 마커 클릭으로 편집 카드를 선택한다. 지도를 그리는 모든 e2e는 이 스텁을 설치한다.
  - `apps/server/playwright.config.ts`의 webServer는 가짜 `NEXT_PUBLIC_GOOGLE_MAPS_*`를 포함해 다시 빌드한 뒤 `localhost:3210`에서 시작한다(세션 쿠키·Auth.js 리다이렉트 호스트 일치). `TOKYO` 도시 프로필은 테스트가 upsert하고, 테스트 사용자는 시작·종료 때 삭제한다.
- 공용 장소 검색 헬퍼: `apps/server/tests/helpers/e2e-places.ts`.

## T14 읽기 전용 공유 연결

- `apps/server/src/sharing/`: 공유 DTO·저장소 포트, 소유자 토큰 재발급/비로그인 조회 HTTP, 서버 조립.
- `apps/server/src/services/sharing.ts`: 토큰 생성·해시·조회 후 유효성 재검사. 저장소·장소 포트에 의존하며 SQL·HTTP·동선 생성에 의존하지 않는다.
- `apps/server/src/repositories/sharing.ts`, `shared-itinerary.ts`: 해시 원자적 교체, 일관된 입력·최신 저장 결과 조회와 정규화 일정 복원. 외부 API·스케줄러 실행은 금지한다.
- 결과 화면의 `share-controls.tsx` → 소유자 POST `/api/trips/[id]/share` → SharingService → PostgresShareRepository.
- 공개 `/share/[token]`의 `shared.tsx` → GET `/api/share/[token]` → 저장 결과 조회 → 장소 표시 정보 조회.
- 기존 `trips.share_token`에 SHA-256 해시를 저장한다. 재발급으로 이전 링크를 무효화한다.
- 표시 컴포넌트는 `ResultDisplayView`를 사용하고 편집 콜백이 없으면 수정 UI를 노출하지 않는다.
- `services/itinerary/display-places.ts`는 편집·공유 조회의 실시간 표시 정보 조회와 장소 참조 목록(`tripPlaceRefs`)을 공유한다.
- 공유 저장소는 입력 스냅샷과 결과만 돌려주고, 공개 입력 축소(`results/model.displayInput`)는 SharingService가 한다(T15A).
- 계약과 검증: [T14 결정](decisions/T14-read-only-sharing.md), [아키텍처 §11](architecture.md#11-t14-읽기-전용-공유).

## 모바일 앱 전환 계획 (T16–T26, 2026-11-19)

- PWA 화면을 React Native(Expo) 앱으로 바꾼다. 서버 API·DB·순수 코어는 유지하고, 화면과 로그인 방식(앱용 Bearer 세션 토큰)만 바꾼다. 작업 목록과 완료 기준: [요구사항 §5](requirements.md).
- 화면은 [디자인 기준](design.md)을 따른다. 색·글자·간격 값은 앱의 토큰 모듈 한 곳에만 둔다.
- T17에서 npm workspaces로 이동했다. 루트 검사는 `--workspaces --if-present`로 위임하며 예약 패키지에는 빈 성공 스크립트를 두지 않는다. 환경 파일은 `apps/server/.env.local`, SQL과 서버 산출물은 `apps/server` 기준이다.
- **T16 설계·T17 구조 구현:** [아키텍처 §13](architecture.md#13-t16-앱-전환-후-구조-계획), [T16 결정](decisions/T16-app-transition.md).
  - `apps/server`(Next: API + `/share/[token]`), `apps/mobile`(Expo), `packages/core`(scheduler·fare·공용 DTO·검증·표시 변환), `packages/design-tokens`(디자인 값). 앱과 서버는 서로 import하지 않는다.
  - 앱 인증: 네이티브 Google ID 토큰 → `POST /api/session` → 불투명 세션 토큰(DB에는 SHA-256 해시, 30일) → `Authorization: Bearer`. 처리기의 `userId(request)` 뒤 `authorizeTrip`은 그대로.
  - 새 경로는 `/api/session`, `/api/account`, `/api/trips/[id]/itinerary/shapes`(경로 모양, 저장하지 않음) 세 개. 오류 본문에 `code`를 추가한다.
  - `apps/server/tests/app-transition-design.test.ts`가 §13의 항목, 모든 API 라우트의 계약 표 수록, T25 삭제 목록 경로의 존재를 검사한다. `apps/server/tests/app-transition-contract.test.ts`는 현재 오류 응답의 `fields` 두 형태(목록·필드별 메시지)가 계획한 `ApiError`에 맞는지, `auth()`를 직접 부르는 API 라우트(`GET /api/trips/[id]`)가 Bearer 전환 대상과 T18 검증 계획에 있는지 검사한다.
- 웹 화면은 T25에서 지운다. 공유 링크용 읽기 전용 웹 페이지(`/share/[token]`)만 남긴다.

T17 구현·대안·검증: [결정](decisions/T17-npm-workspaces.md). core는 TS 원본 하위 경로를 export하고 Next가 변환한다. core 빌드는 JS·선언 파일을 생성한다. 구조 검사는 패키지 export를 따라 순환·클라이언트 서버 접근을 검사한다.

## T19 구간 경로 모양 연결

- GET `/api/trips/[id]/itinerary/shapes`(필수 `inputHash`, 선택 `itineraryId`) → `route-shapes/http.ts`(인증·소유권·쿼리 검증) → `RouteShapeService` → `PostgresRouteShapeRepository`·`PlaceProvider.location`·`RouteShapeProvider`.
- `repositories/route-shapes.ts`는 소유자·현재 입력·여행의 최신 저장 일정을 read-only repeatable-read 트랜잭션에서 확인한다. 지도와 공유 링크 모두 `shared-itinerary.ts`로 선택한 행의 구간을 복원한다. 지도 성공 응답에는 그 행의 ID가 들어가며, 현재 해시에 다른 ID를 지정하면 409 `RESULT_UNAVAILABLE`이다.
- `travel-time/shapes.ts`는 이동시간과 분리된 포트, `google-shapes.ts`는 polyline 전용 어댑터다. 기존 이동시간 어댑터와 `google-client.ts`의 HTTP·요청 옵션·오류 정규화를 공유한다. 모양 캐시는 없다.
- DTO는 `packages/core/src/contracts/route-shapes.ts`. 서비스는 DAY·AIRPORT 구간 순서를 유지하고 요청당 최대 4개 구간을 처리한다. 좌표만 요청 안에서 중복 조회를 합치며 모양 응답은 재사용하지 않는다.
- T18 병행 작업과의 인증 연결·검증 범위는 [T19 결정](decisions/T19-route-shapes.md), 저장 정책은 [ADR 0005](decisions/0005-travel-time-provider-and-cache.md)를 따른다.

## T21 모바일 입력 연결

- `내 여행` → `/trips/new`의 여행 입력·장소 초안 → `POST /api/trips`에서 초기 생활 설정과 고정 조건까지 원자적으로 저장 → `/trips/[id]/generate`에서 기존 일정 생성 요청.
- `GET /api/trips`는 소유한 여행 목록, 기존 `GET /api/trips/[id]/constraints`는 저장한 입력과 장소 표시 정보, 기존 `GET/PUT /api/trips/[id]/settings`는 생활 설정 조회·수정을 담당한다.
- 앱의 생활 설정 화면은 PUT 성공 후 기존 `POST /api/trips/[id]/itinerary`로 전체 동선을 재검증한다. 계산 요청이 실패하면 저장된 설정을 유지하고 POST만 재시도한다.
- core의 `contracts/trips/create.ts`, `contracts/results/fixed-visit.ts`, `contracts/settings/defaults.ts`가 생성 계약·고정 조건 검증·기본값을 연결한다. 지도와 주소 검색은 같은 장소 ID 계약을 쓴다. [T21 결정](decisions/T21-mobile-trip-input.md)

## T22 모바일 결과 화면 (지도 우선 · 장소 카드)

- 전체 일정은 일반 입력 시트와 헤더·스크롤 본문 구조를 공유하고, `ExpandedFormSheet`로 상단 바 아래까지 펼친다.
- `/trips/[id]/generate`(T21 생성 화면) → POST 응답 → `screens/result/result-flow.tsx`의 `OutcomeFlow`: OK·CONFLICT는 `ResultFlow`(GET `/constraints`로 입력, revision이 다르면 한 번 재계산), OVER_CAPACITY는 T23 `CapacityFlow`. T23 `동선 보기`와 결과 화면의 재계산 OVER_CAPACITY도 같은 흐름을 메모리로 오간다.
- 모바일 `api/client.ts`는 JSON 성공 본문을 읽고, `api/result-response.ts`는 일정 생성 결과와 제약 조회·저장 응답의 필수 필드를 확인한다. 저장 응답이 손상되면 재시도 시 저장된 입력을 다시 읽어 제약 반영 여부를 확인한다.
- `result-screen.tsx`가 선택 `{ date, index }` 하나로 카드·지도 마커·강조 구간을 계산한다(`map/selection.ts`·`scene.ts`, `result/days.ts`). 지도는 `MapAdapterProvider`로 주입한 `ResultMapProps` 구현만 그린다(앱: `GoogleResultMap`, 테스트: `tests/fake-result-map.tsx`).
- 수정(장소 고정·순서·희망 전환, 희망 장소 날짜 추가, 구간 이동수단)은 `use-itinerary.ts`가 기존 `PUT /constraints` → `POST /itinerary` → `verifyRevision`으로 처리하고, 저장 직전 제약으로 `변경 취소`·`되돌리기`를 한다. T19 GET은 표시 중인 일정 ID와 해시를 대조하며, `use-route-shapes.ts`는 여행·해시·일정 ID가 일치하는 경로를 날짜별 구간 모델에 전달한다. 지도 마커, 직선 대체 경로, 전체 일정의 도심 밖 판정은 같은 날짜별 장소 좌표를 사용한다. 장소 상세 좌표가 없으면 표시 날짜에 출발하는 구간의 실제 도로 끝점을 우선하고, 다음으로 같은 일정의 다른 날에서 같은 장소 ID의 도로 끝점을 찾는다.
- 장소 카드와 전체 일정 시트는 `swap-chip.tsx`로 같은 구간 대안의 소요 시간·요금과 변경 동작을 표시한다. 전체 일정에서는 공항·숙소 구간도 변경할 수 있다.
- 디자인 §4 그림자와 §6–7 값은 design-tokens의 `shadow`·`result`(토큰 테스트가 문서와 비교). [T22 결정](decisions/T22-mobile-result-screen.md), [가정](questions.md#t22-결과-화면-가정)

## T23 모바일 필수 장소 선택

- 여행 생성 화면과 하루 생활 재계산이 `OVER_CAPACITY`를 받으면 `apps/mobile/src/screens/capacity/`의 선택 화면을 연다. 저장된 장소와 최초 계산을 같은 입력 해시로 맞춘다.
- 재검증은 `src/api/trips.ts`의 제약 조회·저장과 생성 요청을 사용한다. 목록과 진단은 방문 ID를 기준으로 연결하고, 저장된 제약과 일치하는 검증 결과를 T22 결과 화면으로 연다. [T23 결정](decisions/T23-mobile-capacity-selection.md)
