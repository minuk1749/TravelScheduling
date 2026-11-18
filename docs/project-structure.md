# 프로젝트 구조 요약

작업 전에 읽는 짧은 지도다. 상세 계약과 데이터 흐름은 [아키텍처](architecture.md), 결정 근거는 [결정 기록](decisions/)에 있다.
모듈을 추가·이동하거나 연결 방식이 바뀌면 **같은 PR에서 이 문서를 갱신**한다. (기준: T11 작업, develop `6e1d5cc`)

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
| `src/app/` | 화면, 서버 액션, API 라우트(`api/auth`, `api/places`, `api/trips`). 세션 확인·입력 검증·응답 변환 | 서비스, 각 모듈의 `server.ts`, `auth` | 스케줄링 알고리즘 직접 구현, 브라우저에서 DB·비밀 키 접근 |
| `src/auth.ts`, `src/lib/auth/` | Google 로그인, 세션, 여행 소유권 확인(`authorizeTrip`), 인증 SQL(`store.ts`) | `lib/db` | 화면 |
| `src/lib/db.ts` | PostgreSQL 연결 풀 팩터리(명시적 생성) | `pg` | 모듈 import 시 연결 |
| `src/lib/migrations.ts`, `scripts/migrate.ts`, `migrations/*.sql` | 스키마 적용과 이력(`schema_migrations`) | `pg` | 앱 실행 경로 |
| `src/scheduler/` | **순수 계산.** 하루 시간창·식사 슬롯(`index.ts`), 방문 배치·순서(`placement.ts`), 이동수단 선택(`transport.ts`), 수용량·추천(`capacity.ts`) | 내부 모듈, `Temporal`, `fare`의 타입 | DB, 네트워크, 환경 변수, 현재 시각·난수 |
| `src/fare/` | **순수 계산.** 도시 프로필 타입, 택시 요금 추정 | `Temporal` | DB, 네트워크 |
| `src/places/` | 장소 포트(`index.ts`), Google 어댑터, 좌표 캐시, 입력 검증, 영업시간 변환, HTTP 핸들러, 조립(`server.ts`) | `scheduler` 타입, `auth` | 이름·영업시간 등 상세 저장(약관) |
| `src/travel-time/` | 이동시간 포트(`index.ts`), Google 어댑터, 캐시, 검증, 조립(`server.ts`) | `scheduler` 타입 | 이동수단 선택(스케줄러 책임), 택시 요금 계산(`fare` 책임) |
| `src/components/` | T10 입력·장소 검색·프로필, T11 생활 설정 폼/필드/미리보기 | 브라우저용 검증·계산, HTTP | DB·비밀 키 |
| `src/trips/` | T10 입력 검증·생성 HTTP·서버 조립 | 인증, 여행 생성·도시 프로필 저장소 | 전체 동선 생성 |
| `src/settings/` | 생활 설정 타입·검증·시간창 재계산·서비스·HTTP·서버 조립 | scheduler 공개 함수, 저장소 포트, 인증 | 전체 경로 생성 중복 구현 |
| `src/repositories/` | 여행 생성, 도시 프로필 읽기, 생활 설정 읽기/원자적 수정 | pg, 설정 검증·타입 | 스케줄러 실행·외부 API |
| `tests/` | 순수 함수·SQL·HTTP·구조 검사. `fixtures/`(가짜 외부 응답), `helpers/database.ts` | 모든 모듈 | 실제 Google 키 |

**아직 없는 모듈(예정):** 전체 입력·일정 저장소, `src/services/itinerary.ts`(T12 동선 생성), 결과 화면(T13).

## 연결 방식

- **계층:** 화면/API → 서비스 → 저장소·제공자(포트) → 순수 코어(`scheduler`, `fare`). 의존은 이 방향으로만 흐른다. 코어가 제공자를 호출하는 역방향 의존은 없다.
- **포트와 어댑터:** 외부 API는 `PlaceProvider`, `TravelTimeProvider` 인터페이스 뒤에 있다. Google 구현과 캐시 구현이 같은 인터페이스를 따르고, 캐시는 실제 제공자를 감싼다(`CachedPlaceProvider(new GooglePlaceProvider(key))`).
- **조립 지점:** 구체 구현을 고르는 곳은 각 모듈의 `server.ts` 하나다. 모듈 import 시점에는 연결·네트워크 작업을 하지 않고, 처음 쓸 때 만든다. 테스트는 같은 인터페이스에 가짜 구현을 넣는다.
- **오류:** 입력 오류(`*InputError`)와 제공자 장애(`*ProviderError`)를 구분한다. 장애를 빈 결과나 null로 숨기지 않는다.
- **시간:** 모든 시각은 IANA 시간대와 함께 다룬다. 현지 날짜·시각 문자열과 오프셋이 있는 instant를 구분한다.
- **생활 설정:** `/trips/[id]/settings` → GET/PUT `/api/trips/[id]/settings` → LivingSettingsService → LivingSettingsRepository. 여행 생성 성공 화면에서 진입한다. 설정 변경 즉시 scheduler의 시간창을 다시 계산하며 고정 시각 충돌을 표시한다. 전체 동선 재계산은 T12/T13 연결 필요이며 현재 결과는 TIME_WINDOWS다.

## 중요한 설계 이유

| 결정 | 이유 | 기록 |
|---|---|---|
| 스케줄러·요금은 순수 함수 | 외부 요인 없이 테스트하고, 동선 재계산 루프에서 같은 입력에 같은 결과를 보장하기 위해 | [ADR 0001](decisions/0001-pure-core-and-service-boundaries.md) |
| 시각 저장·변환 규칙, 오류 계약 | 해외 시간대·서머타임 버그를 원칙으로 차단하기 위해 | [ADR 0002](decisions/0002-time-storage-and-error-contracts.md) |
| 장소는 좌표만 캐시 | Google 약관이 상세 정보 저장을 허용하지 않기 때문 | [ADR 0003](decisions/0003-places-cache-policy.md) |
| 마이그레이션 이력·행 시각 | 스키마 변경이 쌓여도 환경 간 상태가 어긋나지 않게 하기 위해 | [ADR 0004](decisions/0004-database-migrations-and-timestamps.md) |
| 이동시간 제공자와 캐시 | 행렬 한도 분할, 요금 없음/경로 없음 구분, 약관 범위 안의 캐시 | [ADR 0005](decisions/0005-travel-time-provider-and-cache.md) |
| 생활 설정 상속·저장·부분 재계산 | null/0끼 구별, 동시 편집 방지, 전체 동선과 시간창 미리보기 구분 | [ADR 0007](decisions/0007-living-settings.md) |

`tests/architecture.test.ts`가 코어의 I/O 금지, 아키텍처 문서의 타입 계약과 실제 export 일치, 문서 링크 유효성을 검사한다.
