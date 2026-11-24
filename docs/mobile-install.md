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

`apps/mobile/.env.example`을 `apps/mobile/.env.local`로 복사해 채운다. `EXPO_PUBLIC_*` 값은 **JS 번들을 만들 때 코드에 들어간다.** 번들을 앱에 포함하는 Release 빌드는 값을 바꾸면 다시 빌드하고, Debug 빌드는 Metro를 시작한 환경의 값을 쓰므로 Metro를 다시 시작해 앱을 다시 로드한다(§4-3). 비밀 키(OAuth client secret, 서버 API 키)는 앱에 넣지 않는다.

**`APP_BUNDLE_ID`를 본인 값으로 바꾼다.** 무료 Apple ID는 다른 개발자가 이미 쓰는 번들 ID로 서명할 수 없다. `io.github.myname.travel`처럼 영문자로 시작하고 영문·숫자만 쓰는 단계를 점으로 이은 두 단계 이상의 값이어야 한다. 밑줄·하이픈은 iOS 번들 ID 규격과 맞지 않아 거부하고, Android 패키지명이 되는 각 단계가 Java·Kotlin 예약어(`class`, `package`, `new`, `fun` 등)이면 네이티브 소스를 컴파일할 수 없으므로 거부한다(`com.class.travel` ✗, `com.classic.travel` ✓). 형식이 틀리면 `expo config`가 오류로 알려 준다. 값을 바꾸면 Google Cloud의 iOS OAuth 클라이언트(번들 ID)와 Android OAuth 클라이언트(패키지명)도 같은 값으로 맞춘다.

`APP_BUNDLE_ID`는 `apps/mobile/.env.local`에 한 번 적고 모든 빌드가 그 값을 쓰게 한다(`.env.example`에 같은 항목이 있다). 셸에서 `export`한 값은 `.env.local`보다 우선하므로, 빌드 명령 앞에서 다른 값을 다시 `export`하지 않는다. 이전에 `export`한 값이 셸에 남아 있으면 `unset APP_BUNDLE_ID`로 지운다.

확인 (**빌드·설치 직전에 매번**):

처음 체크아웃했다면 먼저 **저장소 루트에서 Node 24로 `npm ci`를 한 번 실행**해 워크스페이스 의존성을 설치한다(`app.config.ts`가 쓰는 `expo-router`·`expo-font`·`expo-splash-screen` 등 프로젝트 플러그인이 여기서 설치되며, `npx`가 Expo CLI만 내려받는 것으로는 부족하다). 그 뒤 `apps/mobile`로 이동한다.

```sh
npm ci                               # 저장소 루트, 처음 한 번 (의존성이 바뀌면 다시)
cd apps/mobile
npx expo config --type public        # 이름·아이콘 경로가 의도대로인지, ios.bundleIdentifier와 android.package가 .env.local의 APP_BUNDLE_ID와 같은지 확인
```

두 값이 `.env.local`에 적은 값과 다르면 빌드하지 않는다. 그대로 빌드하면 iOS 서명이나 Android Google 로그인이 등록한 식별자와 맞지 않는다. 본인 값을 적지 않았다면 두 값은 기본값 `com.travelscheduling.app`이다.

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
5. `apps/mobile/.env.local`에 `EXPO_PUBLIC_API_URL=http://192.168.1.10:3000`을 쓰고 개발 빌드를 실행한다(§3, §4의 Debug 빌드). 에뮬레이터·시뮬레이터는 iOS `http://localhost:3000`, Android `http://10.0.2.2:3000`이다.

iOS는 설정(`NSAllowsLocalNetworking`)으로 로컬 네트워크 HTTP 전송(ATS)을 허용하고, Android 개발(Debug) 빌드는 기본으로 HTTP를 허용한다. 그 밖의 주소는 HTTPS여야 한다.

