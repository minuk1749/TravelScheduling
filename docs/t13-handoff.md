# T13 결과 UI 인계

## 변경 요약

- 결과 화면의 지도/타임라인/구간 대안/전체 효율, 초과→필수 선택→재검증.
- 희망 마커/목록에서 날짜·시각·순서 지정, 일상/공항 구간 수동 수단 저장과 반복 계산 유지.
- 생활 설정 저장 뒤 전체 동선 검증 연결. 실패 시 저장된 설정과 편집 초안 보존.
- 보호 파일과 T12B의 day-plan/days 파일은 수정하지 않음. 커밋/푸시/PR은 러너 담당.

## 공개 API·데이터 형식·기존 동작 변경

- GET/PUT `/api/trips/[id]/constraints`, `/trips/[id]/result` 추가.
- 마이그레이션 006: `trips.leg_modes` 추가. 기존 방문 제약 열 재사용.
- 동선 생성 응답에 `inputHash` 추가. 기존 필드는 유지.
- 브라우저 지도용 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` 추가. 서버 키와 분리.
- 재접속 시 입력은 복원하고 결과는 버튼으로 재생성한다.

## 검증 결과

Node 24.22.3을 `/private/tmp`에 설치해 실행했다. 기본 Node는 26이다.

- `npm run lint`, `npm run typecheck`, `npm run build`: 통과(PWA 검사 포함).
- `npm test`: 134개 중 111 통과, 23 실패. 실패는 모두 `DATABASE_URL` 미설정인 DB 검사(기존 22개 + 신규 T13 SQL 1개). skip/삭제 없음. 비DB 새 실패 없음.
- `npm run test:e2e -- tests/e2e/result.spec.ts tests/e2e/living-settings.spec.ts`: 브라우저 설치 후에도 Mac sandbox의 `bootstrap_check_in … Permission denied (1100)`로 Chromium이 시작하지 못함. UI 시나리오 본문/스크린샷은 실행하지 못했으며 통과로 주장하지 않는다.
- `git diff --check`: 통과.

| T13 완료 기준 | 자동 테스트 |
|---|---|
| 희망 장소 구분 마커·날짜 추가 | `result-ui.test.ts`: 가짜 지도 어댑터로 마커 클릭→날짜 지정. `result-constraints.test.ts`: 실제 서비스가 고정 희망을 날짜에 배치 |
| 구간 대중교통/택시 비교 | `result-ui.test.ts`: 대안 시간·추정 요금 렌더링, `result-constraints.test.ts`: 미상 요금/현지 시각 |
| 초과→선택→재검증 | `result-constraints.test.ts`, `result-ui.test.ts`: 실제 계산 서비스 + 가짜 외부 제공자로 OVER_CAPACITY→추천 선택→OK |
| 재계산 뒤 수정 유지 | `result-constraints.test.ts`: 날짜·시각·순서, 일상/공항 수단 고정 반복 계산. `result-ui.test.ts`: 실패/재시도/재조회 보존. `result-db.test.ts`: SQL 반복 생성/충돌/원자성(CI 실행 필요) |
| 모바일 화면 | `tests/e2e/result.spec.ts`: 375px 조작/넘침/재접속 검사(Mac sandbox로 실행 불가) |
| 권한·입력 경계 | `result-http.test.ts`: 401/403/404, CSRF/JSON/400/409/502/503/500. `result-constraints.test.ts`: 소속/중복/기간/DST/잘못된 수단 |

## 남은 문제

DB 영속화·마이그레이션과 실제 브라우저 레이아웃은 실행 가능한 CI/환경에서 검증해야 한다. Google 지도 실제 렌더링은 키가 없어 가짜 어댑터로 검사했다. 기존 T4D 도시 요금/환율 데이터 준비 상태는 그대로다.

## 사람 확인 필요

PostgreSQL 16에서 006 적용과 전체 테스트, 허용된 브라우저 환경에서 E2E 실행. Google Cloud의 브라우저 키/지도 ID 설정과 referrer/API 제한, 실제 OAuth·장소·경로·지도 표시 확인.
