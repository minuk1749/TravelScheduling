# T10: 입력 UI

## 변경 요약

- 원격 `develop` 최신 `1b23d6f`와 같은 HEAD인 `t10-local`에서 구현했다.
- 로그인한 홈의 ‘새 여행 만들기’ → `/trips/new`에 여행·항공·숙소·장소 4단계 입력을 추가했다.
  375px 대응 단일 열, 입력 레이블, 오류 요약/초점 이동, 이전 단계 값 유지, 검색 실패·빈 결과·재시도,
  복수 숙소, 식당/명소·체류시간·필수/희망, 짐 처리·택시 정책을 제공한다.
- 도시 선택 시 DB 이동 프로필·출처·갱신일·추정 요금·기본 추천 정책을 표시한다.
  누락 프로필은 ‘정보 없음’, 요청 실패는 재시도로 구별한다. 다른 해외 도시/IANA 시간대도 입력 가능하다.
- 인증된 `POST /api/trips`는 공유 검증기를 거쳐 세션 소유자와 여행 전체를 한 트랜잭션으로 생성한다.
  Google ID만 영구 저장하고 이름·검색 결과·영업시간은 저장하지 않는다.
- `GET /api/city-profiles?cityCode=...`, SQL 프로필 정규화, 생성 저장소, 단위/DOM/DB/Playwright 테스트를 추가했다.
  새 개발 의존성과 `package-lock.json`을 함께 갱신했다. DB 마이그레이션은 추가하지 않았다.
- 아키텍처와 [ADR 0006](decisions/0006-trip-input-creation.md), [질문/가정](questions.md)을 갱신했다.

## 완료 기준 충족 근거

| 기준 | 자동 테스트와 현재 확인 범위 |
|---|---|
| 375px에서 흐름 2–5 완료 | [Playwright](../tests/e2e/trip-input.spec.ts)의 375px 시나리오: 단계별 가로 넘침·44px 조작 영역·복수 숙소·식당/명소·저장 요청 검사. **Mac 샌드박스가 Chromium 시작을 거부하여 실제 브라우저 실행/시각 검증은 미완료**. [DOM 상호작용](../tests/trip-input-ui.test.ts)은 실제 React 폼으로 흐름·이전 이동·삭제 후 값 보존·저장 실패 재시도가 통과함. DOM 테스트를 레이아웃 검증으로 간주하지 않는다. |
| 도시 선택 시 프로필·추천 정책 | [단위/HTTP](../tests/trip-input.test.ts): 출처 있는 프로필/없는 도시, 인증, SQL 숫자·시간 정규화. DOM: 프로필·추천·갱신일 표시, 늦은 이전 도시 응답 무시, 누락·실패·재조회. 실제 T4D 데이터 대신 명시적인 테스트 픽스처 사용. |
| 잘못된 입력 차단 | 공유 검증기/API/DOM: 날짜 역전·유효하지 않은 날짜/IANA 시간대·DST 중복/없는 시각·첫날/마지막 날 항공 제약·숙박 겹침/빈 날짜·선택되지 않은 장소·중복 장소·체류시간·enum·미인증/위조 ownerId·다른 출처 요청·내부 오류 비공개. |
| 생성 영속화·부분 실패 방지 | [DB 통합](../tests/trip-input-db.test.ts): 여행·항공·숙소·방문 저장, 기본값·현지 시각·WISH 변환·ID만 저장·공유 장소 재사용·실패 롤백. **DATABASE_URL 미설정으로 로컬 실행 실패, CI PostgreSQL 16에서 확인 필요**. |

2026-11-18, Node **24.22.3** 최종 검사:

- `npm run lint`: 통과.
- `npm run typecheck`: 통과.
- `npm run build`: 통과. 새 페이지/API 및 PWA 산출물 확인.
- `npm test`: **87개 중 70개 통과, 17개 실패, skip 0개**. 모든 실패는 `DATABASE_URL` 미설정이다.
  기존 DB 테스트 16개와 신규 T10 DB 테스트 1개이며 테스트를 완화하거나 건너뛰지 않았다.
  T10 비DB 테스트 7개(검증/API/프로필 6 + React DOM 1)는 모두 통과했다.
