# 모바일 앱 기기 설치 안내 (개발·본인 사용)

본인 iPhone·Android 기기에 앱을 직접 설치하는 절차다. 앱스토어·Play 스토어 배포는 이 문서 범위 밖이다. 서버를 HTTPS로 배포하는 일은 T26D(사람)가 맡는다. 환경 설정 표는 [앱 README](../apps/mobile/README.md)에 있다.

CI는 아래 설정이 올바른지(`expo config`, 아이콘 파일·크기, 번들 ID 형식)를 `apps/mobile/tests/app-config.test.ts`로 검사한다. **실제 기기 설치·Google 로그인·지도 동작은 사람이 확인한다.**

## 1. 앱 설정 한눈에 보기

| 항목 | 값 | 바꾸는 곳 |
|---|---|---|
| 앱 이름 | `여행 동선` | `apps/mobile/app.config.ts`의 `name` |
| 아이콘·적응형 아이콘·스플래시 | `apps/mobile/assets/*.png` (스카이 블루 `#2A64A8` 배경, 흰 핀) | `node apps/mobile/scripts/generate-icons.mjs apps/mobile/assets`로 다시 만들거나 같은 크기(1024×1024) PNG로 교체 |
| iOS 번들 ID · Android 패키지명 | 기본 `com.travelscheduling.app` | 환경 변수 `APP_BUNDLE_ID` (두 플랫폼이 같은 값을 쓴다) |
| 서버 주소 | `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` |
| Google·지도 키 | [앱 README](../apps/mobile/README.md#설정과-실행)의 표 | `apps/mobile/.env.local` |

`apps/mobile/.env.example`을 `apps/mobile/.env.local`로 복사해 채운다. `EXPO_PUBLIC_*` 값은 **빌드할 때 앱 번들에 들어가므로** 값을 바꾸면 다시 빌드한다. 비밀 키(OAuth client secret, 서버 API 키)는 앱에 넣지 않는다.

**`APP_BUNDLE_ID`를 본인 값으로 바꾼다.** 무료 Apple ID는 다른 개발자가 이미 쓰는 번들 ID로 서명할 수 없다. `io.github.myname.travel`처럼 영문자로 시작하고 영문·숫자만 쓰는 단계를 점으로 이은 두 단계 이상의 값이어야 한다. 밑줄·하이픈은 iOS 번들 ID 규격과 맞지 않아 거부하고, Android 패키지명이 되는 각 단계가 Java·Kotlin 예약어(`class`, `package`, `new`, `fun` 등)이면 네이티브 소스를 컴파일할 수 없으므로 거부한다(`com.class.travel` ✗, `com.classic.travel` ✓). 형식이 틀리면 `expo config`가 오류로 알려 준다. 값을 바꾸면 Google Cloud의 iOS OAuth 클라이언트(번들 ID)와 Android OAuth 클라이언트(패키지명)도 같은 값으로 맞춘다.

확인:

```sh
cd apps/mobile
npx expo config --type public        # 이름·번들 ID·아이콘 경로가 의도대로인지 확인
```

## 2. 서버 연결 방식 고르기

앱은 `EXPO_PUBLIC_API_URL` 하나로만 서버에 붙는다. 주소 규칙은 `apps/mobile/src/api/origin.ts`가 강제한다.

| | A. 로컬 서버 + 같은 Wi-Fi | B. 배포 서버 |
|---|---|---|
| 주소 | `http://<컴퓨터 사설 IP>:3000` | `https://api.example.com` (경로 없음) |
| 허용되는 빌드 | **개발 빌드(Debug)만.** 릴리스 빌드는 HTTP 주소를 거부한다 | 개발·릴리스 모두 |
| 용도 | 개발·기기에서 빠른 확인 | 여행 중 실사용, APK/Release 설치 |

### A. 로컬 서버에 같은 Wi-Fi로 붙기

1. 컴퓨터와 기기를 **같은 Wi-Fi**에 연결한다(게스트 Wi-Fi·VPN은 기기 간 통신을 막는 경우가 많다).
2. 컴퓨터의 사설 IP를 확인한다. macOS는 `ipconfig getifaddr en0`, Windows는 `ipconfig`, Linux는 `hostname -I`. 예: `192.168.1.10`. 앱은 `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`만 HTTP로 받는다.
3. 서버를 모든 인터페이스에서 받도록 띄운다. 저장소 루트에서 PostgreSQL 설정과 `npm run migrate`를 마친 뒤:

   ```sh
   npm run dev -- -H 0.0.0.0
   ```

   서버 `apps/server/.env.local`의 `GOOGLE_MOBILE_CLIENT_IDS`에는 앱 로그인 ID 토큰의 `aud`인 **Web OAuth 클라이언트 ID**를 넣는다.
4. 같은 Wi-Fi의 기기 브라우저에서 `http://192.168.1.10:3000/api/trips`를 열어 `401` JSON이 오면 서버에 닿는 것이다. 열리지 않으면 컴퓨터 방화벽이 3000번 포트를 막고 있는지 본다.
5. `apps/mobile/.env.local`에 `EXPO_PUBLIC_API_URL=http://192.168.1.10:3000`을 쓰고 개발 빌드를 만든다(§3, §4의 Debug 빌드). 에뮬레이터·시뮬레이터는 iOS `http://localhost:3000`, Android `http://10.0.2.2:3000`이다.

iOS는 설정(`NSAllowsLocalNetworking`)으로 로컬 네트워크 HTTP를 허용하고, Android 개발(Debug) 빌드는 기본으로 HTTP를 허용한다. 그 밖의 주소는 HTTPS여야 한다.

### B. 배포 서버에 붙기

1. 서버를 HTTPS로 배포한다(T26D). 서버 환경 변수(`DATABASE_URL`, `GOOGLE_MOBILE_CLIENT_IDS`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_ROUTES_API_KEY`)와 전송 보안 요구는 [T29 결정](decisions/T29-transport-and-routes-budget.md)을 따른다.
2. `apps/mobile/.env.local`에 `EXPO_PUBLIC_API_URL=https://api.example.com`(본인 주소, 경로·쿼리 없음)을 쓴다.
3. 서버 주소를 바꾸면 앱을 **다시 빌드해 설치**한다. 서버 배포 위치가 바뀌어도 마찬가지다.

## 3. iOS 직접 설치 (무료 Apple ID + Xcode)

준비: macOS, Xcode(App Store), Xcode에 로그인한 Apple ID(Settings ▸ Accounts), USB로 연결한 iPhone(설정 ▸ 개인정보 보호 및 보안 ▸ 개발자 모드 켜기).

Google 로그인 모듈이 네이티브이므로 **Expo Go로는 로그인할 수 없다.** 개발 빌드를 만든다.

```sh
cd apps/mobile
export APP_BUNDLE_ID=io.github.myname.travel     # 또는 .env.local에 기록
npx expo prebuild --platform ios                 # ios/ 폴더 생성 (저장소에는 올라가지 않는다)
npx expo run:ios --device                        # Debug 빌드: Metro가 JS를 제공한다. 주소는 A(로컬)
npx expo run:ios --device --configuration Release # Release 빌드: JS를 앱에 포함한다. 주소는 B(HTTPS)
```

1. 처음 `prebuild`가 끝나면 `ios/*.xcworkspace`를 Xcode로 열고 target ▸ Signing & Capabilities에서 **Automatically manage signing**을 켜고 Team을 본인 Apple ID(Personal Team)로 고른다. 번들 ID는 `APP_BUNDLE_ID`와 같아야 한다.
2. 설치 뒤 기기에서 설정 ▸ 일반 ▸ VPN 및 기기 관리 ▸ 개발자 앱에서 본인 Apple ID를 **신뢰**한다.
3. **7일마다 다시 설치한다.** 무료 Apple ID로 서명한 앱은 7일 뒤 실행되지 않는다. 처음 설치한 것과 **같은 빌드 구성으로** 같은 `ios/`에서 다시 실행하면 앱 데이터를 지우지 않고 덮어쓴다. 로컬 HTTP 서버(A)로 쓰던 Debug 빌드는 `npx expo run:ios --device`, 배포 HTTPS 서버(B)로 쓰던 Release 빌드는 `npx expo run:ios --device --configuration Release`다. 구성을 바꿔 설치하면(예: Debug → Release) 서버 주소 규칙이 달라져 기존 `EXPO_PUBLIC_API_URL`이 거부될 수 있다. 번들 ID를 바꾸면 다른 앱으로 설치되고 로그인 세션도 새로 시작한다. 무료 계정은 동시에 설치할 수 있는 앱 수와 번들 ID 등록 수에 제한이 있다.
4. `app.config.ts`나 `APP_BUNDLE_ID`, 지도·로그인 키, 아이콘을 바꾸면 `npx expo prebuild --platform ios --clean`으로 `ios/`를 다시 만든 뒤 빌드한다.

## 4. Android APK 만들기

준비: JDK 17, Android SDK(Android Studio로 설치하고 `ANDROID_HOME` 설정), 개발자 옵션의 USB 디버깅을 켠 기기.

### 4-1. 빌드

```sh
cd apps/mobile
export APP_BUNDLE_ID=io.github.myname.travel
npx expo prebuild --platform android             # android/ 폴더 생성 (저장소에는 올라가지 않는다)
(cd android && ./gradlew assembleDebug)          # Debug APK. 주소는 A(로컬)
(cd android && ./gradlew assembleRelease)        # Release APK. 주소는 B(HTTPS)
```

- 산출물(`apps/mobile` 기준): `android/app/build/outputs/apk/debug/app-debug.apk`, `android/app/build/outputs/apk/release/app-release.apk`.
- Debug APK에는 JS 번들이 없다. 실행하려면 Metro에 연결해야 하며, 개인 키로 서명한 Debug APK를 쓰는 절차는 §4-3이다. `npx expo run:android --device`는 템플릿 키로 서명한 앱을 설치하므로 개인 키로 설치한 앱과 서명이 충돌하고 **실제 Google 로그인 확인에는 쓰지 않는다**(§4-2). 이 명령을 쓰려면 먼저 `adb uninstall <APP_BUNDLE_ID>`로 개인 키 앱을 지운다.
- Release APK는 JS 번들을 포함하므로 Metro가 필요 없다. 주소는 B(HTTPS)다.

### 4-2. 개인 키로 서명하고 설치하기

Expo SDK 58 템플릿은 Debug와 Release 모두 템플릿에 들어 있는 `debug.keystore`로 서명한다. 이 키는 공개 저장소에 있어 **누구나 같은 서명을 만들 수 있다.** 패키지명 + SHA-1 조합이 내 빌드를 식별해야 하는 Google OAuth 클라이언트와 지도 키 제한에는 이 키의 SHA-1을 등록하지 않는다. 본인만 가진 키로 APK를 다시 서명하고 그 인증서의 SHA-1을 등록한다.

1. 개인 키 저장소를 **`android/` 밖**에 한 번만 만든다. `prebuild --clean`은 `android/`를 지우므로 키를 거기 두면 사라져 같은 서명으로 업데이트할 수 없다. 저장소에는 올리지 않고 백업해 둔다(분실하면 삭제 후 재설치해야 한다).

   ```sh
   mkdir -p ~/.android-keys
   keytool -genkeypair -v -keystore ~/.android-keys/travel.keystore -alias travel \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. APK를 만든 뒤 개인 키로 서명한다. 서명은 빌드 뒤에 하므로 `prebuild --clean`을 해도 같은 키로 서명된다. `apksigner`는 Android SDK의 `build-tools/<버전>/`에 있다.

   ```sh
   cd apps/mobile
   APKSIGNER=$ANDROID_HOME/build-tools/<설치된 버전>/apksigner
   $APKSIGNER sign --ks ~/.android-keys/travel.keystore --ks-key-alias travel \
     --out travel-release.apk android/app/build/outputs/apk/release/app-release.apk
   $APKSIGNER verify --print-certs travel-release.apk   # 서명 인증서 SHA-1 확인
   adb install -r travel-release.apk                    # 연결한 기기에 설치 (APK 파일을 기기로 옮겨 열어도 된다)
   ```

   Debug APK(`app-debug.apk`)도 같은 방법으로 서명해 설치하되, 실행하려면 Metro 연결이 필요하다(§4-3). 같은 패키지의 앱이 다른 키(템플릿의 디버그 키 포함)로 서명돼 설치돼 있으면 `adb install -r`이 실패하므로 `adb uninstall <APP_BUNDLE_ID>` 뒤 설치한다(앱 데이터와 로그인 세션이 지워진다).

3. 인증서 SHA-1은 위 `verify` 출력이나 `keytool -list -v -keystore ~/.android-keys/travel.keystore -alias travel`로 확인해 등록한다.
   - **Google 로그인(Android)**: Google Cloud의 Android OAuth 클라이언트에 패키지명(`APP_BUNDLE_ID`)과 이 SHA-1을 등록한다.
   - **지도 키**: Maps SDK for Android 키는 앱(패키지명 + 이 SHA-1)으로, iOS 키는 번들 ID로 제한한다.
4. `app.config.ts`·`APP_BUNDLE_ID`·키·아이콘을 바꿨다면 `npx expo prebuild --platform android --clean` 뒤 다시 빌드·서명한다. 같은 키로 서명하므로 설치된 앱은 데이터를 지우지 않고 업데이트된다.

### 4-3. 개인 키 Debug APK로 로컬 서버(A)에 로그인하기

Debug APK는 JS를 앱에 담지 않고 실행할 때 Metro(개발 서버, 8081번 포트)에서 받는다. 개인 키로 서명한 Debug APK(§4-2의 2번, `app-debug.apk`를 같은 방법으로 서명해 설치)로 같은 Wi-Fi의 로컬 API 서버에 Google 로그인하려면 다음 순서로 Metro를 연결한다.

1. API 서버를 §2-A대로 `npm run dev -- -H 0.0.0.0`으로 띄우고, `apps/mobile/.env.local`의 `EXPO_PUBLIC_API_URL=http://<컴퓨터 사설 IP>:3000`으로 Debug APK를 **빌드**한 상태여야 한다(`EXPO_PUBLIC_*`는 빌드 때 들어간다).
2. 컴퓨터에서 Metro를 시작한다.

   ```sh
   cd apps/mobile
   npx expo start --dev-client
   ```

3. 기기가 Metro에 닿게 한다. 둘 중 하나를 쓴다.
   - **USB 연결(권장):** 기기를 USB로 연결하고 `adb reverse tcp:8081 tcp:8081`을 실행한다. 기기의 `localhost:8081`이 컴퓨터의 Metro로 이어진다. USB를 뺐다 꽂거나 `adb`를 재시작하면 다시 실행한다.
   - **같은 Wi-Fi:** 컴퓨터 방화벽에서 8081번 포트를 허용하고, 앱의 개발 메뉴(또는 시작 화면)에서 `http://<컴퓨터 사설 IP>:8081`을 입력해 연결한다.
4. 기기에 설치된 `여행 동선` 앱을 **직접 연다**(`expo run:android`를 쓰지 않으므로 앱이 자동으로 열리지 않는다). 앱이 Metro에서 JS를 받으면 로그인 화면이 열리고, Google 로그인 뒤 API 서버(`EXPO_PUBLIC_API_URL`)로 요청한다.
5. JS 코드만 바꿨다면 앱을 다시 설치하지 않고 Metro가 새로 고친다. 네이티브 설정(`app.config.ts`, 키, 아이콘)이나 `EXPO_PUBLIC_*` 값을 바꿨다면 다시 빌드·서명·설치한다.

Metro 없이 쓰려면 Release APK와 HTTPS 서버(B)를 쓴다.

## 5. 설치 뒤 직접 확인할 것 (사람)

CI가 대신 검증하지 못하는 항목이다.

- [ ] 홈 화면 아이콘과 앱 이름(`여행 동선`), 시작 화면 색
- [ ] Google 로그인 → `내 여행` 첫 화면 (서버 `aud` 설정 포함)
- [ ] 선택한 서버 주소(A 또는 B)로 여행 생성 → 동선 결과 → 지도 표시
- [ ] 결과 지도의 현재 위치 권한 요청
- [ ] iOS: 7일 뒤 재설치 절차
- [ ] 로그아웃·탈퇴, 공유 링크 발급

## 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| 앱이 "서버 주소 설정을 확인해 주세요."를 표시 | 주소가 HTTPS가 아니거나(릴리스 빌드), 경로·쿼리가 있거나, 사설 IP 범위를 벗어났다. `EXPO_PUBLIC_API_URL`을 고쳐 다시 빌드 |
| 기기에서 서버에 접속되지 않음 | 같은 Wi-Fi인지, 서버를 `-H 0.0.0.0`으로 띄웠는지, 컴퓨터 방화벽 포트 3000, 컴퓨터 IP가 바뀌지 않았는지 |
| iOS "Failed to register bundle identifier" | 번들 ID가 다른 개발자와 겹친다. `APP_BUNDLE_ID`를 본인 값으로 바꾸고 `prebuild --clean` |
| iOS 앱이 열리자마자 종료됨 | 7일이 지났거나 개발자 앱이 신뢰되지 않았다. 재설치·신뢰 설정 |
| Android Debug APK가 "Unable to load script" 빨간 화면 | Metro에 연결되지 않았다. `npx expo start --dev-client` 실행 여부, `adb reverse tcp:8081 tcp:8081`(USB) 또는 8081 방화벽(Wi-Fi), §4-3 |
| `APP_BUNDLE_ID` 예약어 오류 | `class`·`package`·`new` 같은 Java·Kotlin 예약어를 한 단계로 쓸 수 없다. `com.classic.travel`처럼 바꾼다 |
| Google 로그인이 `DEVELOPER_ERROR`(Android) | 패키지명과 SHA-1이 OAuth 클라이언트와 다르다 |
| 서버가 로그인을 거부(401) | 서버 `GOOGLE_MOBILE_CLIENT_IDS`에 Web OAuth 클라이언트 ID가 없다 |
