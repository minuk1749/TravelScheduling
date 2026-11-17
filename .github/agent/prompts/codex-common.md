# 작업 지시: {{TASK}} {{TITLE}}

너는 이 저장소의 구현 담당(gpt)이다. **`develop` 브랜치 최신 상태를 기준으로** 작업하라.

먼저 `AGENTS.md`, `docs/requirements.md`, `docs/tasks.md`, 그리고 있으면 `docs/architecture.md`를 읽어라. 작업 범위와 완료 기준은 `docs/requirements.md` §5의 {{TASK}} 행이다.

## 반드시 지킬 것
- **PR 제목은 반드시 `{{TASK}}: `로 시작한다.** (예: `{{TASK}}: {{TITLE}}`) 자동 리뷰가 제목으로 작업을 식별한다.
- PR 대상(base) 브랜치는 `develop`이다.
- 완료 기준의 각 항목을 자동 테스트로 검증하라. `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`가 통과해야 한다.
- 다음 파일은 수정하지 마라. 수정하면 자동 머지되지 않고 사람 검토로 넘어간다: `.github/**`, `AGENTS.md`, `CLAUDE.md`, `docs/requirements.md`, `docs/tasks.md`.
- 새 패키지를 추가하면 `package-lock.json`도 함께 갱신하라. CI는 `npm ci`로 설치한다.
- 비밀 값(API 키 등)을 코드에 넣지 마라. 실제 Google API 키나 OAuth 자격증명이 필요한 부분은 목(mock)이나 픽스처로 테스트하고, 실제 연동 확인은 "사람 확인 필요"에 적어라.
- 요구사항이 모호하면 `docs/questions.md`에 질문과 채택한 가정을 기록하고 진행하라. 요구사항 자체를 바꾸지 마라.
- 작업 범위 밖의 리팩터링은 하지 마라.

## PR 설명 형식
```
## 변경 요약
## 완료 기준 충족 근거   (기준별로 어떤 테스트가 검증하는지)
## 남은 이슈 / 가정
## 사람 확인 필요
## 다음 작업자 인계
```
