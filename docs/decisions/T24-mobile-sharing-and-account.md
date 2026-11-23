# T24 모바일 공유와 계정

## 결정

- 결과 화면에서 공유 시트를 열고 발급 전에 기존 링크의 무효화를 알린다. T14 API가 반환한 상대 경로는 공용 토큰 형식을 검사하고 앱 API의 origin에서 열리는 URL로 만든다. 이 URL을 네이티브 공유 시트에 전달한다. 같은 시트를 닫기 전에는 URL을 메모리에 두고 재사용한다. 재발급 결과를 받지 못하면 이전 URL을 지운다.
- `내 여행`에서 계정 화면을 열고 로그아웃과 탈퇴를 제공한다. 계정 화면을 포함하는 `(app)` 그룹에 Expo Router 레이아웃을 두어 기존 `Stack.Protected`가 그룹 전체를 보호하도록 한다. 탈퇴 확인 후 기존 API가 204를 반환하면 로그아웃과 동일한 기기 세션 정리를 수행한다. 서버 실패는 시트에 표시한다.
- 공개 페이지는 기존 T14 익명 조회·지도·일정 표시를 사용한다. 페이지 경로에서 CSS를 로드하고 공용 디자인 토큰을 CSS 변수로 전달한다. Pretendard Regular·SemiBold와 라이선스를 디자인 토큰 패키지로 옮겨 앱과 웹이 같은 자산을 사용한다.

## 이유

- 발급과 OS 공유를 한 동작으로 제공하고 시트 안에서는 링크를 다시 공유할 수 있다. [React Native Share](https://reactnative.dev/docs/share)
- 앱은 탈퇴 성공을 확인한 뒤 토큰을 지운다. 401과 SecureStore 삭제 실패는 공통 세션 규칙대로 처리한다. [Expo Router 보호 경로](https://docs.expo.dev/router/advanced/protected/)
- 공용 글꼴을 사용하면 두 앱이 서로 의존하지 않고 같은 버전과 라이선스를 유지할 수 있다. `/share/[token]`의 선택자 범위를 지정해 T25까지 남아 있는 웹 화면의 스타일을 보존한다.

## 대안

- 공유 시트를 열 때마다 재발급하면 이미 전달된 링크가 뜻하지 않게 무효화될 수 있다.
- 탈퇴 요청을 시작할 때 로컬 토큰을 지우면 서버 처리에 실패했을 때 다시 로그인해야 한다.

## 검증

| 완료 기준 | 검사 |
|---|---|
| 결과에서 소유자 링크 발급·OS 공유·재발급 안내 | `apps/mobile/tests/result-sharing.test.tsx`의 Bearer POST, 같은 링크의 재공유, 재발급 흐름과 오류 처리. `apps/server/tests/sharing-http.test.ts`와 `sharing-db.test.ts`의 이전 링크 무효화 |
| 계정의 로그아웃, 탈퇴 확인 및 성공 후 로그인 | `apps/mobile/tests/login-flow.test.tsx`의 보호 경로·확인 취소·삭제 요청·실패 재시도·SecureStore 정리. `apps/server/tests/mobile-session-db.test.ts`의 계정·모든 세션 삭제 |
| 앱 색·글자, 익명 읽기 전용 웹 | `apps/server/tests/sharing-ui.test.ts`의 공유 경로·디자인 변수·익명 조회·편집 제어 부재. `apps/server/tests/e2e/journey.spec.ts`의 브라우저 색·글자·폰트 로드·타임라인·지도 검사 |

실제 iOS·Android의 OS 공유 시트와 Google 로그인·지도는 기기에서 확인한다.
