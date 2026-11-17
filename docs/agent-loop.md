# 자동 루프 운영 가이드

Codex(구현, ChatGPT 구독)와 Claude(리뷰, Claude 구독)가 GitHub에서 작업을 이어서 진행한다. API 종량제 비용은 없다.

```
agent-start (Actions) ─ 다음 작업 이슈 생성
     │
     ▼
구현 주체 (저장소 변수 AGENT_EXECUTOR)
  local (기본) : Mac 러너가 1시간마다 이슈를 확인 → Codex CLI 구현 → 브랜치 푸시 → PR 생성
  cloud        : 이슈에 @codex 요청 → [사람] Codex 화면에서 PR 생성 버튼
     │
     ▼
agent-review (Actions) ─ 테스트 → Claude 리뷰
     ├─ 승인 → develop 머지 → 다음 작업 agent-start (자동)
     ├─ 수정 요청 → PR에 피드백 댓글 → 구현 주체가 수정 (local: 다음 러너 실행 때 자동)
     └─ 3라운드 초과 → needs-human, 작업 보류 → 다음 작업
```

두 구현 주체를 동시에 쓰지 않는다. 전환은 Settings → Secrets and variables → Actions → Variables에서 `AGENT_EXECUTOR`를 `local` 또는 `cloud`로 바꾸면 된다(없으면 `local`).

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
- Codex 사용 한도에 걸리면 그 회차는 실패하고 다음 시간에 다시 시도한다.

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
| `CLAUDE_MODEL` | (액션 기본값) | Claude 리뷰 모델 |

## 알려진 제약

- Mac 러너는 저장소 소유자 계정(gh 로그인)으로 PR을 만든다. 그래서 `AGENT_PR_AUTHORS` 기본값에 소유자가 들어 있다.
- 실제 Google API 키와 OAuth가 필요한 확인, 요금 데이터(T4D)는 사람이 한다.
- 비공개 저장소라면 GitHub Actions 사용 시간이 요금제 한도에서 차감된다.
