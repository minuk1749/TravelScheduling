# T18 모바일 로그인 토큰 API

기준: 작업 시작 원격 `develop` 0b1aab5. 계약 본문은 [아키텍처 §13.2–13.3](../architecture.md#133-모바일-세션-토큰), 설계 이유는 [T16 결정](T16-app-transition.md)에 있다.
이 기록은 T16 계획을 구현하면서 새로 정한 것만 적는다.

## 결정

1. **Google ID 토큰 검증은 `jose`로 한다.** `createRemoteJWKSet`(Google JWKS, 키 캐시·재조회 포함) + `jwtVerify`로 RS256만 허용하고
   `iss`(두 형태), `aud`(`GOOGLE_MOBILE_CLIENT_IDS` 목록), `exp`(필수, 60초 오차), `sub`(필수), `email_verified === true`, `email`을 검사한다.
   토큰 자체의 문제(서명·클레임·형식·알 수 없는 `kid`)는 `null` → 401 `INVALID_GOOGLE_TOKEN`, 키 조회 실패(네트워크·비 200·잘못된 JSON·시간 초과)는
   `GoogleKeysUnavailableError` → 503 `PROVIDER_UNAVAILABLE`로 나눈다. 허용 `aud` 목록이 비어 있으면 모든 토큰을 거부한다.
2. **포트는 런타임 코드 없는 `lib/auth/ports.ts`에 둔다.** 구현(`google-id-token.ts`, `mobile-sessions.ts`, `request-authenticator.ts`, `session-store.ts`)은
   포트를 import하고 다시 export한다. 아키텍처 문서의 `typescript` 블록이 Node 타입 없이 포트를 타입 검사할 수 있다.
3. **불투명 토큰 규칙은 `lib/opaque-token.ts` 하나다.** 43자 base64url 난수·형식 검사·SHA-256 hex를 공유 링크(T14 `SharingService`)와 모바일 세션이 같이 쓴다.
   기존 `hashShareToken` export는 같은 함수를 가리켜 호출 지점을 유지한다.
4. **`SessionRequestAuthenticator`가 요청 인증의 유일한 구현이다.** `Authorization` 헤더가 있으면 `Bearer <43자>`만 받고(스킴 대소문자 무시)
   형식 오류·없음·만료·폐기는 모두 `undefined`(401)이며 쿠키로 넘어가지 않는다. 헤더가 없을 때만 생성자로 받은 쿠키 함수(Auth.js, T25까지)를 부른다.
   `lib/auth/server.ts`가 쿠키 포함 `requestAuthenticator`와 Bearer 전용 `bearerAuthenticator`를 조립한다.
5. **6개 HTTP 처리기의 의존성은 `userId(request)`다.** 각 `server.ts`는 `requestAuthenticator.userId(request)`를 넘긴다. `GET /api/trips/[id]`는
   `trips/http.ts`의 `tripAccessHandler`로 옮겨 같은 인증을 쓴다. API 라우트 중 `src/auth.ts`를 import하는 것은 Auth.js 라우트뿐이다.
6. **`DELETE /api/account`는 Bearer 전용이다.** 쿠키 세션 웹 화면은 T25까지 기존 서버 액션 `withdraw`를 쓴다.
   `DELETE /api/session`은 형식이 맞는 Bearer 헤더만 요구하고 DB에 없어도 204다(멱등).
7. **`POST /api/session`은 JSON(`content-type`)만 받고 본문 16KB, `idToken` 8KB 상한이다.** Origin 검사는 하지 않는다. 응답 본문으로만 토큰을 돌려주므로
   교차 사이트 요청이 성공해도 공격자는 응답을 읽지 못하고 쿠키도 생기지 않는다.
8. **세션 저장은 `mobile_sessions`(마이그레이션 007)이다.** `token_hash`는 64자 소문자 hex `CHECK`로 원문 저장을 DB에서 막는다. 발급 SQL 한 문장이
   같은 사용자의 만료 행을 지우고 새 행을 넣는다. 만료 판단은 DB의 `now()`가 한다.
9. **오류 `code`를 모든 처리기에 추가한다.** `lib/http.ts`의 `apiError`·`accessError`·`providerError`로 만들고 기존 `error`·`fields`·상태 코드는 그대로다.
   생활 설정 409는 `SettingsError.code`로 동시 편집(`STALE_INPUT`)과 저장 형식 불일치(`INCOMPLETE_TRIP`)를 나눈다.

## 이유

- `jose`는 이미 Auth.js가 쓰는 의존성이라 새 공급망을 늘리지 않고, JWKS 캐시·`kid` 회전·시간 초과를 직접 구현하지 않아도 된다.
  원격 JWKS 로더의 fetch만 테스트에서 바꾸면 실제 코드 경로(키 선택·재조회·오류 종류)를 그대로 검사할 수 있다.
- 토큰 문제와 키 조회 장애를 섞으면, Google 장애 때 앱이 사용자를 로그아웃시키거나(401) 잘못된 토큰을 재시도하게 된다(503).
- 쿠키 함수를 생성자 인수로 받으면 Bearer 전용·쿠키 포함 두 경우가 같은 클래스이고, T25는 쿠키 인수만 지우면 된다.
- 한 규칙(토큰 형식·해시)을 두 곳에 두면 공유 링크와 세션 중 한쪽만 바뀌는 사고가 생긴다.
- 기존 웹 화면이 쓰는 `withdraw` 서버 액션은 Next의 액션 보호를 받는다. 새 쿠키 기반 삭제 API를 열면 웹 쪽 교차 사이트 방어를 따로 검증해야 한다.

## 대안

- **`google-auth-library`의 `OAuth2Client.verifyIdToken`:** 의존성이 크고(gaxios 등) 키 조회 실패와 토큰 오류를 같은 예외로 던진다. 채택하지 않음.
- **`node:crypto`로 직접 JWKS·RS256 검증:** e2e 이중 구현과 같은 방식이지만 키 캐시·회전·시간 초과를 다시 만들어야 한다. 채택하지 않음.
- **처리기마다 Bearer 파싱:** 같은 규칙이 7곳에 생긴다. `RequestAuthenticator` 하나로 모았다.
- **`/api/account`에 쿠키도 허용:** 웹 탈퇴를 API로 옮길 수 있지만 교차 사이트 삭제 방어를 새로 검증해야 한다. T25에 웹이 사라지므로 하지 않음.
- **`ownedTables`·`seedTravelGraph`에 `mobile_sessions` 추가:** 기존 마이그레이션 테스트가 001–003만 적용한 스키마에도 같은 헬퍼를 써서 깨진다.
  FK 인덱스 검사는 모든 FK를 자동으로 보고, 행 시각·트리거는 `mobile-session-db.test.ts`가 따로 검사한다.

## 검증

- `apps/server/tests/mobile-session.test.ts`: 서명(다른 키·변조·무서명)·발급자·대상·만료(오차 안/밖)·이메일 확인·형식 오류 → `null`/401,
  JWKS 장애 3종 → 503, 발급 응답(43자·30일·해시만 저장), 로그아웃·탈퇴, Bearer 해석(형식 오류·만료·폐기, 쿠키 미사용).
- `apps/server/tests/mobile-session-db.test.ts`: PostgreSQL 16에서 007 스키마(해시 CHECK·UNIQUE·FK 인덱스·행 시각·트리거), 만료 정리, 폐기, 탈퇴 cascade,
  로그인 → Bearer → 본인 여행 200·다른 사용자 403·없는 여행 404 → 로그아웃·만료·탈퇴 후 401.
- `apps/server/tests/bearer-ownership.test.ts`: 기존 소유권 검사(여행 조회·동선 생성·제약 GET/PUT·공유 발급·설정 GET/PUT)를 실제 Bearer 세션으로 실행해 403,
  모든 사용자 API가 잘못된·없는·만료·폐기 토큰에 401 `UNAUTHENTICATED`.
- `apps/server/tests/api-error-codes.test.ts`, `app-transition-contract.test.ts`: 처리기별 `code`, 문서 코드 목록, Auth.js 외 라우트의 `auth.ts` 미사용.
- `apps/server/tests/living-settings-http.test.ts`: 실제 `LivingSettingsService`의 revision 비교가 오래된 저장을 409 `STALE_INPUT`으로 거부하고 쓰지 않음.
  저장소의 원자적 검사(`living-settings-db.test.ts`)와 서비스의 사전 검사 두 경로가 같은 `code`를 쓴다.
