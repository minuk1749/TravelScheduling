# 자동 협업 루프 운영 가이드

Codex(ChatGPT 구독)와 Claude(Claude 구독)가 **맡은 작업을 각자 구현하고, 구현과 분리된 세션에서 두 에이전트가 각각 리뷰**한다. 담당별로 하나씩 **동시에** 진행한다(선행 작업이 끝난 작업만). API 종량제 비용은 없다.

- 먼저 머지된 작업과 충돌하면 "머지 충돌" 피드백이 작성자에게 가고, 작성자가 develop을 병합해 해결한다.
- Codex 리뷰는 Mac 러너가 하므로, Codex가 구현 중이면 Claude PR 리뷰는 그 뒤에 처리된다.

```
agent-start → 작업표의 담당이 구현 → 필수 검사 → 커밋·푸시와 PR
  → agent-review 필수 검사 → Claude 리뷰 → Mac 러너 Codex 리뷰
  → agent-verdict가 같은 커밋의 두 판정을 결합
     ├─ 둘 다 승인 → develop 머지 → 다음 작업
     ├─ 수정 요청 → 작성자에게 피드백
     └─ 근거 부족 → 사람 확인
```

## 규칙 문서

- 모든 작업 원칙: `AGENTS.md`의 "작업 원칙" (Codex는 `AGENTS.md`를, Claude는 `CLAUDE.md`를 통해 같은 내용을 읽는다)
- 프로젝트 구조 요약: `docs/project-structure.md` (`CLAUDE.md`가 함께 불러온다)

## 공통 1회 설정

