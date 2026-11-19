# T20 앱 골격·디자인 토큰·로그인

기준: 원격 develop `38651cd`와 동일한 `t20-local`에서 시작. 보호 파일·서버 동작·요구사항은 변경하지 않는다.

## 결정

- Expo SDK 58, expo-router 보호 라우트, TypeScript strict를 사용한다. 인증 상태를 `SessionManager` 인스턴스에서 관리하고 React에는 토큰 없는 상태만 구독시킨다. 런타임은 루트에서 한 번 생성하며 모듈 import 때 I/O를 하지 않는다.
- 네이티브 Google 로그인은 `GoogleIdentityProvider`, 저장소는 `SessionStorage` 뒤에 둔다. 테스트에서는 두 포트와 HTTP transport만 교체하고 실제 런타임 조립·상태·라우터를 사용한다. 기존 서버 로그인 화면을 앱에서 import하지 않는다.
- 서버 origin은 `EXPO_PUBLIC_API_URL`. Bearer를 이 origin의 `/api/`에만 보내고 리다이렉트와 쿠키 전달은 금지한다. core의 오류 코드·fields를 보존한다. 빈 본문 401도 먼저 세션을 지운다. 이전 세션의 늦은 401은 새 세션에 영향을 주지 않는다.
- SecureStore에 `{ token, expiresAt }`만 저장한다. 복원 시 형식·만료를 검사하고 API 호출 전에도 만료를 확인한다. 저장/삭제 오류는 로그인으로 통과시키지 않고 재시도를 제공한다. 로그아웃은 서버 폐기를 먼저 시도하고 성공 여부와 관계없이 기기 저장소와 Google 로그인 상태를 비운다. 서버 실패는 로그인 화면에서 표시한다.
- SDK에서 ID 토큰을 얻으려면 Web OAuth client ID가 필요하다. 서버의 `GOOGLE_MOBILE_CLIENT_IDS`는 실제 aud(Web ID 포함)를 허용하도록 배포 설정한다. T18 검증 코드는 바꾸지 않는다. [SDK 공식 설명](https://react-native-google-signin.github.io/docs/integration-notes)과 [설정 API](https://react-native-google-signin.github.io/docs/original)를 확인했다.
- 로그인 뒤 첫 화면은 제목 `내 여행`과 로그아웃으로 한정한다. 여행 입력(T21)·계정 탈퇴(T24)는 여기서 미리 구현하지 않는다.
- 디자인 값은 `packages/design-tokens/src/index.ts` 하나에 두고 범위값도 보존한다. RN 변환과 폰트 이름은 앱 theme에 둔다. Pretendard 1.3.9 TTF 두 굵기와 OFL을 앱에 포함한다.
- 네이티브 스택 기본 전환은 문서의 24pt와 다르므로 끄고 공통 `ScreenTransition`으로 280ms 이동+페이드를 구현한다. 동작 줄이기는 이동을 없앤다. 버튼은 90ms/0.97배다.
- 서버 React 19.3.1과 SDK React 19.3.0은 유지한다. 앱 Metro/Jest에서 React와 하위 경로를 앱 사본으로 고정하여 호이스팅된 네이티브 의존성과 중복 React 훅 오류를 방지한다. 서버의 React를 내리는 대안은 기존 웹 실행 경로를 바꾸므로 채택하지 않는다.

## 이유

세션·화면·네이티브 I/O를 분리하면 실제 기기 없이도 인증과 라우터 흐름을 검증할 수 있다. 보안 저장 완료 후에만 화면을 열고 실패 시 접근을 막아 재실행 때 오래된 로그인 정보가 되살아나는 것을 방지한다. 토큰 단일 원본과 문서 비교 검사는 후속 화면이 같은 디자인 값을 사용하도록 한다.

구조 검사기는 새 글꼴 `.d.ts`의 타입 의존성은 유지하되 런타임 출력이 없는 선언을 JS로 변환하지 않는다. `.ttf`는 실제 존재를 검사하는 자산 의존성으로 추적한다. 기존 경계·순환 검사는 그대로 실행한다.

## 대안

- 웹 OAuth와 브라우저 쿠키 재사용: T18 Bearer 계약과 네이티브 로그인 요구에 맞지 않는다.
- AsyncStorage: 기기 보안 저장소 요구에 맞지 않는다.
- 화면별 fetch·색·세션 상태: 인증 만료와 디자인 변경 규칙이 여러 곳에 생긴다.
- Expo Go에서 실제 로그인 검증: 네이티브 Google 모듈이 필요하므로 개발 빌드에서만 가능하다. [공식 Expo 설정](https://react-native-google-signin.github.io/docs/setting-up/expo).

## 검증

- `packages/design-tokens/tests/design.test.ts`: 문서 역할별 색·글자·간격·모서리·크기·움직임 일치, 외부 의존 없음.
- `apps/mobile/tests/login-flow.test.tsx`: 실제 expo-router로 로그인/첫 화면/로그아웃, 로그인 취소·오류·재시도, 저장 복원, 401 이동, 저장소 로딩·실패, 네트워크 실패 로그아웃.
- `session-manager.test.ts`, `api-client.test.ts`: 만료·잘못된 저장 데이터·중복 로그인·저장소 실패, Bearer/서버 주소/오류 계약, 오래된 401의 경합.
- `native-adapters.test.ts`, `theme.test.ts`: Google SDK/SecureStore 호출 계약, 재시작 후 네이티브 로그아웃, 실제 글꼴 파일/OFL, theme 변환·의존 경계.
- 루트 lint/typecheck/build/test에 앱과 토큰 검사 자동 포함. iOS·Android `expo export`는 키 없이 실행하며 글꼴을 포함한다.

실제 Google OAuth·Keychain/Keystore·글꼴 모양·동작 줄이기 체감은 사람이 iOS/Android에서 확인한다. 네이티브 앱 설치 설정은 T26에서 마무리한다.
