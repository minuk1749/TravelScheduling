# T25 웹 화면 제거와 Bearer HTTP 종단 시나리오

기준: 작업 시작 원격 `develop` `dcf0c01`.

## 결정

- [아키텍처 §13.8](../architecture.md#138-t25에서-지운-웹-전용-코드)의 웹 전용 코드를 지웠다. 대상은 여행·생활 설정·결과 웹 화면, 웹 OAuth 로그인(`src/auth.ts`, `api/auth/[...nextauth]`, 서버 액션), PWA manifest·서비스워커·아이콘·`verify-pwa`와 관련 테스트다. 서버의 HTML은 공유 열람 페이지 `/share/[token]` 하나만 남겼다. 루트 레이아웃은 공유 페이지를 감싸는 최소 구조로 줄이고, `globals.css`에는 공유 페이지가 쓰는 기본 규칙만 남겼다.
- Auth.js와 함께 쿠키 인증 경로도 지웠다. `SessionRequestAuthenticator`는 유효한 Bearer 세션만 인증한다. `Authorization` 헤더가 없으면 쿠키가 있어도 401 `UNAUTHENTICATED`다. 쿠키를 받던 판과 Bearer 전용 판이 같아졌으므로 `bearerAuthenticator`를 `requestAuthenticator` 하나로 합쳤다.
- `lib/auth/callbacks.ts`는 삭제했다. 이 파일의 `googleIdentity`·`validUserId`는 Auth.js 콜백만 썼고, `store.ts`의 `userExists`도 마찬가지였다. 모바일 로그인에 필요한 것은 `upsertGoogleUser` 포트 하나뿐이어서 `ports.ts`의 `GoogleUserStore`로 옮겼다. T16 목록은 이 파일을 "남기는 것"으로 분류했지만, 이는 T18이 Google 신원 확인을 다시 쓸 것으로 본 계획이었다. 실제 T18은 ID 토큰 검증기(`google-id-token.ts`)를 새로 만들었다.
- 종단 시나리오 `tests/e2e/journey.spec.ts`는 Playwright의 HTTP 요청으로 흐름 1–10을 앱과 같은 방식으로 호출한다. 서버는 실제 `next start`, 세션 API, 라우트, 서비스, PostgreSQL을 그대로 사용한다. Google 부분만 대체한다.
  - 로그인: `playwright.config.ts`가 실행마다 가짜 RS256 키를 한 번 만들어 환경 변수에 넣는다. 서버와 테스트 워커는 이 환경 변수를 상속한다. 서버에 미리 불러온 `google-doubles.mjs`는 이 키의 공개 키를 Google JWKS로 응답하고, 테스트는 같은 키로 서명한 ID 토큰을 `POST /api/session`에 보낸다. 검증에는 실제 `JoseGoogleIdTokenVerifier`(원격 JWKS 로더)를 사용한다.
  - 요청: `tests/e2e/support/app-client.ts`가 `apps/mobile/src/api`와 같은 경로·본문·`Idempotency-Key`를 사용한다. 결과 수정 두 건은 앱 결과 화면과 같이 새 `operationId`와 직전 조회의 `writeVersion`을 보내며, 응답·복구 조회의 영수증이 요청 ID와 저장 revision에 맞는지와 현재 revision에 이전 쓰기 버전을 보내면 409이고 저장 내용이 그대로인지 확인한다. 필수 장소 선택은 앱(`capacity-flow.tsx`)처럼 쓰기 옵션 없이 보낸다. 앱 코드는 Expo·React Native에 의존하므로 서버 테스트에서 직접 import하지 않는다.
  - 공유: 공유 열람 페이지는 남은 유일한 웹 화면이다. 그래서 같은 시나리오에서 실제 저장 결과를 375px 브라우저(지도 스텁)로 열어 T24의 디자인 토큰·글꼴 검사를 이어서 실행한다.

## 이유

- 요구사항 §5 T25가 T16 목록의 웹 전용 코드를 지우고 공유 열람 페이지만 남기라고 정한다. 쿠키 경로를 남기면 로그인할 화면이 없는데도 Auth.js 세션 쿠키가 모든 사용자 API의 인증 수단으로 남는다. §13.3의 "전환 기간" 계획도 T25에서 쿠키 경로를 지우게 되어 있다.
- 종단 시나리오에서 Google만 대체하면 세션 발급·해시 저장, 소유권, 입력 해시·재시도 키, 저장 결과 공유처럼 화면과 무관한 서버 규칙을 실제 경로로 검증할 수 있다. 앱 화면의 동작은 `apps/mobile/tests`의 컴포넌트 테스트가 이미 검사한다(아키텍처 §13.6).
- 가짜 서명 키를 저장소에 커밋하지 않고 실행마다 만든다. 개인 키 형식의 파일을 커밋하면 비밀 값 검사에 걸릴 수 있고, 실제 키로 오해할 수도 있다.

## 대안

- **`node:test`로 라우트 처리기를 직접 호출한다.** `npm test`에 포함할 수 있지만 Next 라우팅, `next start` 빌드 결과, 실제 프로세스의 `fetch` 경계를 거치지 않는다. 요구사항이 "실제 서버"를 요구하므로 채택하지 않았다. 처리기 단위 검사는 기존 `*-http.test.ts`와 `bearer-ownership.test.ts`에 있다.
- **고정 테스트 키 파일을 커밋한다.** 설정이 단순해지지만 위의 비밀 값 검사 문제가 있다.
- **쿠키 경로를 남기고 Auth.js만 지운다.** 쿠키를 발급하는 주체가 없어 의미가 없다. 오래된 쿠키가 다시 인증에 쓰일 가능성만 남는다.
- **`callbacks.ts`를 계획대로 남긴다.** 사용하는 곳이 없는 코드가 남는다. 작업 원칙(불필요한 코드 제거)에 따라 지우고, 이 기록과 §13.8에 남겼다.

## 검증

| 완료 기준 | 검사 |
|---|---|
| T16 목록의 웹 전용 코드 삭제, 공유 열람 페이지만 남김 | `apps/server/tests/app-transition-design.test.ts`: §13.8의 지운 경로가 없고 남긴 경로가 있는지, 웹 페이지가 `share/[token]/page.tsx` 하나인지, `public/` 비어 있음, `next-auth` 의존성과 `verify-pwa` 호출 없음. `app-transition-contract.test.ts`: Auth.js 라우트·`src/auth.ts`가 없고 모든 사용자 API 모듈이 `RequestAuthenticator`를 쓰는지 |
| 쿠키 경로 제거 | `bearer-ownership.test.ts`의 `T25: without a Bearer header…`: 모든 사용자 API가 쿠키만 있는 요청에 401. `mobile-session.test.ts`: 헤더 없음 401. `tests/e2e/route-shapes-auth.spec.ts`: 실제 서버에서 쿠키만 있는 요청 401 |
| 흐름 1–10 Bearer HTTP 종단 시나리오 (실제 서버·DB·서비스, Google만 가짜) | `tests/e2e/journey.spec.ts`(`npm run test:e2e`). 로그인(다른 `aud` 401, 해시만 저장) → 여행 생성(도쿄 추천 택시 정책 `WHEN_NEEDED`, 장소 검색, DB 행) → 생활 설정(저장·오래된 revision 409) → 수용량 초과(추천 최대 필수 개수 `requiredCount`가 1–5이고 추천 ID 수·미리보기에 배치된 추천 장소 수와 같음, 같은 재시도 키는 같은 결과) → 추천 필수 선택 → 재검증 OK → 결과(구간별 대중교통·택시의 소요시간·요금, PREFER 반영, 경로 모양) → 수정(희망 장소 날짜·시각·순서 고정, 구간 수단 고정, 다시 읽어도 유지) → 공유(익명 조회 일치, 375px 페이지, 재발급 시 이전 링크 404) → 로그아웃(해당 기기만)·탈퇴(사용자·여행·링크 삭제). 각 단계에서 다른 사용자 403 확인 |
| 공유 페이지 표시 | `sharing-ui.test.ts`(익명 조회·디자인 변수·편집 제어 없음·재발급 링크 무효·재시도), `tests/e2e/sharing.spec.ts` |

실제 Google 로그인·지도와 배포 서버는 사람이 확인한다(T26D).
