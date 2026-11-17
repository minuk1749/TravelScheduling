# T1: 프로젝트 골격

PR 대상: `develop`. 커밋·푸시·PR 생성은 Mac 러너가 수행한다.

## 변경 요약

- Next.js App Router / React / TypeScript strict 프로젝트와 한국어 기본 화면 추가.
- manifest, 192·512px PNG 아이콘, 프로덕션 서비스워커 등록 추가. 오프라인 제외 요구사항에 맞춰 네트워크만 사용.
- PostgreSQL 연결 풀 팩터리와 필수 DB 연결 테스트 추가.
- Node 24, ESLint, 타입 검사, 빌드 및 Node test runner 기반 테스트 설정. package-lock.json 포함.
- 기존 agent-review CI의 Node 24 / PostgreSQL 16 설정을 그대로 사용.

## 완료 기준 충족 근거

- 스크립트: `npm ci` 후 `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` 실행. 타입 검사는 Next.js 타입 생성 후 strict tsc로 검증.
- 빌드 PWA: `scripts/verify-pwa.mjs`가 생성된 manifest, 아이콘 크기와 서비스워커 구문을 검사한다. `tests/pwa.test.ts`는 실제 프로덕션 서버에서 HTML manifest 연결과 manifest·아이콘·서비스워커 응답, 캐시 방지 헤더를 검증한다.
- 서비스워커: `tests/service-worker.test.ts`가 설치·활성화 및 캐시 없는 네트워크 전달을 검증한다.
- DB: `tests/db.test.ts`가 `DATABASE_URL`로 실제 PostgreSQL에 연결해 `SELECT 1`, `version()`을 검증한다. DB 미설정/접속 실패는 테스트 실패로 처리한다. Docker PostgreSQL 16에서 검증했다.

## 남은 이슈 / 가정

- 스키마와 마이그레이션은 T3, Google 인증은 T2 범위이다.
- 기본 Mac Node는 26이므로 임시 설치한 Node 24.22.3으로 검증했다. 저장소에는 `.nvmrc`와 `engines.node=24.x`를 지정했다.
- `npm audit`은 개발 도구의 picomatch 전이 의존성에서 high 14건을 보고한다. `npm audit --omit=dev`는 0건이다. 개발 의존성 패치 추적이 필요하다.
- 보호 파일은 변경하지 않았다. T1은 이미 진행중/gpt 상태이며 브랜치 칸 갱신은 러너에 맡긴다.

## 사람 확인 필요

- HTTPS 배포 후 실제 대상 브라우저에서 홈 화면 설치와 서비스워커 등록 확인. 호스팅 결정 및 배포는 사람 범위이다.

## 다음 작업자 인계

- README.md의 개발/테스트 절차를 사용한다. `npm test` 전에 프로덕션 빌드가 필요하다.
- 테스트 프로세스에는 `DATABASE_URL`을 명시적으로 제공한다. Next.js 개발 서버의 `.env.local` 자동 로드와 구분한다.
- `src/lib/db.ts`는 명시적 팩터리이며 사용자가 풀 재사용과 종료를 관리한다. 빌드 시 DB 연결은 필요 없다.
- 배포 시 `.next`와 `public`을 함께 포함한다. 서비스워커는 개인정보와 API 응답을 캐시하지 않는다.
