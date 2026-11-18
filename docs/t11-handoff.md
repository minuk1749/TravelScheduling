# T11 생활 설정 인계

기준: 원격 develop `6e1d5cca360b0ce963cae083f4afff438576e34b` = 시작 시 HEAD.
브랜치 `t11-local`, 담당 gpt. 작업표는 이미 진행중이며 명시적 보호 지시에 따라 수정하지 않았다.
커밋·push·PR 생성은 러너가 담당한다. 제목 `T11: 생활 설정 UI`, base `develop`.

## 구현과 검증 대상

- 여행 생성 완료 화면에서 생활 설정으로 이동한다. 여행 URL 재방문 시 인증 후 저장값을 읽는다.
- 기본/날짜별 활동 시각, 0–3끼, 식사 시간대, 택시 정책. 기본값 상속/0끼/날짜 초기화/변경 취소를 제공한다.
- 입력 즉시 시간창 재계산. 저장 오류 시 입력 유지와 재시도, 수정 충돌 409 후 명시적 다시 불러오기.
- 고정 시각·체류시간이 시간창을 벗어나면 날짜·장소 ID와 충돌 표시. 자동 이동/해제하지 않는다.
- SQL 저장은 부모 잠금·revision 검사·트랜잭션. 날짜별 UPSERT는 created_at을 보존한다.
- 상세 계약과 결정: [ADR 0007](decisions/0007-living-settings.md).

| 완료 기준/회귀 | 자동 테스트 |
|---|---|
| 설정 변경 후 시간창 재계산, 끼니 매핑, 기본 상속/0끼, 공항 버퍼 | `tests/living-settings.test.ts` |
| 고정 시간 충돌 표시, 설정 복구 시 해소, 원본 고정 항목 불변 | `tests/living-settings.test.ts`, `tests/living-settings-ui.test.ts` |
| 저장·재조회·충돌 응답, 소유자 검증·오류·CSRF·오래된 수정 차단 | `tests/living-settings-http.test.ts` |
| 실제 DB의 저장/롤백/동시 수정/고정 보존/레거시 변환 | `tests/living-settings-db.test.ts` (PostgreSQL 필요) |
| 375px 화면, 충돌 표시, 저장 오류 재시도, 새로고침 유지 | `tests/e2e/living-settings.spec.ts` (HTTP 목) |

## T12/T13 연결 필요

이 변경은 **전체 동선 재계산 완료가 아니다**. 화면과 응답의 `calculation.scope`는 TIME_WINDOWS다.
공항 이동시간·영업시간·방문 간 이동·식사 체류시간·고정 순서/수단·택시 정책 적용을 포함하는
전체 생성 서비스 연결은 T12/T13에 남는다. T11 완료 기준의 전체 동선 의미는 미충족으로 보고한다.
타 작업의 진행 파일이나 아직 없는 API를 추측해서 변경/호출하지 않았다.

T12는 설정 저장 성공 뒤 최신 trips/day_settings를 읽고 전체 입력 해시를 새로 계산해야 한다.
`settings.revision`은 편집 충돌 방지용이며 itinerary input_hash를 대신하지 않는다.
생성 중 변경 감지와 저장에는 동일한 trips 행 잠금이 필요하다. 오래된 itinerary를 현재 결과로
표시하지 않아야 하며 전체 CONFLICT 결과를 UI에 연결해야 한다.

API 입력 예: `{ revision: GET의 snapshot.revision, settings: 수정한 snapshot.settings }`.
새 공개 타입은 `src/settings/model.ts`, 공용 검증/끼니 매핑은 `src/settings/input.ts`다.
기존 `/api/trips/[id]`의 `{ id }` 응답, T10 생성 DTO, DB 스키마는 바꾸지 않았다.

## 로컬 검증 결과

Node 24.22.3을 임시 npm 캐시에서 실행했다. 기본 셸 Node 26.13.1이나 프로젝트 의존성은 변경하지 않았다.

- `npm run lint`, `npm run typecheck`, `npm run build`: 통과(PWA 산출물 포함).
- `npm test`: 95개 중 77개 통과, 18개 실패, skip 0개. 모든 실패 원인은
  `DATABASE_URL must be set to a PostgreSQL connection string`이다.
  기존 DB 검사 17개와 신규 `living-settings-db.test.ts` 1개가 환경 때문에 실패했다.
  신규 계산/HTTP/UI 7개와 기존 관련 검사·구조 검사는 통과했다.
- `npm run test:e2e`: 기존 3개와 신규 1개 모두 브라우저 시작 전에 실패했다.
  처음에는 Chromium 미설치였고, 임시 경로에 설치한 후에도 Mac 샌드박스의
  `MachPortRendezvousServer ... Permission denied (1100)`로 실행할 수 없었다.
  따라서 375px 브라우저 레이아웃은 자동 테스트를 작성했지만 로컬에서 검증하지 못했다.
- `git diff --check`: 통과. 보호 파일 변경·신규 패키지·commit/push/PR 생성 없음.

재현 시 Node 24에서 필수 명령을 실행하고 PostgreSQL 16의 DATABASE_URL을 지정한다.
Playwright Chromium을 실행할 수 있는 환경에서 `npm run test:e2e`도 실행해야 한다.
실제 로그인 세션과 DB를 통한 설정 저장/재조회는 사람 확인이 필요하다.
