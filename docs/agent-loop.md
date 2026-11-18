# 자동 협업 루프 운영 가이드

Codex(ChatGPT 구독)와 Claude(Claude 구독)가 **맡은 작업을 각자 구현하고, 서로의 코드를 리뷰**한다. 담당별로 하나씩 **동시에** 진행한다(선행 작업이 끝난 작업만). API 종량제 비용은 없다.

- 먼저 머지된 작업과 충돌하면 "머지 충돌" 피드백이 작성자에게 가고, 작성자가 develop을 병합해 해결한다.
- Codex 리뷰는 Mac 러너가 하므로, Codex가 구현 중이면 Claude PR 리뷰는 그 뒤에 처리된다.

```
agent-start ─ 다음 작업 이슈 생성 (작업표의 담당 확인)
   │
   ├─ 담당 gpt ──→ Mac 러너: Codex 구현 → PR ──→ agent-review: 테스트 → Claude 리뷰 ─┐
   │                                                                                 │
   └─ 담당 claude → agent-claude: Claude 구현 → PR(owner-claude) → agent-review: 테스트 │
                     → needs-codex-review → Mac 러너: Codex 리뷰 → agent-verdict ─────┤
                                                                                      ▼
                                          판정(.github/agent/decide.sh): 승인 → 머지 → 다음 작업
                                                                       수정 요청 → 작성자가 수정
                                                                       리팩터링 제안 → R번호(Claude 수행, Codex 리뷰)
```

## 규칙 문서

- 모든 작업 원칙: `AGENTS.md`의 "작업 원칙" (Codex는 `AGENTS.md`를, Claude는 `CLAUDE.md`를 통해 같은 내용을 읽는다)
- 프로젝트 구조 요약: `docs/project-structure.md` (`CLAUDE.md`가 함께 불러온다)

## 공통 1회 설정

1. 기본 브랜치: `develop`
2. Repository secrets: `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), `USER_PAT`(cloud 모드에서만 필요)
3. Settings → Actions → General → Workflow permissions: "Read and write permissions", "Allow GitHub Actions to create and approve pull requests"

## Mac 러너 (local 모드) 설정

필요한 것: Node.js 24, git, GitHub CLI(`gh auth login` 완료), Codex CLI(ChatGPT 계정 로그인).

```bash
npm install -g @openai/codex
codex login
gh repo clone minuk1749/TravelScheduling ~/agent-work/TravelScheduling
cd ~/agent-work/TravelScheduling && git checkout develop
bash scripts/agent/install-launchd.sh
```

- `~/agent-work/TravelScheduling`은 **러너 전용 폴더**다. 실행할 때마다 원격 상태로 초기화되므로 여기서 직접 작업하지 않는다.
- 로그: `tail -f ~/Library/Logs/travelscheduling-agent.log`
- 지금 바로 1회 실행: `launchctl kickstart -k gui/$(id -u)/com.travelscheduling.agent`
- 제거: `bash ~/agent-work/TravelScheduling/scripts/agent/install-launchd.sh --uninstall`
- Mac이 잠자기에 들어가면 실행되지 않는다. 화면은 꺼져도 되지만 시스템 잠자기는 막아야 한다(시스템 설정 → 배터리 → 옵션 → 전원 어댑터 연결 시 자동 잠자기 방지). 덮개를 닫으면 잠자기에 들어간다.
- Codex 실행이 **연속 3회 실패**하면(사용 한도 소진, 로그인 만료 등) 러너가 `agent-paused` 이슈를 열고 멈춘다. **사람이 그 이슈를 닫을 때까지 새로 시작하지 않는다.**
- Codex가 배정한 모델과 다른 모델로 실행되면(자동 대체 등) 결과를 PR로 올리지 않고 바로 `agent-paused` 이슈를 열고 멈춘다.

## 사람이 하는 일

| 언제 | 할 일 |
|---|---|
| 처음 한 번 | Actions → agent-start → Run workflow |
| `needs-human` 라벨 PR | 직접 확인 후 처리 |
| `agent-paused` 이슈 | 원인 해결 → 이슈 닫기 → 해당 PR의 agent-review 재실행 |
| 주기적으로 | `docs/questions.md` 확인, `develop` → `main` 검토 후 머지 |
| cloud 모드일 때만 | Codex 결과 댓글 알림이 오면 Codex 화면에서 PR 생성 버튼 클릭 |

## 선택 변수 (Settings → Variables → Actions)

| 변수 | 기본값 | 의미 |
|---|---|---|
| `AGENT_EXECUTOR` | `local` | 구현 주체: `local`(Mac 러너) 또는 `cloud`(Codex 클라우드) |
| `AGENT_MAX_ROUNDS` | 3 | 작업 하나당 리뷰 왕복 상한 |
| `AGENT_PR_AUTHORS` | `chatgpt-codex-connector[bot],저장소 소유자` | 자동 리뷰 대상 PR 작성자(쉼표 구분) |
| `CLAUDE_MODEL` | (비움) | 지정하면 모든 리뷰를 이 모델로. 보통 비워 두고 `.github/agent/models.json`의 작업별 배정을 쓴다 |

## 작업별 모델 (`.github/agent/models.json`)

- `codex`: Mac 러너가 작업 번호로 모델과 추론 강도를 골라 Codex CLI에 넘긴다. 로그의 "Codex 실행 시작 (작업 …, 모델 …, 추론 …)"으로 확인.
- `claude`: agent-review가 작업 번호로 리뷰 모델을 고른다. Actions 실행 화면의 "리뷰 모델" 알림으로 확인.
- `claude.exec_review`: 이 목록의 작업은 **실행 리뷰**. Claude가 테스트를 직접 돌리고, 테스트에 없는 경우를 확인용 스크립트로 실행해 본다. 리뷰 시간과 Claude 사용량이 늘고, Claude 토큰이 있는 리뷰 작업에서 PR 코드가 실행된다(본인 러너가 만든 PR만 대상).
- 이 파일은 보호 파일이라 사람(또는 사람이 지시한 대화형 세션)만 바꾼다.

## 리팩터링 (`agent-claude.yml`)

- 리뷰가 승인하면서 `refactor` 항목을 제안하면(구조 문제로 곧 버그가 나거나 다음 작업을 막을 때만), 다음 작업 대신 리팩터링 이슈 `R번호`를 만들고 Claude(`models.json`의 `claude.refactor`, 기본 Opus)가 수행한다.
- 리팩터링 PR은 사용자 토큰으로 올라가 agent-review(테스트)와 Codex 리뷰를 거친다. 수정 요청은 다시 Claude가 반영하고, 머지되면 원래 작업 순서(agent-start)로 돌아간다.
- 수동 실행: `refactor-task` 라벨 이슈를 제목 `R번호: 내용`으로 만들고 Actions → agent-claude → 이슈 번호 입력.
- 끄기: 저장소 변수 `AGENT_REFACTOR=off`.

## 알려진 제약

- Mac 러너는 저장소 소유자 계정(gh 로그인)으로 PR을 만든다. 그래서 `AGENT_PR_AUTHORS` 기본값에 소유자가 들어 있다.
- 실제 Google API 키와 OAuth가 필요한 확인, 요금 데이터(T4D)는 사람이 한다.
- 비공개 저장소라면 GitHub Actions 사용 시간이 요금제 한도에서 차감된다.
