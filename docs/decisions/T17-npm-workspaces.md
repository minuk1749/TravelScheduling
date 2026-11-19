# T17 npm workspaces 전환

기준: 원격 develop `9512b21`, 작업 브랜치 `t17-local`. [구조](../project-structure.md), [아키텍처 §13.1](../architecture.md#131-모노레포-폴더-구조와-패키지-책임).

## 결정

- T16의 네 패키지 이름과 경계를 따른다. 서버·기존 웹·마이그레이션·PWA·Playwright를 `apps/server`로 옮긴다.
  `scripts/agent`, `.github`, 공통 문서, 단일 lockfile은 루트에 둔다. 보호 파일은 수정하지 않는다.
- scheduler·fare와 공용 DTO·검증·설정 계산·표시 변환은 `packages/core/src`가 유일한 구현이다.
  저장소·제공자 포트, 저장/생성 결과 상태와 서버 오류는 서버에 남긴다. 기존 서버 모듈은 core를 재내보낸다.
  함수와 오류 클래스의 런타임 동일성을 유지하므로 `instanceof`·기존 import 계약도 유지한다.
- core는 `scheduler`, `fare`, `contracts/*`, `presentation` 하위 경로에서 TS 원본을 export한다.
  Next의 `transpilePackages`가 서버와 브라우저 번들을 만들고, core 자체 빌드는 JS·선언 파일을 `dist`에 만든다.
  원본 export 덕분에 작업 순서나 낡은 dist에 의존하지 않고 검사할 수 있다. 배포용 독립 npm 패키지는 현재 범위가 아니다.
- 공통 strict 설정은 `tsconfig.base.json`에 둔다. core 소스에는 ES 라이브러리만 허용하고 `types: []`로 Node/DOM 전역을 주입하지 않는다.
  core 테스트용 설정에서만 Node 타입을 추가한다. 외부 런타임 의존성은 기존 Temporal 하나다.
- 루트 lint·typecheck·build·test·migrate는 `npm run <script> --workspaces --if-present`로 실행한다.
  migrate는 서버만 구현한다. dev·start·test:e2e는 서버로 인자를 전달한다. CI 수정은 필요 없다.
- `apps/mobile`·`packages/design-tokens`는 README·package.json으로 예약한다. 실제 앱·토큰 값은 T20 완료 기준이므로
  이번 작업에서 만들지 않으며 빈 성공 스크립트도 추가하지 않는다. T20에서 추가한 검사가 루트 명령에 자동 포함된다.
- 환경 파일 위치는 `apps/server/.env.local`이다. 루트 `.env.example`을 여기에 복사한다.
  CLI·테스트의 `DATABASE_URL`은 기존대로 프로세스 환경 변수에서 읽는다. SQL 파일 내용·체크섬은 바꾸지 않는다.

## 이유

공용 코드가 서버 포트를 가져오면 모바일 번들에 서버 구현이 섞이기 쉽다. DTO·포트를 나누고 공개 하위 경로만 쓰면
계산·검증을 복제하지 않고 두 앱이 재사용할 수 있다. 기존 경로의 재내보내기는 T18 이후 서버 작업과 기존 테스트를 유지한다.
워크스페이스 위임은 현재 CI 명령을 보존하면서 후속 앱 검사도 빠뜨리지 않는다. 예약 패키지에 가짜 검사를 두지 않아 T20 상태도 분명하다.

## 대안

- 모든 import를 한 번에 core 경로로 변경: T16의 호환 재내보내기 방침과 다르고 변경 범위가 커져 채택하지 않는다.
- 빌드된 dist만 export: 모든 검사 전에 core 빌드가 필요하고 변경 뒤 낡은 산출물을 읽을 수 있어 지금은 쓰지 않는다.
- 서버 포트까지 공용으로 이동: 모바일에서 쓰지 않는 I/O 계약이 섞여 경계를 흐리므로 서버에 남긴다.
- Expo·디자인 값을 함께 구현: T20 범위이므로 예약 패키지만 만든다.

## 검증

- 기존 scheduler·fare 테스트는 core에서, HTTP·DB·UI·PWA·Playwright 테스트는 서버에서 실행한다.
- [순수성·문서 계약 검사](../../apps/server/tests/architecture.test.ts)는 core 전체의 Node·DB·네트워크·플랫폼·암묵적 시각 의존을 거부한다.
- [계층 검사](../../apps/server/tests/architecture-layers.test.ts)는 패키지 export를 따라 순환과 클라이언트의 전이 서버 의존을 검사한다.
- [워크스페이스 검사](../../apps/server/tests/architecture-workspaces.test.ts)는 실제 npm 실행으로 5개 루트 명령의 모든 패키지 호출과 실패 전파를 확인한다.
  재내보내기의 함수·오류 클래스 동일성과 패키지 런타임 의존도 검사한다.
- [마이그레이션 통합 검사](../../apps/server/tests/migrations.test.ts)는 루트 migrate를 직접 호출해 빈 DB·레거시·멱등성·실패를 검증한다.
- API·DB 스키마·계산·화면 동작 변경은 없다. 실제 Google 키 연동과 모바일 기기 검증은 기존 후속 작업이다.
