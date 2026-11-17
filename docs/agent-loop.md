# agent-loop 운영 가이드

Codex(구현)와 Claude(리뷰)가 GitHub Actions에서 작업을 이어서 진행하는 자동 루프.

## 1회 설정 (사람)

1. **API 키 등록:** Settings → Secrets and variables → Actions → Secrets
   - `OPENAI_API_KEY` (Codex)
   - `ANTHROPIC_API_KEY` (Claude)
2. **사용량 상한 설정 (실제 비용 차단):**
   - OpenAI: platform.openai.com의 프로젝트 예산(budget) 설정
   - Anthropic: console.anthropic.com의 워크스페이스 지출 한도(spend limit) 설정
   - 상한에 도달하면 API 호출이 실패하고, 루프는 `agent-paused` 이슈를 열고 멈춘다.
3. **Actions 권한:** Settings → Actions → General → Workflow permissions
   - "Read and write permissions" 선택
   - "Allow GitHub Actions to create and approve pull requests" 체크 (자동 PR 생성에 필수)
4. **브랜치 보호(권장):** `main`은 PR 필수로 보호. `develop`에는 "필수 상태 검사"를 걸지 않는다(루프의 PR에는 ci 워크플로가 실행되지 않으므로 머지가 막힘).

## 선택 변수 (Settings → Variables → Actions)

| 변수 | 기본값 | 의미 |
|---|---|---|
| `AGENT_NIGHT_BUDGET` | 12 | 한 번의 체인(예약 실행 1회)에서 돌 수 있는 최대 라운드 수. 1라운드 = Codex 1회 + Claude 1회 |
| `AGENT_MAX_ROUNDS` | 3 | 작업 하나당 리뷰 왕복 상한 |
| `CODEX_MODEL`, `CODEX_EFFORT` | (Codex 기본값) | Codex 모델과 추론 강도 |
| `CLAUDE_MODEL` | (액션 기본값) | Claude 리뷰 모델 |

## 실행·중지·재개

- **자동 시작:** 매일 23:17 KST (GitHub 예약 실행은 수십 분 지연될 수 있음)
- **수동 시작:** Actions → agent-loop → Run workflow
- **즉시 중지:** `agent-paused` 라벨을 단 이슈를 아무거나 하나 연다. 진행 중인 라운드는 끝까지 돌고 다음 라운드부터 멈춘다.
- **재개:** `agent-paused` 이슈를 닫는다. 다음 예약 실행부터 재개되고, 바로 재개하려면 수동으로 실행한다. 진행 중이던 PR이 있으면 그 PR부터 이어서 처리한다.

## 아침에 확인할 것

1. `agent-paused` 이슈: 멈춘 이유(한도 소진, 키 오류 등)
2. `needs-human` 라벨 PR: 3라운드 안에 합의하지 못한 작업
3. `docs/questions.md`: 에이전트가 남긴 질문과 가정
4. PR 설명의 "사람 확인 필요": 실제 API 키·OAuth 연동 확인 등
5. `develop` → `main` PR을 만들어 검토 후 머지

## 알려진 제약

- Codex 샌드박스에는 네트워크가 없다. 새 패키지는 `package.json`에만 추가되고, 설치와 lockfile 갱신은 파이프라인이 한다. 그래서 Codex가 새 패키지를 쓰는 코드를 직접 실행해 보지 못할 수 있다(테스트 실패 시 다음 라운드에서 수정).
- 실제 Google API 키와 OAuth가 필요한 확인, 요금 데이터(T4D)는 자동 루프 대상이 아니다.
- 비공개 저장소라면 GitHub Actions 사용 시간이 요금제 한도에서 차감된다.
- 자동 루프의 커밋으로는 `ci` 워크플로가 실행되지 않는다. 같은 검사를 agent-loop 안에서 수행한다.
