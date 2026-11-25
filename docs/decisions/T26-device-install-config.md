# T26 기기 설치 설정과 안내

## 결정

- 앱 설정(`apps/mobile/app.config.ts`)을 `createConfig(env)` 함수로 나눠 환경 변수를 인자로 받는다. 기본 내보내기는 `createConfig(process.env)`이고, 테스트는 환경을 바꿔 같은 함수를 호출한다.
- 앱 이름 `여행 동선`, 아이콘·적응형 아이콘·스플래시(`apps/mobile/assets/`, 스카이 블루 `#2A64A8` + 흰 핀)를 설정한다. 이미지는 `scripts/generate-icons.mjs`(Node 내장 모듈만 사용)로 만든 PNG를 커밋한다. 디자인을 바꿀 때만 다시 만든다. Expo SDK 58에는 최상위 `splash` 설정이 없어 스플래시는 `expo-splash-screen` plugin(`~58.0.14`, Expo가 지정한 버전)으로 설정하고, 이를 위해 이 의존성을 앱에 추가한다.
- iOS 번들 ID와 Android 패키지명은 같은 값을 쓰며 환경 변수 `APP_BUNDLE_ID`로 정한다. 기본값은 `com.travelscheduling.app`이다. 두 플랫폼에서 모두 유효한 형식(각 단계가 영문자로 시작하고 영문·숫자만 사용, 두 단계 이상. iOS 번들 ID에 쓸 수 없는 밑줄은 거부. Android 패키지명이 Gradle namespace·네이티브 소스의 `package` 선언이 되므로 `class` 같은 Java·Kotlin 예약어 단계도 거부)만 받고 틀리면 설정 읽기 단계에서 오류를 낸다.
- iOS에는 `NSAllowsLocalNetworking`(개발 빌드가 같은 Wi-Fi의 http 서버에 붙음)과 `ITSAppUsesNonExemptEncryption: false`를 둔다. 운영 주소의 HTTPS 강제는 기존 `src/api/origin.ts`가 계속 맡는다. 이 설정은 HTTP 전송(ATS)만 허용하며, iOS의 앱별 로컬 네트워크 접근 권한은 사용자가 첫 연결 때 허용해야 한다(거부 시 설정 앱에서 변경). 안내는 `docs/mobile-install.md` §2-A·문제 해결에 있다.
- `expo prebuild`가 만드는 `apps/mobile/ios/`·`android/`는 저장소에 올리지 않는다(`.gitignore`). `app.config.ts`가 유일한 원본이다.
- 설치 절차는 `docs/mobile-install.md`에 정리한다: 로컬 서버(같은 Wi-Fi, 개발 빌드)와 배포 서버(HTTPS, 릴리스) 두 연결 방식, iOS 직접 설치(무료 Apple ID, 처음 쓴 빌드 구성 그대로 7일마다 재설치), Android APK(공개된 템플릿 디버그 키 대신 `android/` 밖의 개인 키 저장소로 `apksigner` 재서명하고 그 SHA-1을 Google에 등록).

## 이유

- 무료 Apple ID는 다른 개발자와 겹치는 번들 ID를 쓸 수 없어 사용자마다 값을 바꿔야 한다. 코드 수정 없이 환경 변수로 바꾸면 `.env.local` 한 곳에서 서버 주소·키와 함께 관리된다.
- 설정을 함수로 나누면 `expo config` 실행과 별개로 값 규칙(형식 검증, 플러그인 조건)을 빠르게 검사할 수 있다.
- 릴리스 빌드가 HTTP 주소를 거부하는 기존 정책(T29)과 맞춰, 안내에서 로컬 Wi-Fi 연결은 개발 빌드, 실사용은 HTTPS 배포 서버로 나눈다.
- 네이티브 프로젝트를 커밋하면 `app.config.ts`와 어긋나는 값이 생기고 사용자별 번들 ID·서명 설정이 섞인다.

## 대안

- 번들 ID를 `app.config.ts`에 고정: 사용자가 파일을 고쳐야 하고 저장소에 개인 값이 들어갈 위험이 있다.
- 네이티브 폴더 커밋(bare 워크플로): 설정 원본이 둘이 된다.
- EAS Build: 계정·클라우드가 필요하다. 본인 사용 목적에서 로컬 빌드로 충분하다고 보고 범위에서 뺐다.
- Python 아이콘 생성기: 저장소 도구는 Node뿐이라 Node 스크립트로 통일했다.

## 검증

| 완료 기준 | 검사 |
|---|---|
| 앱 이름·아이콘·번들 ID 설정 | `apps/mobile/tests/app-config.test.ts`: 기본값, `APP_BUNDLE_ID` 반영·잘못된 형식·예약어 단계(`com.class.travel`) 거부와 `com.classic.travel` 반영, 아이콘·적응형 아이콘·스플래시 파일 존재와 PNG 크기(1024×1024) |
| 서버 주소·키 설정 | 같은 테스트의 플러그인(Google 로그인 조건부, 지도 키 플랫폼별) 검사. 주소 규칙은 기존 `api-origin.test.ts` |
| 설정 검사(`expo config`)가 CI에서 통과 | 같은 테스트가 `expo config --type public --json`을 실행해 기본값과 `APP_BUNDLE_ID` 반영을 확인(루트 `npm test`가 포함) |
| 설치·APK·로컬/배포 서버 안내 | `docs/mobile-install.md`(문서 링크는 `architecture.test.ts` 범위) |
| 실제 기기 설치 | 사람이 확인(문서 §5 체크리스트) |

`expo prebuild`·Xcode·Gradle 빌드는 네이티브 도구와 네트워크가 필요해 CI에서 실행하지 않는다.
