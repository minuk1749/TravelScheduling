# T19: 저장 구간의 경로 모양 조회

날짜: 2026-11-19 · 기준: develop `0b1aab5` · 상태: 채택

## 결정

- `GET /api/trips/[id]/itinerary/shapes?inputHash=`는 인증·소유권 확인 후 최신 저장 일정만 읽는다.
  저장소에서도 owner_id를 검사하며 repeatable-read/read-only 트랜잭션으로 현재 입력·최신 결과를 함께 본다.
  기존 `readSharedResult`가 정규화 DAY 구간과 JSONB AIRPORT 구간을 복원하므로 규칙을 복제하지 않는다.
- 결과가 없으면 `RESULT_UNAVAILABLE`, 요청·저장·현재 해시가 다르면 `STALE_INPUT`이다(둘 다 409).
  저장 입력이 더 이상 완전하지 않으면 기존 결과를 쓸 수 없으므로 STALE_INPUT이다.
  해시는 일치하지만 구형 저장 형식으로 복원할 수 없으면 RESULT_UNAVAILABLE이다.
- 서비스는 저장 `comparisons`의 순서·날짜·종류·내부 장소 ID·선택 수단을 유지한다. 장소 ID를 Google ID와 혼용하지 않는다.
  TAXI만 DRIVE로 바꾸고, 실제 departure instant와 IANA 시간대를 제공자에 전달한다. 수단 재선택·동선 재계산은 하지 않는다.
- 요청당 최대 4개 구간을 처리한다. 장소 좌표는 요청 안에서 Google ID별로 중복 조회를 합치고 기존 좌표 캐시를 사용한다.
  모양은 재사용하지 않는다. 한 작업이라도 실패하면 새 작업을 중단하고 진행 중 작업을 정리한 뒤 전체 요청을 실패시킨다.
- 경로 없음 또는 삭제된 장소의 좌표 없음(null)은 `shape: { status: 'NONE' }`이다.
  불완전 응답·빈 polyline은 TravelProviderError(INVALID_RESPONSE), 네트워크·쿼터 오류는 UNAVAILABLE이다.
  장소 제공자 장애도 같은 502/503 정책으로 전파한다. 내부 오류 원문은 노출하지 않는다.
- 모양 전용 포트는 `travel-time/shapes.ts`, 공용 DTO는 `core/contracts/route-shapes.ts`다.
  Google HTTP·오류 처리·수단 옵션은 기존 시간 제공자에서 `google-client.ts`로 추출해 재사용한다.
  약관 확인과 저장하지 않는 결정은 [ADR 0005](0005-travel-time-provider-and-cache.md)를 따른다.

## 이유

저장된 결과를 기준으로 조회해야 지도 구간과 일정의 수단·시각이 일치하고, 요청 해시와 현재 입력을
같은 스냅샷에서 비교해야 편집 전후 상태가 섞이지 않는다. 모양은 표시용 데이터이므로 스케줄러·저장 형식과 분리한다.

## T18 병행 작업과 인증

T19 시작 시 T18은 Claude가 진행 중이므로 그 인증 파일·기존 HTTP 처리기는 수정하지 않는다.
새 처리기의 `userId(request)` 주입 계약은 T18 RequestAuthenticator와 호환된다. 현재 조립은 Auth.js 쿠키 인증이며,
Authorization 헤더가 있으면 쿠키로 우회하지 않고 401이다. T18 통합 시 `route-shapes/server.ts`의 콜백을
공통 RequestAuthenticator로 연결하고 이 경로의 Bearer 소유권 테스트를 포함해야 한다.
T19는 T17만 선행 작업이므로 모바일 세션 자체를 중복 구현하지 않는다.

## 대안

- 클라이언트가 좌표·수단·시각을 직접 보내는 프록시: 저장된 소유자 결과와 일치함을 보장하기 어려워 제외.
- 모든 구간을 무제한 Promise.all로 조회: 외부 요청 폭증을 막기 위해 제한된 worker로 대체.
- 새 저장 형식/모양 캐시: 기존 결과 복원으로 충분하고 약관 허용도 확인하지 못해 제외.

## 자동 검증

- `route-shapes-provider.test.ts`: 최소 field mask·수단/시각 옵션·no-store·반복 외부 호출·NONE/오류·실제 키 불필요.
- `route-shapes-service.test.ts`: DAY/AIRPORT 전체·순서/키·TAXI 변환·좌표 중복 제거·동시성·부분 실패 금지.
- `route-shapes-http.test.ts`: 401/403/404·400 해시·409 상태·502/503/500·private/no-store.
- `route-shapes-db.test.ts`: SQL 소유자·최신 결과·세 해시의 불일치·구형 결과·저장하지 않음(PostgreSQL 필요).
- 기존 `travel-time*.test.ts`: HTTP 코드 추출 후 이동시간·요금·캐시 동작 보존.
- 루트 lint·typecheck·build·test를 실행한다. DB가 없는 Mac의 SQL 검사 실패는 CI PostgreSQL 16에서 확인한다.