- `npm run test:e2e`: Chromium 설치 후 실행했으나 3개 모두 브라우저 시작 단계에서 실패했다.
  원인: macOS `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`.
  사용 가능한 브라우저 연결 도구도 host unavailable을 반환하여 실제 렌더링은 확인하지 못했다.
- `git diff --check`: 통과.

## 남은 이슈 / 가정

- T4D 실제 10개 도시 프로필은 대기 상태다. 정적 도시 코드/시간대 목록만 추가했으며 요금표는 만들지 않았다.
  현재 모든 도시에 ‘필요할 때만’을 기본 추천한다. 프로필이 있으면 도시의 효율 기준을 설명하며,
  도시별 최적 정책/실제 구간 비교를 계산한 결과라고 주장하지 않는다.
- 입력 한도·기본값은 ADR 0006에 기록했다. 1–31일·방문 최대 100개, 체류 1–1,440분,
  당일 여행은 숙박 없이 허용한다. 첫날 도착/마지막 날 출발과 모든 숙박일 커버를 요구한다.
- 입력 초안은 화면 메모리에만 있으며 새로고침 복구는 없다. 생성 완료 시 여행 ID와 요약을 표시한다.
  생성 외 조회/편집·생활 설정·재계산은 이번 범위에 포함하지 않았다.
- 실제 API 키나 OAuth 자격증명은 사용하지 않았다. 외부 응답은 목/합성 픽스처로만 검증했다.

## 사람 확인 필요

- CI PostgreSQL 16의 `DATABASE_URL`로 전체 `npm test`와 새 저장 트랜잭션/롤백 테스트 확인.
- 브라우저 실행이 가능한 환경에서 `npm ci`, `npx playwright install --with-deps chromium`,
  `npm run build`, `npm run test:e2e` 실행. 테스트는 API 목을 쓰므로 Google 키/DB 없이 실행 가능하다.
  보호된 CI 워크플로는 수정하지 않았으며 E2E는 별도 스크립트다.
- 375px 실제 브라우저/모바일의 날짜·시간 입력, 키보드 초점, 가로 넘침, Google Maps와 제공자 attribution 표시 확인.
- 실제 Google 로그인 후 Places 검색·인증된 생성/DB 저장 확인. T4D 검토된 프로필을 같은 도시 코드로 준비한 뒤
  카드 내용·출처·기본 추천의 적절성을 확인한다.

## 다음 작업자 인계

- 입력 화면: `src/components/trip-input-form.tsx`, 공유 DTO/검증: `src/trips/input.ts`.
  `POST /api/trips` 응답은 `{id}`(201), 잘못된 입력은 `{error, fields}`(400), 미인증 401이다.
- 여행 생성 저장소는 `TripDraft`의 Google ID를 `places.id`로 연결한다. `TripInputs` 스냅샷과
  loadInputs/saveInputs/saveItinerary는 여전히 후속 계약이며 이 DTO를 직접 스케줄러에 전달하지 않는다.
- T11: 기존 여행 ID로 입력/기본값을 읽고 날짜별 설정·정책 편집을 구현한다. 생성 저장소를 호출해 기존 여행을
  다시 만들지 않는다. 기본 활동 09–21시, 점심/저녁, 공항 버퍼 90/150분을 저장했다.
- T12: WISHLIST→WISH, SQL local date/time→여행 IANA 시간대 변환, Google 상세/좌표 조회를 연결한다.
  `VIA_LODGING`은 마지막 날 숙소 경유, `DIRECT_TO_AIRPORT`는 직접 공항 이동이며 첫날은 숙소 짐 맡김 기본이다.
  당일 여행에 숙소가 없을 때에는 공항을 시작/종료 앵커로 처리해야 한다.
- 보호 파일(`.github/**`, AGENTS/CLAUDE, requirements/tasks, scripts/agent/**)은 변경하지 않았다.
  commit/push/PR 생성은 수행하지 않았다. 러너가 제목 **`T10: 입력 UI`**, base **`develop`**으로 처리한다.
