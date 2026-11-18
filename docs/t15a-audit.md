# T15A 최종 전체 점검 (T14–T15 이후)

## 기준과 범위

2026-11-18, 작업 시작 HEAD와 원격 `develop`이 모두 `ee500de`(T15A 시작, 이슈 #52)임을 확인했다.
[T13A 점검](t13a-audit.md)과 같은 기준(`AGENTS.md` 전체 점검 체크리스트 + 300줄 초과 파일)으로 저장소 전체를 점검했다.
T13A 이후 바뀐 범위는 T14 공유(`src/sharing/`, `services/sharing.ts`, `repositories/sharing.ts`·`shared-itinerary.ts`,
결과 표시 컴포넌트의 읽기 전용화)와 T15 종단 간 시나리오(`tests/e2e/`, `playwright.config.ts`)다.
T13A가 남긴 후속 항목도 다시 확인했다. 보호 파일(`.github/**`, `AGENTS.md`, `CLAUDE.md`, `docs/requirements.md`,
`docs/tasks.md`, `scripts/agent/**`)은 점검만 하고 수정하지 않았다.

## 체크리스트와 조치

| 기준 | 발견 | 처리와 검증 |
|---|---|---|
| 책임 혼합 | 공유 SQL 저장소(`repositories/sharing.ts`)가 표시용 입력 축소와 화면 장소 참조 목록 계산(표시 정책)까지 맡음 | 저장소는 입력 스냅샷과 저장 결과만 반환하고, 서비스가 `displayInput`·`tripPlaceRefs`로 축소/계산. `sharing-http`가 공개 응답의 입력 키와 장소 목록을 검사 |
| 중복 규칙 | ① 결과 화면 장소 참조 목록(방문→공항→숙소)이 편집 서비스·공유 저장소·테스트 도우미 3곳 ② `itineraries.details` JSONB 형식이 쓰기(`itineraries.ts`)와 읽기(`shared-itinerary.ts`)에 따로 정의 ③ Origin + `Sec-Fetch-Site: cross-site` 검사가 설정·공유 HTTP에 복사 ④ `TripInputs → TripDraft` 변환이 DB 테스트 2곳 | ① `services/itinerary/display-places.tripPlaceRefs` ② `repositories/itinerary-details.ts`(타입·인코더·완전성 검사) ③ `lib/http.isCrossSiteRequest` ④ `fixtures/itinerary.sampleDraft`. 각각 `sharing-*`, `itinerary-details`, `http-policy`/`living-settings-http`/`sharing-http`, `result-db`/`sharing-db` |
| 순환·경계 위반 의존 | 런타임 순환·클라이언트의 서버 전이 의존 없음. 저장소는 스케줄러·제공자를 호출하지 않음 | 변경 없음. `architecture-layers.test.ts`가 새 파일(`itinerary-details.ts`)까지 포함해 검사 |
| 변경 시 여러 곳 수정 | 위 ②: details에 필드를 추가하면 쓰기·읽기 타입과 레거시 판정 3곳을 함께 고쳐야 했음. ③: 쓰기 경계 정책 변경 시 두 처리기 수정 | 위 조치로 한 파일씩. 다른 3개 쓰기 경계(`trips`·`itineraries`·`results`)의 `Sec-Fetch-Site` 미적용은 동작 변경이라 [질문](questions.md)으로 넘김 |
| 불필요한 추상화·미사용 코드 | `places`의 이름·좌표·영업시간·유형·만료 SQL 열(과거 스키마, 항상 NULL), `details.schedule` 값(앱에서 읽는 곳 없음) | 데이터 형식 변경이므로 유지하고 사람 결정 항목으로 기록. 새 계층·포트 추가 없음 |
| 성능 | T13A 후속: 여행 최초 생성이 항공·숙소·방문 행마다 INSERT(방문 100개면 100회) | 자식 행을 테이블당 1회 집합 INSERT. 장소 upsert는 동시 생성의 잠금 순서를 위해 정렬된 행별 실행 유지. `trip-input-db`가 문장 수(방문 30개에도 3회)와 저장 값 동등성을 검사 |

같아 보이지만 합치지 않은 부분:
- 결과 화면(`index.tsx`)과 공유 화면(`shared.tsx`)의 불러오기 `useEffect`는 인증 여부·`credentials`·`referrerPolicy`·오류 문구가 다르다. T13A와 같이 공통 훅을 만들지 않았다.
- `SharingService`는 장소 제공자를 팩터리(`() => provider`)로, `ResultEditService`는 인스턴스로 받는다. 공유는 잘못된 토큰에서 제공자를 만들지 않는 차이가 있어 그대로 둔다.
- 공유 처리기(`sharing/http.ts`)의 추가 헤더(`Referrer-Policy`, `X-Robots-Tag`)는 공개 응답에만 필요한 정책이므로 `lib/http`로 옮기지 않았다.
- e2e `journey.spec.ts`의 도시 프로필 upsert SQL은 앱에 쓰기 경로가 없는 테스트 전용 준비이며 한 곳뿐이다.

## 모듈별 전체 점검 목록

| 영역 | 확인한 책임·흐름 | 결론 |
|---|---|---|
| app·components·results | 생성→설정→결과→공유, 결과 표시의 읽기 전용 모드(콜백 없으면 편집 UI 없음) | 경계 유지. 표시 입력 축소 함수 `displayInput`을 표시 DTO 옆(`results/model.ts`)에 둠 |
| sharing·services/sharing | 토큰 생성·해시·회전, 조회 후 유효성 재확인, 오류 404/409/502/503/500 | 저장소에서 표시 정책을 걷어냄. 공개 응답 형태는 동일 |
| services/itinerary·itineraries | 동선 생성·재조회 루프·효율·저장 | 변경 없음. T13A 벤치마크 해시 재확인(아래) |
| repositories | 여행 생성, 입력 스냅샷·해시, 일정 저장/복원, 제약·공유 | 생성 N+1 제거, details 형식 단일화 |
| scheduler·fare | 순수 계산 | 변경 없음. 코어 I/O 금지 검사 유지 |
| places·travel-time | 포트·어댑터·캐시 | 변경 없음 |
| auth·lib·migrations | 세션·소유권, 공통 HTTP 정책, 001–006 | `isCrossSiteRequest` 추가. 스키마 변경 없음 |
| server.ts 조립 6곳 | 모듈마다 지연 생성 `pg` 풀(최대 5) | 프로세스당 최대 30연결. 풀 공유는 연결 수 정책 변경이라 [질문](questions.md)으로 넘김 |
| tests·e2e | 단위·SQL·HTTP·구조 검사, Playwright 375px 흐름 | DB 테스트 변환 도우미 통합. e2e는 300줄 이내 |
| 보호 자동화 | 러너·워크플로 | 아래 300줄 목록. 수정 금지 |

## 300줄 초과 파일 목록

`git ls-files`의 텍스트 행 수 기준(시작 시). 모든 `src/**/*.ts(x)`는 300줄 이내다(`architecture-layers.test.ts`).

| 파일 | 행 수 | 처리 |
|---|---:|---|
| `docs/architecture.md` | 462 | 문서. 실행형 계약·과거 점검 기록 포함. §12 T15A 절만 추가 |
| `scripts/agent/local-runner.sh` | 343 | 보호 파일. T13A와 같이 책임 분리를 사람 지시의 별도 작업 후보로 유지 |
| `.github/workflows/agent-review.yml` | 306 | 보호 파일(T14 이후 300줄 초과). 테스트·리뷰·판정 단계 분리를 별도 작업 후보로 기록 |
| `package-lock.json` | 7,500+ | npm 생성 파일. 수정/분리 없음 |

## 성능 확인

동선 계산 경로는 이번에 바꾸지 않았다. `node --import tsx scripts/benchmark-itinerary.ts`로
T13A 기록의 결과 해시 5개(정상 `40e164f5…`, 초과 `7d852b43…`, 충돌 `942dd631…`, 20×20 `338ba8fb…`, 100×100 `c6ff8533…`)가
그대로임을 확인했다(Node 24.22.2, Linux x64. 시간 수치는 머신이 달라 T13A와 비교하지 않는다). 여행 생성의 SQL 문장 수는
`1(여행) + 고유 장소 수 + 3(자식 테이블)`이 되었고, 이전에는 `1 + 고유 장소 수 + 항공 + 숙소 + 방문`이었다.

## 완료 기준별 검증

| 완료 기준 | 자동 검증 |
|---|---|
| T13A와 같은 기준의 전체 점검 목록 | `architecture-layers.test.ts`의 T15A 문서 검사(체크리스트 항목·300줄 목록·남은 문제), 전체 소스 300줄·순환·경계 검사 |
| 정리(동작 보존) | `sharing-http`·`sharing-db`(공개 응답 형태·레거시 거부), `itinerary-details`(형식 단일화), `http-policy`·`living-settings-http`(쓰기 경계), `trip-input-db`(일괄 저장), 기존 전체 테스트 |
| 남은 구조 문제와 사람 결정 항목을 questions.md에 정리 | `architecture-layers.test.ts`가 `docs/questions.md`의 T15A 행을 검사 |
| 모든 테스트 통과 | `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` |

### 실행 결과

Node 24.22.2, PostgreSQL 16(`DATABASE_URL`). 패키지·lockfile 변경 없음.
`npm run lint`·`npm run typecheck`·`npm run build` 통과, `npm test` 155 통과/0 실패/0 건너뜀,
`npm run test:e2e` 7 통과(Chromium 헤드리스, Google은 기존 대역). 벤치마크 해시 5개 일치. 기존 실패·새 실패 없음.

## 남은 문제

사람이 결정할 항목은 [질문/가정](questions.md)의 T15A 행에 모았다. 요약:
- 쓰기 경계 정책 통일: `trips`·`itineraries`·`results`에도 `Sec-Fetch-Site: cross-site` 거부를 적용할지(동작 변경).
- DB 풀: 모듈별 6개 풀을 프로세스 공용 1개로 합칠지, 크기와 종료 정책.
- 미사용 저장 필드: `places`의 상세·좌표 열, `itineraries.details.schedule` 정리(마이그레이션 필요).
- 보호 자동화: `local-runner.sh`(343줄), `agent-review.yml`(306줄) 책임 분리.
- 실제 Google/OAuth/Maps 키 연동, T4D 실제 요금표, T9/T8 캐시 약관 해석은 기존 사람 확인 항목 그대로다.

결정·대안은 [T15A 결정](decisions/T15A-final-audit.md)에 기록한다.