1. 기본 브랜치: `develop`
2. Repository secrets: `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), `USER_PAT`(Claude 구현 PR 게시·작업 재개와 cloud 요청에 필요)
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
- 기존 설치는 새 코드가 `develop`에 머지된 후 `develop` 버전의 `install-launchd.sh`를 한 번 다시 실행한다. 이후 launchd는 매 실행 시 원격 `develop`의 러너 스크립트를 불러온다.
- 전환 전에 이미 리뷰 대기 중인 PR은 새 커밋 푸시 또는 PR을 닫았다가 다시 여는 방법으로 새 검사 실행을 만든다. 예전 댓글과 라벨만 있는 PR에는 새 요청 기록이 없다. 수정한 잡만 재실행하면 같은 시도의 테스트 기록이 없을 수 있으므로 재검증 때는 전체 잡을 다시 실행한다.
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
| `agent-paused` 이슈 | 원인 해결 → **이슈 닫기만 하면 자동 재개** (Codex: 러너가 다음 실행에서 재개, Claude 작업: agent-resume이 다시 실행하며 이전 규칙에서 자체 리뷰를 건너뛴 PR은 먼저 재검사, 테스트·리뷰 실패: agent-resume이 PR을 다시 열어 재실행) |
| 주기적으로 | `docs/questions.md` 확인, `develop` → `main` 검토 후 머지 |
| cloud 모드일 때만 | Codex 결과 댓글 알림이 오면 Codex 화면에서 PR 생성 버튼 클릭 |

## 선택 변수 (Settings → Variables → Actions)

| 변수 | 기본값 | 의미 |
|---|---|---|
| `AGENT_EXECUTOR` | `local` | 구현 주체: `local`(Mac 러너) 또는 `cloud`(Codex 클라우드) |
| `AGENT_MAX_ROUNDS` | 3 | 작업 하나당 리뷰 왕복 상한 |
| `AGENT_PR_AUTHORS` | `chatgpt-codex-connector[bot],저장소 소유자` | 자동 리뷰 대상 PR 작성자(쉼표 구분) |
| `AGENT_CODEX_REVIEW_ACTOR` | 저장소 소유자 | Mac에서 리뷰 판정을 Actions에 제출할 수 있는 GitHub 로그인. 지정하면 Mac의 `gh`도 그 계정으로 인증해야 한다. |
| `CLAUDE_MODEL` | (비움) | 지정하면 모든 리뷰를 이 모델로. 보통 비워 두고 `.github/agent/models.json`의 작업별 배정을 쓴다 |

## 작업별 모델 (`.github/agent/models.json`)

- `codex`: Mac 러너가 작업 번호로 모델과 추론 강도를 골라 Codex CLI에 넘긴다. 로그의 "Codex 실행 시작 (작업 …, 모델 …, 추론 …)"으로 확인.
- `claude`: agent-review가 작업 번호로 리뷰 모델을 고른다. Actions 실행 화면의 "리뷰 모델" 알림으로 확인.
- `claude.effort`: Claude의 모든 실행(구현·리팩터링·리뷰)에 쓰는 추론 강도(`--effort`). 기본 `high`. `tasks`에 작업별 값을 둘 수 있다. 높을수록 결과가 꼼꼼해지지만 Claude 사용량이 늘어 한도에 빨리 닿는다.
- 테스트는 비밀 값이 없는 별도 Actions 잡이 실행한다. Claude와 Codex 리뷰에서는 PR을 읽고 해당 커밋의 CI 로그를 확인한다. 테스트 재실행과 정적 검토를 혼동하지 않도록 판정에 `code`, `ci`, `unverified` 근거를 기록한다.
- 이 파일은 보호 파일이라 사람(또는 사람이 지시한 대화형 세션)만 바꾼다.

## 리팩터링 (`agent-claude.yml`)

- 리뷰가 승인하면서 `refactor` 항목을 제안하면(구조 문제로 곧 버그가 나거나 다음 작업을 막을 때만), 다음 작업 대신 리팩터링 이슈 `R번호`를 만들고 Claude(`models.json`의 `claude.refactor`, 기본 Opus)가 수행한다.
- 리팩터링 PR은 사용자 토큰으로 올라가 agent-review의 검사와 Claude 자체 리뷰, Mac 러너의 Codex 교차 리뷰를 거친다. 수정 요청은 다시 Claude가 반영하고, 머지되면 원래 작업 순서(agent-start)로 돌아간다.
- 수동 실행: `refactor-task` 라벨 이슈를 제목 `R번호: 내용`으로 만들고 Actions → agent-claude → 이슈 번호 입력.
- 끄기: 저장소 변수 `AGENT_REFACTOR=off`.

## 구현이 중간에 실패했을 때 (Claude·Codex 공통)

- 두 러너 모두 변경 내용을 준비하고 CI와 같은 필수 검사와 E2E를 통과한 후보를 작업 PR에 게시한다. 중단된 작업은 저장된 WIP에서 이어서 진행할 수 있다.
- Claude 실행 뒤 중단되면 후보를 `wip/claude/<작업>-<이슈>/<pr번호 또는 new>/<실행번호>.<시도>-<원래 HEAD>`에 보관한다. 필수 검사 통과 뒤 게시가 실패하면 검사한 Git 트리를, 그 전에 중단되면 보호 파일을 정리한 작업 내용을 보관한다.
  - 구현 잡은 쓰기 토큰 없이 후보 커밋을 Git 번들로 만든다. 독립된 검증 잡은 보호 파일을 워크플로의 `develop` 커밋과 대조하고, 컨테이너에 복사한 파일의 Git 트리가 후보와 일치하는지 확인한 뒤 lint·typecheck·build·test·E2E를 실행한다.
  - 게시 잡은 새 러너에서 같은 번들을 bare 저장소로 읽고 검증 잡이 반환한 커밋 SHA와 대조한다. PR의 현재 HEAD와 검사 기록은 읽기 전용 Actions 토큰으로 확인한다. `USER_PAT`는 이 잡에서 검증된 커밋을 올리고 PR을 갱신할 때 사용한다.
  - 검증·게시가 실패하면 별도 보관 잡이 Actions 토큰으로 같은 번들을 WIP 브랜치에 저장하고 중단 이슈를 연다. 게시·보관 러너는 후보 코드를 실행하지 않는다.
  - 수정 라운드는 작업·이슈·PR 번호와 원래 HEAD가 일치하는 최신 WIP에서 재개한다. 원래 HEAD 기록이 없는 구형 PR WIP는 수동 확인용으로 남긴다. 구형 신규 작업의 `wip/<작업>-<실행번호>`는 신규 작업에서만 재개할 수 있다.
  - 재개한 후보는 격리된 필수 검사와 E2E를 다시 통과해야 한다. 게시 성공 후에는 같은 출처에서 게시한 커밋에 포함된 WIP만 정리한다.
- 열린 작업 PR은 그 커밋에서 일반 CI와 `agent-review`의 필수 검사·Claude 리뷰가 끝나야 수정본을 게시할 수 있다. 통과한 검사에서 리뷰어가 코드 수정을 요청한 경우에는 담당자가 수정하고 다시 검증한다.
- Claude 실행이 실패하면 `agent-paused` 이슈에 실행 링크가 남는다. Mac 러너는 테스트용 `DATABASE_URL`이 주어지면 해당 DB를 사용하고, 비어 있으면 Docker로 임시 PostgreSQL 16을 시작한다. 게시 전 검사 실패 시 일시중단 이슈를 열고, 실패한 명령은 Mac 러너 로그에 남긴다.

## 리뷰 판정과 머지

- 대상은 `develop`을 base로 하는 진행 중 작업 PR이다. T번호의 구현 담당은 기준 브랜치의 작업표에서 가져온다. `owner-claude`는 진행 상황 표시와 기존 구현 러너의 분류에 사용한다.
- 필수 검사에서 `lint`, `typecheck`, `build`, `test`가 없거나 명령 하나라도 실패하면 검사는 실패한다. `agent-review`는 검사 성공 후 PR 번호·커밋·실행과 실행 시도를 담은 기록을 만든다. 모든 작업에 Claude 판정을 포함한다. Codex도 같은 커밋을 따로 리뷰하며 두 판정이 모두 승인일 때 머지한다.
- Mac 러너는 해당 기록을 읽고 권한이 있는 GitHub 계정으로 `agent-verdict`에 결과를 제출한다. PR 댓글은 표시용이다. 최종 단계는 원래 Actions 실행의 테스트 성공과 기록을 대조하고, `decision-record`에 판정 근거를 남긴 뒤 GitHub에 같은 커밋을 머지하도록 요청한다.
- 두 리뷰어는 기준 브랜치의 같은 판정 지침을 받는다. Claude가 반환한 JSON이 검증에 실패하면 같은 커밋·도구·스키마로 리뷰를 한 번 더 실행한다. 두 번째 기록도 유효하지 않으면 중단한다. 유효한 수정 요청과 사람 확인 판정은 그대로 처리한다.
- 완료 근거가 부족해 `needs_human`으로 판정되면 PR을 보류한다. 사람이 검토한 뒤 직접 판정하거나, `needs-human`을 해제하고 전체 검사를 다시 시작한다.
- GitHub 소유자 계정은 기본적으로 리뷰 제출 권한도 갖는다. 구현 계정과 제출 계정을 분리하려면 `AGENT_CODEX_REVIEW_ACTOR`와 러너 인증을 전용 계정으로 구성한다. 이 권한은 브랜치 보호와 별개다.

## 알려진 제약

- Mac 러너는 저장소 소유자 계정(gh 로그인)으로 PR을 만든다. 그래서 `AGENT_PR_AUTHORS` 기본값에 소유자가 들어 있다.
- 실제 Google API 키와 OAuth가 필요한 확인, 요금 데이터(T4D)는 사람이 한다.
- 비공개 저장소라면 GitHub Actions 사용 시간이 요금제 한도에서 차감된다.
