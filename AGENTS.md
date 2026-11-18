# 작업 규칙 (모든 AI 에이전트 공통)

이 파일은 Claude와 GPT(Codex 등) 모두가 따르는 공통 규칙이다. 도구별 파일(CLAUDE.md 등)에 규칙을 따로 적지 않는다.

## 기준 문서
- 요구사항과 계획: `docs/requirements.md` (확정/추천/미정 구분 유지)
- 작업 상태와 담당: `docs/tasks.md` (`develop` 브랜치 기준)
- 설계 결정 기록: `docs/decisions/NNNN-제목.md` (결정, 이유, 대안)
- 에이전트의 질문과 가정: `docs/questions.md`
- 아키텍처: `docs/architecture.md` (T7A에서 작성. 이후 모든 작업은 이 문서의 구조와 인터페이스를 따르고, 바꿔야 하면 문서와 결정 기록을 같은 PR에서 갱신한다)

## 브랜치
- `main`: 사람이 검토한 안정 버전. 사람만 머지한다(`develop` → `main`).
- `develop`: **기본 브랜치.** 작업 PR이 머지되는 통합 브랜치이며 agent-review가 자동 머지한다.
- 작업 브랜치: `t{번호}-{설명}`. PR 대상은 `develop`.

## 자동 협업 루프 (`.github/workflows/agent-*.yml`, `scripts/agent/local-runner.sh`)
- **역할: 담당한 쪽이 구현하고, 다른 쪽이 리뷰한다.**
  - 작업표(`docs/tasks.md`)의 담당이 `gpt`인 작업 → Codex(Mac 러너)가 구현, Claude(agent-review)가 리뷰
  - 담당이 `claude`인 작업 → Claude(agent-claude)가 구현, Codex(Mac 러너)가 리뷰 후 agent-verdict가 판정
  - 리팩터링(`R번호`) → Claude가 수행, Codex가 리뷰
- 순서: agent-start가 다음 작업 이슈 생성 → 담당이 PR 생성 → agent-review가 테스트 → 리뷰 → 승인이면 `develop`에 머지하고 다음 작업, 아니면 PR에 피드백 댓글(`<!-- agent-feedback -->`) → **작성자가** 수정.
- 리뷰가 승인하면서 기존 코드의 구조 문제(`refactor` 항목)를 제안하면, 다음 작업 전에 리팩터링 이슈(`R번호: …`, `refactor-task` 라벨)를 만들어 Claude가 수행한다. `AGENT_REFACTOR=off`로 끌 수 있다.
- Codex 쪽 구현 주체는 저장소 변수 `AGENT_EXECUTOR`로 고른다(`local` 기본: Mac 러너, `cloud`: Codex 클라우드 + 사람 클릭).
- 작업 PR의 제목은 반드시 `T번호: ` 또는 `R번호: `로 시작한다. Claude가 만든 PR에는 `owner-claude` 라벨이 붙는다.
- 리뷰 왕복 상한(기본 3라운드)에 도달하면 `needs-human` 라벨을 붙이고 작업을 `보류`로 바꾼 뒤 다음 작업으로 넘어간다.
- 에이전트 실행이 실패하면(구독 한도 소진 포함) `agent-paused` 이슈를 열고 멈춘다. 이슈를 닫으면 재개한다.
- `.github/**`, `AGENTS.md`, `CLAUDE.md`, `docs/requirements.md`, `docs/tasks.md`, `scripts/agent/**`를 수정한 PR은 자동 머지하지 않고 사람 검토로 넘긴다. 이 파일들은 사람(또는 사람이 지시한 대화형 세션)만 수정한다.

## 작업 방식 (사람이 지시한 대화형 작업 포함)
1. 작업 시작 전에 `docs/tasks.md`에서 해당 작업을 `진행중`으로 바꾸고 담당과 브랜치를 기록한다.
2. 작업 하나에 브랜치 하나.
3. 다른 에이전트가 `진행중`이거나 `리뷰`인 작업의 파일은 수정하지 않는다.
4. 완료 기준(`docs/requirements.md` §5)을 테스트로 충족한 뒤 PR을 연다.
5. PR 설명에는 변경 요약, 완료 기준 충족 근거, 남은 이슈, 사람 확인 필요 사항, 다음 작업자를 위한 인계 내용을 적는다.
6. 요구사항이 모호하면 `docs/questions.md`에 질문과 채택한 가정을 남기고 진행한다. 요구사항 자체는 바꾸지 않는다.

## 코드 규칙
- TypeScript strict. Node 24.
- `package.json`에 다음 스크립트를 유지한다: `lint`, `typecheck`, `build`, `test`. E2E가 있으면 `test:e2e`(Playwright).
- 테스트용 DB는 환경 변수 `DATABASE_URL`(PostgreSQL 16)을 사용한다.
- 스케줄러(`src/scheduler/`)는 외부 API나 DB에 의존하지 않는 순수 함수로 유지한다.
- **코드 품질 원칙은 `.github/agent/prompts/quality.md`를 따른다.** 요약: 객체지향 원칙(SOLID), 상태·외부 의존이 있는 것은 클래스로 캡슐화하고 인터페이스에 의존(생성자 주입), 상태 없는 순수 계산은 순수 함수 모듈 유지, 300줄을 넘거나 책임이 섞인 파일은 분리, 중복 로직은 하나로, 명백한 비효율(N+1, 반복 계산)은 작업 중 함께 개선.
- 시각은 항상 IANA 시간대와 함께 다룬다.
- 외부 API(Google Places/Routes, OAuth)는 인터페이스 뒤에 두고 테스트에서는 목과 픽스처를 쓴다. 실제 키 없이 모든 테스트가 통과해야 한다.
- API 키 등 비밀 값은 커밋하지 않는다(`.env.local` 사용, `.env.example`만 커밋).
