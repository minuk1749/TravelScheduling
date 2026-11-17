# 반자동 루프 운영 가이드

Codex 클라우드(구현, ChatGPT 구독)와 Claude(리뷰, Claude 구독)가 GitHub에서 작업을 이어서 진행한다.
API 종량제 비용은 없다. Codex 클라우드는 결과를 GitHub에 직접 푸시하지 못하므로 **PR 생성만 사람이 누른다.**

```
agent-start ─ 이슈 생성 + "@codex 구현해 줘" (사용자 토큰)
     │
     ▼
Codex 클라우드 작업 완료 → 이슈/PR에 결과 댓글 (GitHub 알림)
     │
     ▼
[사람] Codex 작업 화면에서 PR 생성 버튼 클릭
     │
     ▼
agent-review ─ 테스트 → Claude 리뷰
     ├─ 승인 → develop 머지 → 다음 작업 agent-start (자동)
     ├─ 수정 요청 → PR에 "@codex 피드백 반영" → [사람] 다시 PR 버튼 클릭
     └─ 3라운드 초과 → needs-human, 작업 보류 → 다음 작업
```

## 1회 설정 (사람)

1. **기본 브랜치:** 저장소가 `develop`을 기본 브랜치로 쓴다(Codex가 기본 브랜치 기준으로 작업하기 때문).
2. **Repository secrets** (Settings → Secrets and variables → Actions → New repository secret)
   - `CLAUDE_CODE_OAUTH_TOKEN`: 내 컴퓨터 터미널에서 `claude setup-token` 실행 결과
   - `USER_PAT`: GitHub Settings → Developer settings → Fine-grained tokens
     - Repository access: **이 저장소만**
     - 권한(Read and write): Contents, Issues, Pull requests, Actions
     - 만료: 30–90일 (만료되면 다시 발급해 갱신)
3. **Actions 권한** (Settings → Actions → General → Workflow permissions)
   - "Read and write permissions"
   - "Allow GitHub Actions to create and approve pull requests" 체크
4. **Codex 환경** (chatgpt.com/codex 환경 설정)
   - 셋업 스크립트: `if [ -f package-lock.json ]; then npm ci; fi`
   - 에이전트 인터넷 접근을 켤 경우 패키지 레지스트리 정도로 제한(새 패키지 설치와 lockfile 갱신에 필요)
   - Codex 자동 코드 리뷰는 끈다(Claude가 리뷰)

## 사람이 하는 일

| 언제 | 할 일 |
|---|---|
| 처음 한 번 | Actions → agent-start → Run workflow |
| Codex 결과 댓글 알림이 오면 | Codex 작업 화면에서 PR 생성 버튼 클릭 |
| `needs-human` 라벨 PR | 직접 확인 후 처리 |
| `agent-paused` 이슈 | 원인 해결 → 이슈 닫기 → 해당 PR의 agent-review 재실행 |
| 주기적으로 | `docs/questions.md` 확인, `develop` → `main` 검토 후 머지 |

## 선택 변수 (Settings → Variables → Actions)

| 변수 | 기본값 | 의미 |
|---|---|---|
| `AGENT_MAX_ROUNDS` | 3 | 작업 하나당 리뷰 왕복 상한 |
| `AGENT_PR_AUTHORS` | `chatgpt-codex-connector[bot],저장소 소유자` | 자동 리뷰 대상 PR 작성자(쉼표 구분) |
| `CLAUDE_MODEL` | (액션 기본값) | Claude 리뷰 모델 |

## 알려진 제약

- Codex의 수정 결과가 기존 PR 갱신이 아니라 새 PR로 올 수 있다. 같은 작업 번호의 새 PR이 열리면 이전 PR은 자동으로 닫히고, 대상 브랜치가 develop이 아니면 develop으로 바꾼다.
- Codex 사용 한도(ChatGPT 구독)가 소진되면 Codex가 응답하지 않는다. 한도가 다시 차면 해당 이슈나 PR에 `@codex` 댓글을 다시 달면 된다.
- 실제 Google API 키와 OAuth가 필요한 확인, 요금 데이터(T4D)는 사람이 한다.
- 비공개 저장소라면 GitHub Actions 사용 시간이 요금제 한도에서 차감된다.
