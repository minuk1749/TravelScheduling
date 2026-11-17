# T7A 인계 / PR 설명

PR 제목: `T7A: 아키텍처 점검과 설계 문서`, base: `develop`.
현재 브랜치 `t7a-local`은 원격 develop `4697318`과 동일한 상태에서 시작했다.
커밋·push·PR 생성은 Mac 러너 스크립트가 담당한다.

## 변경 요약

- [아키텍처](architecture.md)에 현재/후속 구조, 모듈 경계, 데이터 흐름, 코어 및 제공자·저장소 계약,
  시간대·저장 형식·오류 처리, T1–T7 차이 목록을 정리했다.
- [ADR 0001](decisions/0001-pure-core-and-service-boundaries.md),
  [ADR 0002](decisions/0002-time-storage-and-error-contracts.md)에 결정·이유·대안을 남겼다.
- 방문 없는 날의 필수 숙소 이동이 시간창에 들어가지 못해도 `OK`로 처리하던 결함을 수정했다.
  `ScheduleResult.issues`에 날짜 수준 `TIME_WINDOW` 사유를 추가했다.
- 탈퇴 시 모든 여행 소유 테이블 삭제와 공유 장소 보존을 SQL 테스트에서 검증하도록 보강했다.
  README의 현재 구현 상태/마이그레이션/DB 테스트 설명을 정정했다.

## 완료 기준 충족 근거

| 기준 | 검증 |
|---|---|
| 구조·경계·흐름·인터페이스·시간대·오류 문서 | `tests/architecture.test.ts`: 구성과 실제 파일 링크, 계약 TypeScript 블록 strict 검사, 순수 코어 의존 경계 및 금지 의존 음성 테스트 |
| T1–T7 차이 목록, 구체적 결함만 수정 | architecture §7, `tests/scheduler-capacity.test.ts`: 30분 창/60분 이동, 창 없는 숙소 이동, 60분 정확한 경계, 방문 경유로 성공하는 경우 |
| 테스트 누락 보완 | `tests/travel-model.test.ts`: 항공편·숙소·방문 장소·정차 기록을 포함한 사용자 소유 테이블 전부 삭제, 공유 장소 보존 |
| 주요 결정과 범위 준수 | ADR 두 건과 문서 링크 검사. 폴더 이동·새 API·새 패키지·마이그레이션·보호 파일 변경 없음 |

2026-11-18, Node **24.22.3**에서 지정된 명령을 실행했다.

| 명령 | 결과 |
|---|---|
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과. 프로덕션 빌드와 manifest/아이콘/서비스워커 산출물 검사 포함 |
| `npm test` | **45개 중 41개 통과, DB 관련 4개 실패, skip 0개** |

실패한 검사는 `auth.test.ts`의 PostgreSQL 탈퇴 검사, `db.test.ts`의 연결 검사,
`travel-model.test.ts`의 여행 모델/도시 프로필 검사 두 개다. 모두 동일하게
`DATABASE_URL must be set to a PostgreSQL connection string`으로 실패했다.
이 Mac에서 PostgreSQL 실행 파일을 찾지 못했고 `DATABASE_URL`도 설정되지 않았다.
SQL 자체의 실행 성공은 로컬에서 확인하지 못했으므로 **전체 테스트 통과로 보고하지 않는다**.
CI의 PostgreSQL 16에서 네 검사(보강한 삭제 검사 포함)를 반드시 확인해야 한다.

회귀 테스트 두 개는 수정 전에 `OK !== CONFLICT`로 실패하는 것을 확인했고 수정 후 통과했다.
문서/계약/경계, 인증 목, 요금, 전체 스케줄러, 실제 `next start` HTTP/PWA 검사는 모두 통과했다.
코어/패키지/환경 설정을 DB 테스트 우회 목적으로 바꾸지 않았다.

## 남은 이슈 / 가정

- 새 제공자/저장소 타입은 후속 설계 계약이며 아직 런타임 구현이 없다.
- DB `WISHLIST`/코어 `WISH`, 슬롯 집합/mealCount, SQL 시간·numeric·JSONB 모양은 연결 시 명시 변환이 필요하다.
- 일정 결과·식사 슬롯·구간 고정 입력의 저장 필드, 재조회 상한·입력 버전 검증은 T12/T13에서 보완한다.
- 실제 10개 도시 데이터(T4D), 환율, Google 연동과 화면 구현은 이번 범위 밖이다.
- 구체적인 질문과 채택한 가정은 [questions.md](questions.md)에 기록했다.

## 사람 확인 필요

- 실제 OAuth 로그인·로그아웃·탈퇴, Google Places/Routes 자격증명을 이용한 연동은 기존과 같이 별도 확인이 필요하다.
- PostgreSQL 16 환경에서 전체 SQL 테스트 결과를 확인한다. 테스트는 DB가 없어도 건너뛰지 않는다.

## 다음 작업자 인계

- T8은 아키텍처 §4의 장소 포트/캐시 경계부터 구현한다. 최신 약관을 확인해 저장 필드·TTL을 결정하고
  동일 요청의 캐시 적중 시 외부 호출 0회를 검증한다.
- T9는 대표 시각 행렬/실제 출발 시각 구간 조회를 구분하고 TRANSIT 요금 null과 DRIVE→TAXI 변환을 유지한다.
- T10/T11은 SQL 변환·기본값 상속·슬롯 집합 의미를 보존하며 미완성 여행 입력을 조용히 보정하지 않는다.
- T12는 새 날짜 수준 `TIME_WINDOW` issue를 보존하고 외부 장애와 도메인 충돌을 구분한다.
  실제 시각 재조회 뒤 검증한 결과만 저장하며 기존 추천 조합도 재조회 후 다시 확인한다.
- 보호 파일과 `docs/tasks.md`는 지시대로 수정하지 않았다. T7A는 시작 시 이미 `진행중/gpt`였다.
