# T8A: DB 기반 정비 (마이그레이션·인덱스·시각 열)

## 변경 요약

- `npm run migrate`: SQL 적용 이력·SHA-256, 기존 001–003 스키마 자동 등록, 실행 전체 트랜잭션과 동시 실행 잠금.
- 004: 누락된 FK 인덱스, 사용자 소유 행의 생성·수정 시각과 UPDATE 트리거, 일정 생성 번호 및 최신 조회 인덱스.
- 인증·여행 DB 테스트 준비를 실행기로 전환. README·아키텍처 §5·ADR 0004·질문/가정 기록 갱신.
- 새 의존성 없음. 기존 001–003 SQL 및 보호 파일 변경 없음. 브랜치 `t8a-local`, PR base `develop`.

## 완료 기준 충족 근거

| 기준 | 자동 검증 |
|---|---|
| ① 빈 DB/기존 DB에서 남은 것만 순서대로 적용, 재실행 무변경, 실패 롤백 | `tests/migrations.test.ts`: CLI 빈 스키마 및 001/001–002/001–003 각각의 baseline·원본 데이터 보존·두 번째 실행, 이력 있는 DB 업그레이드, DDL/DML/이력 롤백과 재시도, 동시 실행 |
| ② 모든 FK 열의 선두 인덱스 | `tests/database-foundations.test.ts`: pg_constraint/pg_attribute/pg_index 전체 카탈로그 검사. 부분/무효 인덱스 제외 |
| ③ 생성·수정 시각과 갱신 방식 | 같은 테스트의 모든 소유 테이블 타입/NULL/default 검사, INSERT 기본값, 모든 UPDATE 및 인증·날짜 설정 UPSERT, 도시 출처 갱신일 보존 |
| ④ 여행별 최신 일정 | 같은 생성 시각의 여러 결과에서 여행별 generation 최댓값 선택, 과거 일정 수정 후 최신 유지, 과거 결과/하위 행 보존 |
| ⑤ 테스트·CI 준비와 문서 | auth/travel-model 테스트가 migrate 호출, CLI 통합 테스트는 npm run migrate 실행. architecture 테스트가 문서·ADR 링크와 계약 검사 |

2026-11-18, Node **24.22.3** / Docker PostgreSQL **16.16**에서 실행했다.
`npm run lint`, `npm run typecheck`, `npm run build`, `npm test`가 모두 통과했다.
전체 **67개 통과, 0개 실패, 0개 건너뜀**이며 프로덕션 HTTP/PWA 검사도 포함한다.
DB는 테스트용 `DATABASE_URL`로 연결했고 외부 API는 기존 목/픽스처를 사용했다.

## 남은 이슈 / 가정

- 이력 없는 자동 등록은 기존 001–003의 온전한 스키마만 지원한다. 수동 변경/부분 적용은 실패하며 사람이 구조를 대조해야 한다.
- 과거 시각이 없던 행은 이관 시각으로 채우며, 기존 일정의 generation은 과거 생성 순서를 보장하지 않는다.
- generation은 전역 INSERT 순서이고 커밋 순서/입력 버전이 아니다. 자식 수정은 trips.updated_at을 갱신하지 않는다.

## 사람 확인 필요

- 실제 DB 이관 시 앱 쓰기를 멈추고 DDL 권한 및 최초 baseline용 DB CREATE 권한을 확인한다.
- 기존 일정의 실제 최신 순서가 중요하면 이관 뒤 새 일정을 생성한다.
- 새 Google/OAuth 연동 변경은 없다. 실제 API 키 없이 검증한다.

## 다음 작업자 인계

- SQL은 `005_name.sql`부터 연속 번호로 추가하고 실행기를 사용한다. 적용된 파일을 수정하지 않는다.
- 최신 결과: `SELECT ... FROM itineraries WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1`.
- T12는 여행 행 잠금과 입력 해시 재검증으로 동시 저장과 stale 계산을 처리한다. 생성·수정 시각은 입력 버전 대용이 아니다.
- T12/T13의 일정 상세 필드 부족은 기존 아키텍처 인계를 유지한다. 시각은 IANA 여행 시간대와 함께 해석한다.
- 커밋·푸시·PR 생성은 Mac 러너가 담당한다. PR 제목은 `T8A: DB 기반 정비 (마이그레이션·인덱스·시각 열)`, base는 `develop`이다.
