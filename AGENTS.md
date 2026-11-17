# 작업 규칙 (모든 AI 에이전트 공통)

이 파일은 Claude와 GPT(Codex 등) 모두가 따르는 공통 규칙이다. 도구별 파일(CLAUDE.md 등)에 규칙을 따로 적지 않는다.

## 기준 문서
- 요구사항과 계획: `docs/requirements.md` (확정/추천/미정 구분 유지)
- 작업 상태와 담당: `docs/tasks.md`
- 설계 결정 기록: `docs/decisions/NNNN-제목.md` (결정, 이유, 대안)

## 작업 방식
1. 작업 시작 전에 `docs/tasks.md`에서 해당 작업을 `진행중`으로 바꾸고 담당(claude/gpt)과 브랜치를 기록한다.
2. 작업 하나에 브랜치 하나: `t{번호}-{짧은-설명}` (예: `t5-scheduler-timewindow`).
3. 다른 에이전트가 `진행중`인 작업의 파일은 수정하지 않는다.
4. 완료 기준(`docs/requirements.md` §5)을 테스트로 충족한 뒤 PR을 연다. CI 통과가 머지 조건이다.
5. PR 설명에는 변경 요약, 완료 기준 충족 근거, 남은 이슈와 다음 작업자를 위한 인계 내용을 적는다.
6. 요구사항이 바뀌면 `docs/requirements.md`와 결정 기록을 같은 PR에서 함께 수정한다.

## 코드 규칙
- TypeScript strict. 스케줄러(`src/scheduler/`)는 외부 API나 DB에 의존하지 않는 순수 함수로 유지한다.
- 시각은 항상 IANA 시간대와 함께 다룬다.
- API 키 등 비밀 값은 커밋하지 않는다(`.env.local` 사용, `.env.example`만 커밋).
