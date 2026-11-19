# T16 앱 전환 설계

기준: 작업 시작 원격 `develop` 3c9cb12. 구조·계약 본문은 [아키텍처 §13](../architecture.md#13-t16-앱-전환-후-구조-계획)에 있다.
이 기록은 결정과 이유, 버린 대안만 적는다. 코드 동작은 바꾸지 않았다.

## 결정

1. **모노레포 세 덩어리 + 공용 두 패키지.** npm workspaces로 `apps/server`(Next.js: API와 공유 열람 페이지),
   `apps/mobile`(Expo, expo-router), `packages/core`(`@travel/core`: scheduler·fare·앱과 서버가 같이 쓰는 DTO와 입력 검증·표시 변환),
   `packages/design-tokens`(`@travel/design-tokens`: `docs/design.md`의 값)로 나눈다. 앱과 서버는 서로 import하지 않고
   공용 패키지에만 의존한다. 공용 패키지는 Node 내장 모듈·DB·네트워크·React·React Native·Next에 의존하지 않는다.
2. **DTO와 포트를 나눠서 옮긴다.** 지금 한 파일에 DTO와 서버 포트가 같이 있는 곳(`services/itinerary/types.ts`,
   `places/index.ts`, `travel-time/index.ts`, `settings/model.ts`, `sharing/model.ts`)은 T17에서 DTO 타입·오류 클래스만 core로 옮기고
   저장소·제공자 포트는 서버에 남긴다. 서버의 기존 경로는 core를 다시 export해서 호출 지점을 유지한다.
3. **API 계약은 기존 라우트를 그대로 쓴다.** 앱 전용 새 경로는 로그인 세션(`/api/session`), 탈퇴(`/api/account`),
   구간 경로 모양(`/api/trips/[id]/itinerary/shapes`) 세 개뿐이다. 요청·응답 DTO는 core 타입이 기준이다.
   오류 본문은 지금의 `{ error, fields? }`에 기계용 `code`를 **추가**한다(기존 필드는 유지, T18이 구현).
   `fields`는 현재 응답에 있는 두 형태, 즉 필드별 메시지(`Record<string, string>`)와 보완할 필드 이름 목록(`readonly string[]`,
   `POST …/itinerary`의 `INCOMPLETE`)을 모두 계약에 둔다. 한 형태로 합치면 기존 응답이 바뀌므로 하지 않는다.
4. **모바일 세션 토큰은 DB에 해시만 저장하는 불투명 토큰이다.** 앱이 네이티브 Google 로그인으로 받은 ID 토큰을
   `POST /api/session`에 보내면 서버가 Google JWKS로 서명·발급자·대상·만료·이메일 확인을 검사하고, 256비트 난수 토큰을 만든다.
   `mobile_sessions`에 SHA-256 해시와 만료(발급 후 30일, 연장 없음)를 저장한다. 로그아웃은 그 행 삭제, 탈퇴는 `users` 삭제의
   FK cascade로 모든 세션을 지운다. 앱은 원문을 기기 보안 저장소(`expo-secure-store`)에만 둔다.
5. **소유권 검사는 바꾸지 않는다.** 모든 HTTP 처리기가 이미 주입받는 `userId` 의존성만 요청 기반
   `userId(request)`로 바꾼다. 처리기 없이 라우트에서 `auth()`를 직접 부르는 `GET /api/trips/[id]`
   (`src/app/api/trips/[id]/route.ts`)도 같은 `RequestAuthenticator.userId(request)`로 바꾼다. 빠뜨리면 이 API만 Bearer를 받지 못하고
   T25의 `src/auth.ts` 삭제 때 참조가 남는다. `Authorization` 헤더가 있으면 Bearer만 보고(실패 시 401, 쿠키로 넘어가지 않음), 없으면 T25 전까지
   Auth.js 쿠키 세션을 본다. 그 뒤의 `authorizeTrip`(401/403/404)과 저장소의 owner_id 조건은 그대로다.
6. **구간 경로 모양은 저장하지 않는다.** 최신 저장 일정의 각 구간(`comparisons`)을 실제 출발 instant와 선택 수단으로 Routes
   `computeRoutes`에 다시 요청하고 field mask는 `routes.polyline.encodedPolyline` 하나만 쓴다. 응답의 인코딩된 polyline을 그대로
   앱에 전달하며 DB·서버 메모리·앱 디스크에 남기지 않는다. 경로가 없으면 `{ status: 'NONE' }`으로 구분하고, 제공자 장애는
   `TravelProviderError`(502/503)로 요청 전체를 실패시킨다. 새 포트 `RouteShapeProvider`를 이동시간 모듈에 따로 둔다.
7. **지도는 앱 안의 어댑터 하나 뒤에 둔다.** 화면은 `ResultMap` 컴포넌트 계약(마커·구간·선택·여백)만 알고,
   구현은 `react-native-maps`의 Google 제공자(실제)와 가짜 지도(테스트) 두 개다. 경로 해독·구간 색 보간·도심 밖 판정·패널 스냅은
   지도 SDK와 무관한 순수 함수로 앱에 둔다.
8. **앱 테스트는 CI에서 컴포넌트 테스트와 JS 번들 생성까지, 기기 확인은 사람이 한다.** 앱 테스트는 `jest-expo` +
   React Native Testing Library로 목 API와 가짜 지도를 쓴다. `expo export`로 iOS·Android 번들을 만든다. 루트 `test`·`build`가
   모든 워크스페이스를 실행하므로 CI 워크플로는 바꾸지 않는다.
9. **디자인 토큰은 `packages/design-tokens` 한 곳에 둔다.** 앱(T20–T24)과 공유 열람 웹 페이지(T24)가 같은 값을 써야 하므로
   앱 폴더가 아니라 공용 패키지에 둔다. 값만 담고(hex 문자열, pt 숫자, ms), React Native 스타일과 CSS 변수 변환은 각 앱이 한다.
10. **T25에서 지울 웹 전용 코드 목록**을 아키텍처 §13.8에 경로로 고정하고, 목록의 경로가 실제로 있는지 테스트로 검사한다.

## 이유

- 서버 API·DB·순수 코어는 이미 화면과 분리되어 있다(ADR 0001). 앱 전환은 화면과 인증 진입점만 바꾸면 되므로, 새 경로를
  최소로 두면 기존 소유권·입력 해시·오류 계약과 테스트를 그대로 재사용할 수 있다.
- 공용 패키지를 순수하게 두면 React Native 번들에 `pg`·Node 내장 모듈이 섞이지 않고, 앱과 서버가 같은 검증기를 쓴다
  (요구사항 T21 "같은 규칙을 다시 만들지 않음").
- 불투명 토큰 + 해시 저장은 이미 공유 링크(T14)에서 쓰는 방식이다. JWT와 달리 로그아웃·탈퇴 즉시 폐기되고,
  DB가 유출돼도 원문 토큰이 없다. 매 요청 조회 1회는 지금도 세션 콜백이 `users`를 조회하는 것과 같은 수준이다.
- 헤더가 있으면 Bearer만 보는 규칙은 "잘못된 토큰은 401"을 보장하고, 쿠키와 토큰 중 어느 쪽 사용자인지 섞이지 않게 한다.
  Bearer는 브라우저가 자동으로 붙이지 않으므로 교차 사이트 요청 위조 대상이 아니다. 기존 Origin 검사는 Origin이 없는 요청을
  허용하므로 앱 요청과 충돌하지 않는다.
- Google Maps Platform 약관은 장소 ID와 제한된 좌표 외의 콘텐츠 저장을 허용하지 않는다(ADR 0003, ADR 0005와 같은 판단).
  경로 모양도 그 예외에 들지 않는다고 보고 저장하지 않는다. 결과 저장과 분리된 조회 API이면 동선 계산 루프(ADR 0008)의 호출 수가
  늘지 않고, 결과 화면을 열 때만 비용이 든다.
- `TravelTimeProvider`에 메서드를 더하면 이동시간만 필요한 서비스와 가짜 구현이 쓰지 않는 메서드를 구현해야 한다(인터페이스 분리).
- 지도 SDK는 CI에서 실행할 수 없으므로 어댑터 뒤에 두어야 결과 화면 테스트가 가능하다. 계산을 순수 함수로 빼면 SDK 없이 검증된다.

## 대안

- **앱과 서버를 별도 저장소로 분리:** 공용 DTO·검증을 패키지로 배포해야 하고 버전이 어긋난다. 채택하지 않음.
- **공용 패키지 하나에 토큰까지 포함:** 도메인 코어와 디자인 값은 바뀌는 이유가 다르다. 패키지를 둘로 나눔.
- **토큰을 `apps/mobile/src/theme`에만 두기:** 공유 웹 페이지가 같은 값을 다시 정의하게 된다. 채택하지 않음.
- **서명된 JWT 세션(서버 무상태):** 폐기 목록이 따로 필요하고 탈퇴 즉시 무효화가 어렵다. 채택하지 않음.
- **Google ID 토큰을 매 요청 직접 사용:** 만료가 1시간이라 앱이 자주 다시 로그인해야 하고, 로그아웃 폐기가 불가능하다.
- **슬라이딩 만료(사용할 때마다 연장):** 매 요청 쓰기가 생긴다. 본인 사용 범위에서는 30일 고정 + 재로그인으로 충분하다.
- **앱 웹뷰 OAuth / Auth.js 쿠키 재사용:** Google이 내장 웹뷰 로그인을 막는다(요구사항 §2).
- **동선 생성 응답에 polyline 포함:** 재조회 루프마다 필드가 늘고, 저장하지 않으므로 다시 열면 사라진다. 별도 GET이 단순하다.
- **polyline을 결과와 함께 DB 저장:** 약관 확인 전에는 하지 않는다. 허용이 확인되면 ADR 0005를 갱신해 다시 정한다(T19).
- **경로 모양 없이 직선 표시:** 요구사항(도로를 따라 그리는 경로)에 맞지 않는다. 다만 조회 실패 시 앱의 대체 표시로 쓴다.
- **앱 테스트를 기존 `node:test`로 실행:** React Native 변환·목 모듈 지원이 없다. 앱만 jest-expo를 쓰고 서버·core는 그대로 둔다.
- **Detox 등 기기 에뮬레이터 E2E를 CI에서 실행:** macOS 러너·시뮬레이터 비용이 크다. 서버 흐름은 T25의 HTTP 종단 시나리오로 검증한다.

## 검증과 한계

- [`tests/app-transition-design.test.ts`](../../tests/app-transition-design.test.ts)가 §13의 필수 항목, 모든 기존 API 라우트·메서드가
  계약 표에 있는지, 새 경로 계약, 세션 토큰 항목, 디자인 토큰 위치, T25 삭제 목록의 경로가 실제로 존재하는지 검사한다.
- [`tests/app-transition-contract.test.ts`](../../tests/app-transition-contract.test.ts)는 실제 처리기의 오류 응답(`fields` 목록·필드별 메시지)이
  문서의 `ApiErrorFields`에 맞는지, `auth()`를 직접 import하는 모든 API 라우트가 Bearer 전환 대상과 T18 검증 계획에 있는지 검사한다.
- 계획 단계의 인터페이스(§13의 `ts` 블록)는 아직 구현이 없어 타입 검사 대상이 아니다. 구현하는 작업(T18–T22)이 실제 export와 함께
  `typescript` 블록으로 바꿔 [architecture.test.ts](../../tests/architecture.test.ts)의 타입 검사에 넣는다.
- Google 약관(경로 모양 저장 금지 범위), Android 네이티브 로그인의 ID 토큰 `aud` 값, 실제 기기 동작은 사람 확인이 필요하다
  ([질문](../questions.md)).
