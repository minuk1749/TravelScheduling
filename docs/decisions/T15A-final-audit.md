# T15A 최종 전체 점검

## 결정

- `itineraries.details` JSONB의 타입·인코더·완전성 검사를 `repositories/itinerary-details.ts` 한 곳에 둔다.
  `saveItinerary`는 인코더로 쓰고, 공유 결과 읽기는 같은 타입과 `isCompleteItineraryDetails`로 레거시 행을 거른다.
  저장 형식(키·값)은 바뀌지 않는다.
- 공유 저장소(`ShareRepository.load`)는 `{ input: TripInputs, result }`를 반환한다. 표시 입력 축소(`results/model.displayInput`)와
  장소 참조 목록(`services/itinerary/display-places.tripPlaceRefs`)은 서비스가 계산한다. 공개 응답(`SharedItinerary`)은 그대로다.
- `lib/http.isCrossSiteRequest` = `hasForeignOrigin` + `Sec-Fetch-Site: cross-site`. 이미 두 검사를 하던 설정·공유 쓰기만 사용한다.
- 여행 생성은 항공·숙소·방문 행을 테이블당 1회 `jsonb_to_recordset` INSERT로 저장한다. 장소 upsert는 정렬된 행별 실행을 유지한다.
- 테스트의 `TripInputs → TripDraft` 변환은 `fixtures/itinerary.sampleDraft`로 모은다.

## 이유

- details 형식을 쓰는 쪽과 읽는 쪽이 각자 정의하면 필드를 추가할 때 한쪽만 고치는 실수가 생기고, 레거시 판정이 조용히 어긋난다.
- 표시용으로 무엇을 공개할지는 저장소(SQL)가 아니라 서비스의 정책이다. 장소 참조 목록은 편집·공유 화면이 같은 규칙을 써야 한다.
- 같은 쓰기 경계 검사를 두 처리기에 복사하면 정책 변경 지점이 늘어난다. 나머지 처리기에 적용하는 것은 동작 변경이라 이번 범위가 아니다.
- 방문 최대 100개에서 생성 트랜잭션이 100회 이상 왕복했다(T13A 후속). 자식 행은 새 여행에만 속해 잠금 경합이 없으므로 일괄 저장이 안전하다.
  `created_at`은 트랜잭션 시작 시각이라 행마다 같았고, 읽기 순서(`created_at, id`)는 이미 id 순이었으므로 일괄 저장으로 바뀌지 않는다.

## 대안

- 장소 upsert도 `INSERT … SELECT … ORDER BY` 한 문장으로: SQL 표준은 삽입 순서(잠금 순서)를 보장하지 않으므로 동시 생성의 교착 방지 근거가 약해진다. 채택하지 않는다.
- 모든 쓰기 경계에 `isCrossSiteRequest` 적용: 보안상 더 일관되지만 기존 응답이 바뀐다. 사람 결정으로 넘긴다([질문](../questions.md)).
- 모듈별 DB 풀을 프로세스 공용 하나로: 최대 연결 수가 30에서 5로 줄어 부하 특성이 바뀐다. 사람 결정으로 넘긴다.
- 결과/공유 화면의 불러오기 로직 공통 훅: 인증·쿠키·referrer 정책과 오류 문구가 달라 얻는 것이 적다.