**iOS 로컬 네트워크 권한(iPhone만).** `NSAllowsLocalNetworking`은 HTTP 전송 정책일 뿐, 앱이 같은 Wi-Fi의 기기에 접근하는 권한을 대신하지 않는다. iOS는 앱별로 로컬 네트워크 접근을 따로 묻는다. 서버(A)에 처음 연결할 때 `"여행 동선"이(가) 로컬 네트워크의 기기를 찾아 연결하려고 합니다` 같은 알림이 뜨면 **허용**한다. 이 권한은 서버 API뿐 아니라 개발 빌드가 Metro(JS 제공)에 붙을 때도 쓰인다. 거부했거나 알림을 놓쳤다면 기기 브라우저에서는 401이 오는데(2-A 4단계) 앱만 서버에 연결되지 않는다. 이때는 iPhone 설정 ▸ 개인정보 보호 및 보안 ▸ 로컬 네트워크에서 `여행 동선`을 켜고 앱으로 돌아와 요청을 다시 시도한다(필요하면 앱을 종료했다가 다시 연다). 배포 서버(B)는 공용 인터넷 주소라 이 권한이 필요 없다. [Apple: 로컬 네트워크 개인정보 보호](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

### B. 배포 서버에 붙기

1. 서버를 HTTPS로 배포한다(T26D). 서버 환경 변수(`DATABASE_URL`, `GOOGLE_MOBILE_CLIENT_IDS`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_ROUTES_API_KEY`)와 전송 보안 요구는 [T29 결정](decisions/T29-transport-and-routes-budget.md)을 따른다.
2. `apps/mobile/.env.local`에 `EXPO_PUBLIC_API_URL=https://api.example.com`(본인 주소, 경로·쿼리 없음)을 쓴다.
3. 서버 주소를 바꾸면 Release 앱은 **다시 빌드해 설치**한다(주소가 JS 번들에 들어 있다). 서버 배포 위치가 바뀌어도 마찬가지다. Android Release는 같은 `android/` 빌드 디렉터리에서 `.env.local`의 주소만 바꾸면 Gradle이 JS 번들 작업을 건너뛰어 이전 주소가 남을 수 있으므로 `./gradlew assembleRelease --rerun-tasks`로 번들을 다시 만든다(§4-1 B). Debug 빌드는 Metro를 다시 시작해 앱을 다시 로드한다(§4-3). 주소를 바꾸기 전에 아래 "서버를 전환할 때"의 순서를 따른다.

### 서버를 전환할 때 (A ↔ B, 또는 서버 주소 변경)

앱은 로그인 세션 토큰을 서버 주소와 무관한 기기 저장소 키 하나(`travel.session.v1`)에 두고, 복원한 토큰을 **현재 `EXPO_PUBLIC_API_URL`로** 보낸다. 앱을 열면 유효한 세션을 복원해 곧바로 `내 여행` 화면에서 `Authorization: Bearer` 요청(`GET /api/trips`)을 보내므로, 로그인한 채 주소만 바꾸면 이전 서버의 토큰이 새 서버로 전송된다. 새 주소로 앱을 연 뒤에 토큰이 남은 걸 알아채면 이미 늦다. **주소를 바꾸기 전에** 토큰이 지워졌는지 확인한다.

1. **이전 서버 설정(주소를 바꾸기 전)에서** 앱의 `내 여행` ▸ 계정 ▸ **로그아웃**을 한다. 로그아웃은 서버 요청이 실패해도 기기의 토큰을 지운다. 이전 서버가 이미 내려가 있어도 이 단계는 필요하다. 로그아웃 뒤 **"기기에서 로그아웃했어요. 서버의 로그인 종료는 확인하지 못했어요."** 알림이 나오면 기기의 토큰만 지워졌고 이전 서버에서 세션이 폐기됐는지는 모르는 상태다. 로그인 화면으로 돌아왔다고 서버 폐기가 끝난 것이 아니다. 토큰이 기기에서 지워졌으니 새 서버로 전송되지는 않지만, 토큰은 발급 후 최대 30일까지 이전 서버에서 인증에 쓰일 수 있고, 만료된 세션 행도 이전 서버 DB에 이후까지 남을 수 있다(만료 행은 같은 사용자의 다음 세션 발급 때 정리한다). 이전 서버를 다시 쓸 수 있게 되면 아래 "이전 서버 DB에서 세션 폐기"로 지운다.
2. **같은 이전 설정에서** 앱을 종료했다가 다시 열어 **로그인 화면이 나오는지 확인한다.** `내 여행` 화면이 열리면 토큰이 남은 것이므로 주소를 바꾸지 말고 로그아웃을 다시 한다. "로그인 정보를 지우지 못했어요" 같은 저장소 오류가 나오면 **다시 시도**로 삭제를 마치고, 로그인 화면이 나온 뒤에만 다음으로 간다. iOS는 같은 번들 ID로 앱을 삭제·재설치해도 Keychain에 토큰이 남을 수 있어([SecureStore 데이터 보존](https://docs.expo.dev/versions/latest/sdk/securestore/#data-persistence)) 삭제·재설치는 토큰 제거 방법이 아니다. 앱 안의 로그아웃으로만 지운다.
3. 앱을 종료하고 `.env.local`의 `EXPO_PUBLIC_API_URL`을 바꾼다. Release는 다시 빌드·설치하고(Android는 `--rerun-tasks`, §4-1 B), Debug는 Metro를 `--clear`로 다시 시작해 앱을 다시 로드한다.
4. 새 서버에 Google 로그인한다.
5. 확인: 1·2단계에서 이전 설정의 로그아웃과 로그인 화면을 확인했다면 기기에 토큰이 없었으므로 새 서버로 전송된 토큰은 없다. 1·2단계를 확인하기 전에 새 주소로 앱을 열었다면 토큰이 전송됐는지 판별할 수 없다고 보고, 바로 아래 "이전 토큰이 새 서버로 전송됐다면"으로 이전 서버의 세션을 폐기한다. 기본 Next.js 서버 로그와 서버 코드는 요청에 `Authorization` 헤더가 있었는지 기록하지 않는다. `GET /api/trips`의 401은 헤더가 없을 때와 이전 서버의 토큰을 보냈을 때 모두 발생하고, 새 서버의 401로 기기 토큰이 지워져도 이전 서버의 세션은 유효할 수 있다. 헤더 확인은 리버스 프록시 로그 등 요청별 헤더 유무를 이미 관측할 수 있는 환경에서만 보조로 쓴다. 이때도 토큰 원문을 로그에 남길 필요는 없고 남기지 않는다(헤더 유무만 본다).

### 이전 토큰이 새 서버로 전송됐다면

서버는 세션 토큰의 SHA-256 해시만 `mobile_sessions`에 저장하고, 로그아웃(`DELETE /api/session`)은 **요청에 실린 그 토큰의 행 하나만** 지운다. 그래서 폐기 방법은 이전 토큰이 기기에 남아 있는지에 따라 다르다.

- **이전 토큰이 기기에 그대로 남아 있을 때만** 이전 서버에 연결한 앱에서 로그아웃하는 것으로 그 세션을 폐기할 수 있다. 로그아웃 뒤 "서버의 로그인 종료는 확인하지 못했어요." 알림이 나오면 폐기를 확인하지 못한 것이므로 아래 "이전 서버 DB에서 세션 폐기"를 이어서 한다. 새 서버가 이전 토큰에 401을 반환하면 앱이 기기의 토큰을 지우므로, 이 경우 이전 서버에 다시 로그인한 뒤 로그아웃해도 **방금 발급한 새 토큰의 행만** 삭제된다. 새 서버로 전송된 이전 토큰은 만료(발급 후 30일)까지 이전 서버에서 유효할 수 있다.
- **401이나 재로그인으로 토큰이 사라졌거나, 로그아웃의 서버 종료를 확인하지 못했다면** 이전 서버의 DB에서 세션 행을 직접 지운다.

#### 이전 서버 DB에서 세션 폐기

토큰 원문이 없으니 해시로는 찾을 수 없다. 먼저 본인 계정의 `users.id`를 확정하고, 이후 모든 쿼리를 그 `user_id`로 제한한다. `users.email`은 고유하지 않고 그 Google 계정이 **마지막으로 로그인했을 때의 값**일 뿐이다. 이메일이 바뀌었거나 다른 계정에 다시 쓰이면 이메일과 일치하는 행이 한 개여도 다른 사람의 계정일 수 있으므로, 이메일로는 계정을 확정하지 않는다. 계정은 Google 계정 고유 식별자(ID 토큰의 `sub`)와 같은 `users.google_id`(고유 제약이 있는 열)로만 확정한다.

`sub`는 본인 Google 계정으로 받은 ID 토큰의 payload에서 확인한다(예: [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)에서 `openid` 범위로 인증해 받은 `id_token`). 토큰은 로그인 자격이므로 **외부 디코더 사이트에 붙여 넣지 않고** 로컬에서 payload(두 번째 `.` 구간)만 base64url 디코드한다. 같은 Google 계정의 `sub`는 클라이언트와 서버가 달라도 같다.

```sql
-- 1. 확인한 sub로 본인 계정을 확정한다. 이메일은 쓰지 않는다.
SELECT id, google_id, email, created_at FROM users WHERE google_id = '<확인한 sub>';

-- 2. 그 user_id의 세션을 발급 시각순으로 확인한다.
SELECT id, created_at, expires_at FROM mobile_sessions
WHERE user_id = '<1에서 확정한 users.id>' ORDER BY created_at;
```

- **어느 행인지 알 수 있을 때**(새 서버에 전송된 토큰은 이전 서버에 다시 로그인하기 전에 만들어진 행이다) 그 행만 지운다. `id`와 `user_id`를 함께 조건으로 둔다.

  ```sql
  DELETE FROM mobile_sessions
  WHERE id = '<2에서 확인한 이전 세션 id>' AND user_id = '<1에서 확정한 users.id>';
  ```

- **어느 행인지 특정할 수 없다면** 확정한 `user_id`의 세션을 모두 폐기한다. 다른 기기(다른 휴대폰, 다른 서버 설정으로 쓰는 앱)의 로그인도 함께 풀리므로 각 기기에서 다시 로그인해야 한다. 가장 확실한 방법이다.

  ```sql
  DELETE FROM mobile_sessions WHERE user_id = '<1에서 확정한 users.id>';
  ```

1번 조회에서 **일치하는 행이 없으면 삭제하지 않고 중단한다.** 이 서버에 본인 계정이 없거나 `sub`가 틀린 것이며, 이메일로 대신 찾지 않는다. 이후 쿼리의 `<1에서 확정한 users.id>`는 반드시 이 조회의 `id`다.

계정 탈퇴(`DELETE /api/account`)도 모든 세션을 지우지만 여행 데이터까지 삭제되므로 이 목적에는 쓰지 않는다.

**이미 주소를 바꿨는데 로그아웃하지 않았다면**: 앱을 열지 않는다(열면 이전 토큰이 새 주소로 전송된다). `.env.local`을 이전 주소로 되돌리고, Release는 이전 주소로 다시 빌드·설치하며(Android는 `--rerun-tasks`), Debug는 Metro를 `--clear`로 다시 시작한다. 그 상태에서 앱을 열어 로그아웃하고 로그인 화면을 확인한 뒤 위 3단계부터 진행한다. 이전 서버가 내려갔어도 로그아웃은 기기 토큰을 지우므로 이전 주소의 빌드로 열어 로그아웃할 수 있다. 앱을 이미 새 주소로 열었고 로그아웃을 확인하지 못했다면 토큰 전송 여부를 판별할 수 없으니 확인하려 하지 말고 위 "이전 토큰이 새 서버로 전송됐다면"으로 바로 이어서 이전 서버 세션을 폐기한다. 토큰이 이미 지워졌다면 앱의 로그아웃으로는 폐기되지 않으니 "이전 서버 DB에서 세션 폐기"를 따른다. 이전 주소로 로그아웃해도 "서버의 로그인 종료는 확인하지 못했어요." 알림이 나오면 같은 DB 절차로 이어간다.

## 3. iOS 직접 설치 (무료 Apple ID + Xcode)

준비: macOS, Xcode(App Store), Xcode에 로그인한 Apple ID(Settings ▸ Accounts), USB로 연결한 iPhone(설정 ▸ 개인정보 보호 및 보안 ▸ 개발자 모드 켜기).

Google 로그인 모듈이 네이티브이므로 **Expo Go로는 로그인할 수 없다.** 개발 빌드를 만든다.

1. 의존성을 설치했는지 확인하고(§1의 `npm ci`) 프로젝트를 만든다.

   ```sh
   cd apps/mobile
   npx expo config --type public | grep bundleIdentifier   # §1에서 .env.local에 정한 APP_BUNDLE_ID와 같은지 확인
   npx expo prebuild --platform ios                 # ios/ 폴더 생성 (저장소에는 올라가지 않는다)
   ```

2. **빌드 전에 서명을 설정한다.** `ios/*.xcworkspace`를 Xcode로 열고 target ▸ Signing & Capabilities에서 **Automatically manage signing**을 켜고 Team을 본인 Apple ID(Personal Team)로 고른다. 번들 ID는 `APP_BUNDLE_ID`와 같아야 한다. `prebuild --clean`으로 `ios/`를 다시 만들면 서명 설정도 새로 만들어지므로 빌드 전에 이 단계를 다시 확인한다.
3. 서버 연결 방식(§2)에 맞는 **한 가지만** 실행한다. 두 명령을 연달아 실행하면 나중에 설치한 앱이 먼저 설치한 앱을 덮어쓴다. 특히 로컬 HTTP 주소(A)를 쓰는데 Release를 설치하면 앱이 그 주소를 거부한다.

   ```sh
   # A. 로컬 서버(HTTP): Debug 빌드. Metro가 JS를 제공한다.
   npx expo run:ios --device

   # B. 배포 서버(HTTPS): Release 빌드. JS를 앱에 포함한다.
   npx expo run:ios --device --configuration Release
   ```

4. 설치 뒤 기기에서 설정 ▸ 일반 ▸ VPN 및 기기 관리 ▸ 개발자 앱에서 본인 Apple ID를 **신뢰**한다.
5. **7일마다 다시 설치한다.** 무료 Apple ID로 서명한 앱은 7일 뒤 실행되지 않는다. 처음 설치한 것과 **같은 빌드 구성으로** 같은 `ios/`에서 다시 실행하면 앱 데이터를 지우지 않고 덮어쓴다. 로컬 HTTP 서버(A)로 쓰던 Debug 빌드는 `npx expo run:ios --device`, 배포 HTTPS 서버(B)로 쓰던 Release 빌드는 `npx expo run:ios --device --configuration Release`다. 구성을 바꿔 설치하면(예: Debug → Release) 서버 주소 규칙이 달라져 기존 `EXPO_PUBLIC_API_URL`이 거부될 수 있다. 번들 ID를 바꾸면 다른 앱으로 설치되고 로그인 세션도 새로 시작한다. 무료 계정은 동시에 설치할 수 있는 앱 수와 번들 ID 등록 수에 제한이 있다.
6. `app.config.ts`나 `APP_BUNDLE_ID`, 지도·로그인 키, 아이콘을 바꾸면 `npx expo prebuild --platform ios --clean`으로 `ios/`를 다시 만든 뒤, 2번처럼 Xcode에서 서명 설정을 확인하고 빌드한다.

## 4. Android APK 만들기

준비: JDK 17, Android SDK(Android Studio로 설치하고 `ANDROID_HOME` 설정), 개발자 옵션의 USB 디버깅을 켠 기기.

### 4-1. 빌드

먼저 프로젝트를 만든다.

```sh
cd apps/mobile
npx expo config --type public | grep package             # §1에서 .env.local에 정한 APP_BUNDLE_ID와 같은지 확인
npx expo prebuild --platform android             # android/ 폴더 생성 (저장소에는 올라가지 않는다)
```

서버 연결 방식(§2)에 맞는 **한 가지 경로만** 4-1부터 4-2까지 끝까지 따른다. 두 APK를 연달아 만들어 설치하면 나중에 설치한 앱이 먼저 설치한 앱을 덮어쓴다. 특히 `.env.local`에 로컬 HTTP 주소(A)를 둔 채 Release APK를 만들면 그 주소가 JS 번들에 들어가, 설치는 되지만 앱이 첫 로그인 요청에서 주소를 거부한다. A에서는 `assembleRelease`를 실행하지 않는다.

- **A. 로컬 서버(HTTP): Debug APK.** `.env.local`의 `EXPO_PUBLIC_API_URL`은 사설 IP의 HTTP 주소다(§2-A).

  ```sh
  (cd android && ./gradlew assembleDebug)          # 산출물: android/app/build/outputs/apk/debug/app-debug.apk
  ```

  이어서 §4-2 2번의 **A**로 `app-debug.apk`를 서명·설치하고, §4-3으로 Metro에 연결한다. Debug APK에는 JS 번들이 없고 앱이 쓰는 주소는 Metro를 시작한 환경의 값이므로, 주소만 바꿀 때는 다시 빌드하지 않는다.

- **B. 배포 서버(HTTPS): Release APK.** 빌드 전에 `.env.local`의 `EXPO_PUBLIC_API_URL`을 HTTPS 주소(§2-B)로 설정한다. 주소는 JS 번들에 들어간다.

  ```sh
  (cd android && ./gradlew assembleRelease)        # 산출물: android/app/build/outputs/apk/release/app-release.apk
  ```

  이어서 §4-2 2번의 **B**로 `app-release.apk`를 서명·설치한다. Release APK는 JS 번들을 포함하므로 Metro가 필요 없다.

**같은 `android/`에서 서버 주소(`EXPO_PUBLIC_API_URL`)만 바꿔 Release를 다시 만들 때**(예: 로컬 주소로 만든 Release를 HTTPS 주소로 다시 만들 때)는 `--rerun-tasks`를 붙인다. React Native 0.88.1의 번들 작업은 `.env.local`을 입력 파일로 추적하지 않아, 일반 `assembleRelease`는 JS 번들 작업을 최신 상태로 보고 건너뛰어 이전 주소가 APK에 남을 수 있다.

```sh
(cd android && ./gradlew assembleRelease --rerun-tasks)   # 번들을 다시 생성한다. 이어서 §4-2 2번 B대로 서명·설치
```

새 APK가 새 주소를 쓰는지 확인하려면, 주소만 바꾼 두 번째 APK를 설치해 로그인 화면이 나온 뒤 새 서버가 요청을 받는지 본다(전환 전 로그아웃 순서는 §2 "서버를 전환할 때"). `prebuild --clean`으로 `android/`를 새로 만든 경우에는 번들도 새로 만들어진다.

`npx expo run:android --device`는 템플릿 키로 서명한 앱을 설치하므로 개인 키로 설치한 앱과 서명이 충돌하고 **실제 Google 로그인 확인에는 쓰지 않는다**(§4-2). 이 명령을 쓰려면 먼저 `adb uninstall <APP_BUNDLE_ID>`로 개인 키 앱을 지운다.

### 4-2. 개인 키로 서명하고 설치하기

Expo SDK 58 템플릿은 Debug와 Release 모두 템플릿에 들어 있는 `debug.keystore`로 서명한다. 이 키는 공개 저장소에 있어 **누구나 같은 서명을 만들 수 있다.** 패키지명 + SHA-1 조합이 내 빌드를 식별해야 하는 Google OAuth 클라이언트와 지도 키 제한에는 이 키의 SHA-1을 등록하지 않는다. 본인만 가진 키로 APK를 다시 서명하고 그 인증서의 SHA-1을 등록한다.

1. 개인 키 저장소를 **`android/` 밖**에 한 번만 만든다. `prebuild --clean`은 `android/`를 지우므로 키를 거기 두면 사라져 같은 서명으로 업데이트할 수 없다. 저장소에는 올리지 않고 백업해 둔다(분실하면 삭제 후 재설치해야 한다).

   ```sh
   mkdir -p ~/.android-keys
   keytool -genkeypair -v -keystore ~/.android-keys/travel.keystore -alias travel \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 4-1에서 만든 APK를 개인 키로 서명한다. 서명은 빌드 뒤에 하므로 `prebuild --clean`을 해도 같은 키로 서명된다. `apksigner`는 Android SDK의 `build-tools/<버전>/`에 있다. 4-1에서 고른 경로 **한 가지만** 실행하고, 서명하는 파일은 바로 앞 4-1 단계에서 만든 APK여야 한다.

   ```sh
   cd apps/mobile
   APKSIGNER=$ANDROID_HOME/build-tools/<설치된 버전>/apksigner

   # A. 로컬 서버(HTTP): 4-1 A의 Debug APK. 설치 뒤 §4-3으로 Metro에 연결한다.
   $APKSIGNER sign --ks ~/.android-keys/travel.keystore --ks-key-alias travel \
     --out travel-debug.apk android/app/build/outputs/apk/debug/app-debug.apk
   $APKSIGNER verify --print-certs travel-debug.apk     # 서명 인증서 SHA-1 확인
   adb install -r travel-debug.apk                      # 연결한 기기에 설치 (APK 파일을 기기로 옮겨 열어도 된다)

   # B. 배포 서버(HTTPS): 4-1 B의 Release APK
   $APKSIGNER sign --ks ~/.android-keys/travel.keystore --ks-key-alias travel \
     --out travel-release.apk android/app/build/outputs/apk/release/app-release.apk
   $APKSIGNER verify --print-certs travel-release.apk   # 서명 인증서 SHA-1 확인
   adb install -r travel-release.apk
   ```

   Debug와 Release APK는 같은 패키지명이라 서로 덮어쓴다. 같은 패키지의 앱이 다른 키(템플릿의 디버그 키 포함)로 서명돼 설치돼 있으면 `adb install -r`이 실패하므로 `adb uninstall <APP_BUNDLE_ID>` 뒤 설치한다(앱 데이터와 로그인 세션이 지워진다).

3. 인증서 SHA-1은 위 `verify` 출력이나 `keytool -list -v -keystore ~/.android-keys/travel.keystore -alias travel`로 확인해 등록한다.
   - **Google 로그인(Android)**: Google Cloud의 Android OAuth 클라이언트에 패키지명(`APP_BUNDLE_ID`)과 이 SHA-1을 등록한다.
   - **지도 키**: Maps SDK for Android 키는 앱(패키지명 + 이 SHA-1)으로, iOS 키는 번들 ID로 제한한다.
4. `app.config.ts`·`APP_BUNDLE_ID`·키·아이콘을 바꿨다면 `npx expo prebuild --platform android --clean` 뒤 다시 빌드·서명한다. **패키지명(`APP_BUNDLE_ID`)과 서명 키가 모두 이전과 같을 때만** `adb install -r`이 기존 앱을 데이터와 로그인 세션을 유지한 채 업데이트한다. `APP_BUNDLE_ID`를 바꾸면 `android.package`가 달라지므로 새 APK는 **별도 앱으로 설치되고 기존 앱은 기기에 그대로 남는다.** 새 앱에서는 기존 로그인 세션을 이어 쓸 수 없으니 다시 로그인하고, 필요하면 기존 앱은 `adb uninstall <이전 APP_BUNDLE_ID>`로 지운다. 키를 바꾼 경우는 위 Debug APK 설명처럼 `adb uninstall` 뒤 설치한다.

### 4-3. 개인 키 Debug APK로 로컬 서버(A)에 로그인하기

Debug APK는 JS를 앱에 담지 않고 실행할 때 Metro(개발 서버, 8081번 포트)에서 받는다. 개인 키로 서명한 Debug APK(§4-2 2번의 A, `travel-debug.apk`)로 같은 Wi-Fi의 로컬 API 서버에 Google 로그인하려면 다음 순서로 Metro를 연결한다.

1. API 서버를 §2-A대로 `npm run dev -- -H 0.0.0.0`으로 띄우고, Metro를 실행할 `apps/mobile/.env.local`에 `EXPO_PUBLIC_API_URL=http://<컴퓨터 사설 IP>:3000`을 쓴다. Debug APK는 JS를 Metro에서 받으므로 앱이 쓰는 서버 주소는 APK를 빌드한 환경이 아니라 **Metro를 시작한 환경의 값**이다.
2. 컴퓨터에서 Metro를 시작한다.

   ```sh
   cd apps/mobile
   npx expo start --dev-client
   ```

3. 기기가 Metro에 닿게 한다. 둘 중 하나를 쓴다.
   - **USB 연결(권장):** 기기를 USB로 연결하고 `adb reverse tcp:8081 tcp:8081`을 실행한다. 기기의 `localhost:8081`이 컴퓨터의 Metro로 이어진다. USB를 뺐다 꽂거나 `adb`를 재시작하면 다시 실행한다.
   - **같은 Wi-Fi:** 컴퓨터 방화벽에서 8081번 포트를 허용한다. 앱을 열면 Metro에 닿지 못해 "Unable to load script" 빨간 화면이 나온다. 개발 메뉴(기기를 흔들거나 `adb shell input keyevent 82`)에서 **Dev Settings ▸ Debug server host & port for device**를 열고 `192.168.1.10:8081`처럼 **`http://` 없이 호스트와 포트만** 입력한다(서버 주소 `http://192.168.1.10:3000`과 입력 형식이 다르다). 그 뒤 개발 메뉴의 **Reload**로 JS를 다시 받는다.
4. 기기에 설치된 `여행 동선` 앱을 **직접 연다**(`expo run:android`를 쓰지 않으므로 앱이 자동으로 열리지 않는다). 앱이 Metro에서 JS를 받으면 로그인 화면이 열리고, Google 로그인 뒤 API 서버(`EXPO_PUBLIC_API_URL`)로 요청한다.
5. JS 코드만 바꿨다면 앱을 다시 설치하지 않고 Metro가 새로 고친다. **서버 주소(`EXPO_PUBLIC_API_URL`)만 바꿨다면** 먼저 이전 서버에서 앱을 로그아웃해 기기 세션을 지운 뒤(§2 "서버를 전환할 때"; 로그인한 채 바꾸면 이전 서버의 토큰이 새 서버로 전송된다), `.env.local`을 고치고 Metro를 다시 시작(`npx expo start --dev-client --clear`)한 뒤 앱을 전체 다시 로드(개발 메뉴의 Reload)한다. 다시 빌드하지 않는다. 네이티브 설정(`app.config.ts`, `APP_BUNDLE_ID`, 지도·로그인 키, 아이콘)을 바꿨다면 다시 빌드·서명·설치한다.

Metro 없이 쓰려면 Release APK와 HTTPS 서버(B)를 쓴다.

## 5. 설치 뒤 직접 확인할 것 (사람)

CI가 대신 검증하지 못하는 항목이다.

- [ ] 홈 화면 아이콘과 앱 이름(`여행 동선`), 시작 화면 색
- [ ] iOS + 로컬 서버(A): 첫 연결 때 로컬 네트워크 접근 허용 알림, 거부했다면 설정에서 켠 뒤 연결
- [ ] Google 로그인 → `내 여행` 첫 화면 (서버 `aud` 설정 포함)
- [ ] 선택한 서버 주소(A 또는 B)로 여행 생성 → 동선 결과 → 지도 표시
- [ ] 결과 지도의 현재 위치 권한 요청
- [ ] iOS: 7일 뒤 재설치 절차
- [ ] 로그아웃·탈퇴, 공유 링크 발급

## 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| 앱이 "서버 주소 설정을 확인해 주세요."를 표시 | 주소가 HTTPS가 아니거나(릴리스 빌드), 경로·쿼리가 있거나, 사설 IP 범위를 벗어났다. `EXPO_PUBLIC_API_URL`을 고친다. Release는 다시 빌드, Debug는 Metro를 `--clear`로 다시 시작해 앱을 다시 로드 |
| 기기에서 서버에 접속되지 않음 | 같은 Wi-Fi인지, 서버를 `-H 0.0.0.0`으로 띄웠는지, 컴퓨터 방화벽 포트 3000, 컴퓨터 IP가 바뀌지 않았는지 |
| iOS에서 브라우저는 서버 401을 받는데 앱만 서버·Metro에 연결되지 않음 | 로컬 네트워크 권한을 거부했다. 설정 ▸ 개인정보 보호 및 보안 ▸ 로컬 네트워크에서 `여행 동선`을 켜고 요청을 다시 시도(§2-A) |
| iOS "Failed to register bundle identifier" | 번들 ID가 다른 개발자와 겹친다. `APP_BUNDLE_ID`를 본인 값으로 바꾸고 `prebuild --clean` |
| iOS 앱이 열리자마자 종료됨 | 7일이 지났거나 개발자 앱이 신뢰되지 않았다. 재설치·신뢰 설정 |
| Android Debug APK가 "Unable to load script" 빨간 화면 | Metro에 연결되지 않았다. `npx expo start --dev-client` 실행 여부, `adb reverse tcp:8081 tcp:8081`(USB) 또는 8081 방화벽과 개발 메뉴의 `192.168.1.10:8081` 형식 호스트 설정(Wi-Fi), §4-3 |
| `APP_BUNDLE_ID` 예약어 오류 | `class`·`package`·`new` 같은 Java·Kotlin 예약어를 한 단계로 쓸 수 없다. `com.classic.travel`처럼 바꾼다 |
| Google 로그인이 `DEVELOPER_ERROR`(Android) | 패키지명과 SHA-1이 OAuth 클라이언트와 다르다 |
| 서버가 로그인을 거부(401) | 서버 `GOOGLE_MOBILE_CLIENT_IDS`에 Web OAuth 클라이언트 ID가 없다 |
