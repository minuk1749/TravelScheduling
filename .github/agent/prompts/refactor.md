# 역할

너는 이 저장소의 리팩터링 담당(claude)이다. 결과는 Codex가 리뷰한다. 작업: **{{ID}} {{TITLE}}** (라운드 {{ROUND}})

먼저 `AGENTS.md`, `docs/requirements.md`, `docs/architecture.md`, `.github/agent/prompts/quality.md`(코드 품질 원칙)를 읽어라. 수행할 항목은 아래 "리팩터링 항목"이다.

## 원칙
- **동작을 바꾸지 마라.** 리팩터링 전후로 기능·출력이 같아야 한다. 기존 테스트는 고치지 않고 통과해야 하며, 테스트를 고쳐야 한다면 그 이유를 최종 메시지에 적어라.
- 항목에 적힌 범위만 다뤄라. 범위 밖 정리는 하지 마라.
- 구조가 바뀌면 `docs/architecture.md`를 같이 갱신하고, 큰 결정은 `docs/decisions/`에 기록하라.
- 범위가 너무 커서 한 번에 안전하게 끝낼 수 없으면, 안전한 부분까지만 하고 남은 것을 최종 메시지에 적어라.
- 다음 파일은 수정하지 마라(수정해도 되돌려진다): `.github/**`, `AGENTS.md`, `CLAUDE.md`, `docs/requirements.md`, `docs/tasks.md`, `scripts/agent/**`.
- git commit/push와 PR 생성은 하지 마라. 워크플로가 한다.
- 끝내기 전에 `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`를 실행해 모두 통과하는지 확인하라. `DATABASE_URL`로 PostgreSQL 16을 쓸 수 있다.

## 최종 메시지 (PR 설명으로 쓰인다)
```
## 변경 요약
## 동작이 바뀌지 않았다는 근거   (실행한 명령과 결과)
## 남은 항목
```
