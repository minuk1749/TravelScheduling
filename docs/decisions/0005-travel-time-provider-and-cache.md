# ADR 0005: 이동시간 제공자와 응답 캐시

날짜: 2026-11-18 · 상태: 구현 결정 채택, Google 순차 반복 호출 0회 기준은 사람 확인 필요

## 결정

- `apps/server/src/travel-time`에 T7A의 `TravelTimeProvider.matrix/route` 계약을 구현한다. 스케줄러는 변경하지 않는다.
- 행렬은 Google `computeRouteMatrix`, 실제 출발 구간은 `computeRoutes`로 조회한다.
  응답의 `travelAdvisory.transitFare`를 Money로 변환한다. 요금이 없으면 null, 경로가 없으면
  해당 수단을 생략한다. DRIVE 요금과 호출 대기는 별도 요금/스케줄러 책임이다.
- 행렬 입력은 최대 100개 장소이며 TRANSIT 100요소, WALK/DRIVE 625요소 한도에 맞춰 분할한다.
  분할 호출은 순차 실행한다. 응답 순서 대신 인덱스로 복원하고 요소 오류나 불완전 응답은 실패시킨다.
- 실시간 교통은 요구사항에서 제외되므로 DRIVE는 TRAFFIC_UNAWARE다. Google에는 TRANSIT만
  정확한 출발 instant를 전송한다. 외부 API의 대중교통 조회 가능 기간 오류를 빈 경로로 숨기지 않는다.
- 일반 캐시 래퍼는 명시한 TTL이 양수일 때 완료 응답을 보관한다. TTL 기본값은 0이고 최대
  24시간, 기본 용량은 요청 32개다. 이 상한은 구현 자원 제한이며 Google의 허용 기간이 아니다.
  인스턴스가 공급자를 고정하므로 서로 다른 공급자/자격증명 간 캐시 공유가 없다.
- Google 기본 팩터리는 TTL 0을 사용한다. 진행 중 동일 요청만 합치고 완료 응답은 재사용하지 않는다.
  DB/디스크/Next fetch 캐시에도 저장하지 않는다. 입력·출력 복제로 호출자 변경을 격리한다.
- 캐시 키는 API 종류/버전, 정규화한 출발 instant(나노초 보존), IANA 시간대, 모드 집합,
  장소 ID와 좌표, 방향을 포함한다. 행렬 장소 순서만 정규화하며 구간 재조회와 행렬을 혼용하지 않는다.
  오류를 캐시하지 않고 만료 타이머/용량 초과/dispose로 해제한다.

## 이유

2026-11-18 확인한 [Routes 정책](https://developers.google.com/maps/documentation/routes/policies)과
[서비스별 약관 §19.3](https://cloud.google.com/maps-platform/terms/maps-service-terms)은
Routes 좌표의 한시적 보관을 다루지만 시간·거리·요금 저장 허용은 확인되지 않는다.
메모리에만 저장하거나 TTL을 짧게 한다는 이유로 허용된다고 해석하지 않는다.
계약 적용 지역/추가 계약에 대한 판단 없이 Google 완료 응답 캐시를 기본 활성화하지 않는다.
캐시 기능은 합성 픽스처/캐시 허용 제공자로 검증한다. **Google 기본 구성에서 순차 반복
외부 호출 0회는 충족하지 않으며**, 이 차이를 requirements 수정 없이 questions와 인계에 남긴다.

[행렬 REST 계약](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix)은
응답 요소의 인덱스, 상태, 조건과 수단별 요소 수 제한을 정의한다.
[RouteTravelAdvisory](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelAdvisory)의
transitFare는 [Money](https://developers.google.com/maps/documentation/routes/reference/rest/v2/Money)의
currencyCode/units/nanos다. 표시용 요금 문자열이나 통행료를 대중교통 요금으로 사용하지 않는다.
[RoutingPreference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RoutingPreference)의
TRAFFIC_UNAWARE는 현재 교통을 반영하지 않는다.

## 대안

- 모든 구간을 computeRoutes로 조회: 요금은 얻지만 N²×수단 수의 요청이 필요하다. 행렬 API의
  travelAdvisory를 사용하고 실제 구간 재조회에만 computeRoutes를 쓴다.
- Google 응답을 수분/하루/계산 1회 동안 캐시: 자동으로 약관 예외라고 볼 근거가 없어 기본 활성화하지 않는다.
- 캐시 기능 자체 생략: 허용 제공자에 대한 반복 호출 최적화와 자동 검증도 불가능해 채택하지 않았다.
- 시간·거리·요금 캐시가 허용된 다른 제공자/적용 계약: TravelTimeProvider 뒤에 연결할 수 있다.
  Google 반복 호출 0회를 필수로 유지할지와 함께 사람이 결정할 후속 사항이다.

검증 및 T12 인계: [T9 인계](../t9-handoff.md), [자동 테스트](../../apps/server/tests/travel-time.test.ts).
