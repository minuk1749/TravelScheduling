# @travel/mobile

Expo SDK 58 · TypeScript strict · expo-router 앱이다. T20은 로그인, 세션 복원, 보호된 첫 화면(`내 여행`), 로그아웃을 제공한다. T21은 여행 만들기, 장소 추가, 저장한 여행 재열기와 하루 생활 수정을 제공한다. T22는 지도 우선 결과 화면(장소 카드·전체 일정·장소 수정·희망 장소 추가·이동수단 바꾸기)을, T23은 필수 장소 선택을 제공한다.

## 설정과 실행

`.env.example`을 이 디렉터리의 `.env.local`로 복사해 설정한다. `EXPO_PUBLIC_*`는 앱 번들에 들어가는 공개 설정이다. 비밀 키를 넣지 않는다.

| 설정 | 의미 |
|---|---|
| `EXPO_PUBLIC_API_URL` | 운영 빌드는 `https://api.example.com`처럼 경로 없는 HTTPS 주소가 필요하다. 개발 빌드에서는 HTTP로 `localhost`, 루프백(`127.0.0.0/8`, `[::1]`), 사설 IPv4(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)도 지정할 수 있다 |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | 네이티브 SDK가 서버 검증용 ID 토큰을 요청할 Web OAuth 클라이언트 ID |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS 앱의 OAuth 클라이언트 ID |
| `GOOGLE_IOS_URL_SCHEME` | iOS OAuth ID의 역순 URL scheme (`com.googleusercontent.apps.…`). 네이티브 설정 생성 때 Google config plugin을 활성화한다 |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` | 숙소 위치 선택과 결과 지도에 쓰는 iOS 앱 제한 Maps SDK 키 |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` | 숙소 위치 선택과 결과 지도에 쓰는 Android 앱 제한 Maps SDK 키 |

개발 주소 예시는 iOS 시뮬레이터의 `http://localhost:3000`, Android 에뮬레이터의 `http://10.0.2.2:3000`, 같은 Wi-Fi에 있는 기기의 `http://192.168.1.10:3000`이다. 마지막 주소에는 개발 컴퓨터의 실제 사설 IP를 넣는다.

서버의 `GOOGLE_MOBILE_CLIENT_IDS`에는 **실제 ID 토큰의 aud**를 허용해야 한다. 이 SDK에서 `webClientId`를 사용하므로 위 Web ID도 목록에 포함한다. T18의 서명·발급자·만료 검증은 그대로다. Android에는 Google Cloud에서 앱 패키지명·서명 인증서 SHA를 등록한다. OAuth client secret은 앱에 넣지 않는다.

루트에서 `npm run dev --workspace @travel/mobile`로 Metro를 실행한다. 네이티브 Google 모듈 때문에 Expo Go가 아닌 개발 빌드가 필요하다. 자격증명 없는 CI에서는 로그인 SDK를 목으로 대체하고 JS 번들까지만 생성한다. 번들 ID·APK/Xcode 설치 안내는 T26 범위다. 실제 기기에서는 배포용 HTTPS 서버를 사용한다.

두 Maps SDK 키는 각 앱과 플랫폼으로 제한한다. 지도 키가 없는 환경에서는 장소 검색과 주소 입력을 사용할 수 있고, 결과 화면은 지도 자리에 "지도를 표시할 수 없어요"를 두고 장소 패널은 그대로 쓴다. 결과 지도의 현재 위치 버튼은 위치 권한(iOS 사용 설명, Android 실행 중 요청)을 쓰며 위치를 저장·전송하지 않는다. 지도 SDK 설정을 바꾸면 개발 빌드를 다시 만든다. [Expo 지도 설정](https://docs.expo.dev/versions/latest/sdk/map-view/)

## 구조와 검증

- `app/`: 라우트. 루트에서 글꼴을 로드하고 런타임을 한 번 조립한다. `Stack.Protected`가 비로그인/로그인 화면과 이전 화면 기록을 분리한다.
- `src/auth/`: `SessionManager`, Google/SecureStore 어댑터, 포트, 런타임 조립, React 구독. 세션은 SecureStore에 `{ token, expiresAt }`로 저장한다. 토큰 원문은 React 상태·로그에 넣지 않는다.
- `src/api/`: 서버 origin 한 곳으로만 요청한다. Bearer 첨부, 쿠키/리다이렉트 전달 금지, 15초 제한, core 오류 코드·두 `fields` 형태 보존, 401이면 저장소 삭제와 로그인 이동.
- `src/theme/`: `@travel/design-tokens` → RN 스타일, 글꼴 등록, 동작 줄이기. 화면 전환은 24pt 이동+페이드 280ms, 누름은 0.97배/90ms. 동작 줄이기에서는 이동을 없앤다.
- `src/screens/`, `src/components/`: 로그인·여행 입력·결과·필수 선택 화면과 공통 버튼·필드·검색·시트.
- `src/map/`, `src/result/`: 결과 지도 계약(`ResultMapProps`)과 순수 계산(카드 선택·강조 구간·도심 밖·구간 색·polyline), Google 지도 어댑터, 결과 날짜 모델. 테스트는 `tests/fake-result-map.tsx`를 `MapAdapterProvider`로 주입한다.

`npm run lint`, `npm run typecheck`, `npm run build`, `npm test`에 이 워크스페이스 검사도 포함된다. 빌드는 `dist/ios`와 `dist/android`에 Expo export를 생성한다. `tests/login-flow.test.tsx`는 실제 라우터·인증 조립·목 HTTP를 통해 로그인/취소/오류/복원/401/로그아웃/저장소 재시도를 검사한다. 네이티브 드라이버 애니메이션은 테스트에서 즉시 완료시킨다.

웹 서버의 React 19.3.1과 Expo의 19.3.0이 다르므로 Metro와 Jest는 모든 앱 의존성에 앱의 React 사본을 사용한다. 서버 버전은 바꾸지 않는다. 테스트는 `npm ci`의 workspace 설치 구조를 사용한다.

## 글꼴과 참고

`packages/design-tokens/assets/fonts/`의 [Pretendard 1.3.9](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9) Regular·SemiBold TTF와 SIL OFL 라이선스를 앱과 공유 웹에서 사용한다. 원본 배포: npm `pretendard@1.3.9`의 `dist/public/static/alternative`.

연동 근거: [Expo Router 설치](https://docs.expo.dev/router/installation/), [Expo 테스트](https://docs.expo.dev/develop/unit-testing/), [Google 네이티브 로그인](https://react-native-google-signin.github.io/docs/original), [ID 토큰 대상 설정](https://react-native-google-signin.github.io/docs/integration-notes), [Expo 네이티브 설정](https://react-native-google-signin.github.io/docs/setting-up/expo).
