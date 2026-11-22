# T22 모바일 결과 화면 (지도 우선 · 장소 카드)

## 결정

결과 화면은 [디자인](../design.md) 6–7절(R2)과 9절 3-1–3-9를 따른다. 지도가 화면 전체를 차지하고, 아래 고정 패널에서 장소 카드를 한 장씩 넘긴다. 카드·지도 마커·강조 구간은 하나의 선택 상태(`{ date, index }`)에서 계산한다.

- **순수 계산과 화면 분리.** SDK와 무관한 계산은 모두 순수 함수다.
  - `apps/mobile/src/result/`: 날짜별 카드·구간·전체 일정 줄(`days.ts`), 충돌 원인(`conflicts.ts`), 제약 수정(`edits.ts`), 표시 문구(`format.ts`).
  - `apps/mobile/src/map/`: 선택·이전/다음·스와이프 목표·강조할 구간·재계산 중 구간(`selection.ts`), 마커·경로 명세(`scene.ts`), polyline 해독·구간 순서 색·도심 밖 판정·곡선·화면 밖 방향(`geometry.ts`).
  - 화면(`apps/mobile/src/screens/result/`)은 이 결과를 그리기만 한다.
- **지도 어댑터.** 화면은 `ResultMapProps`만 알고 지도 SDK를 import하지 않는다. `MapAdapterProvider`가 앱에서는 `GoogleResultMap`(`react-native-maps`), 컴포넌트 테스트에서는 `FakeResultMap`을 주입한다. 결과 흐름이 컨텍스트에서 어댑터를 한 번 읽어 화면에 prop으로 넘긴다(렌더 중 컴포넌트 생성 금지 규칙).
- **계산 흐름.** 최초 계산은 생성 화면(`/trips/[id]/generate`)이 POST로 실행한다. 응답 전에는 지도 위 결과 패널의 요약 줄에 진행 표시를 띄우고, 계산이 끝나지 않은 카드와 구간은 비워 둔다(3-5). 결과가 OK·CONFLICT면 같은 응답을 메모리에서 결과 화면에 넘긴다. 결과 화면은 GET `/constraints`로 입력을 읽고, revision이 응답의 `inputHash`와 다를 때만 한 번 다시 계산한다. OVER_CAPACITY면 T23 선택 화면으로 가며, T23의 `동선 보기`는 검증된 응답을 결과 화면으로 넘긴다(`OutcomeFlow`).
- **수정.** 장소 수정(날짜·시각·순서 고정, 방문 순서, 희망으로 바꾸기), 희망 장소 날짜 추가, 구간 이동수단 바꾸기는 모두 기존 `PUT /api/trips/[id]/constraints` → `POST /api/trips/[id]/itinerary`로 저장·재계산한다. 응답의 `inputHash`가 저장한 revision과 다르면 표시하지 않는다(T23과 같은 `verifyRevision`). 저장 직전 제약을 보관해 `변경 취소`(3-8)와 토스트 `되돌리기`를 같은 경로로 처리한다. PUT은 성공했는데 POST가 실패하면 저장된 입력을 유지하고 POST만 다시 실행한다(3-9). 입력이 다른 곳에서 바뀌었으면 다시 계산 전에 입력을 다시 읽는다.
- 빈 날짜의 여유 시간은 생성 응답의 `availableByDate`를 여행 시간대로 표시한다. 가용 구간이 닫힌 날은 “여유 시간 없음”, 이 필드가 없는 이전 응답은 “여유 시간 정보 없음”으로 표시한다.
- **경로 모양.** T19 `GET …/itinerary/shapes`에 OK 결과의 `inputHash`와 `itineraryId`를 함께 보낸다. 앱은 두 값이 모두 일치하는 응답만 받아 여행 ID·입력 해시·일정 ID별로 화면 메모리에 둔다. 결과가 바뀐 첫 렌더에서 이전 선을 숨기고, 취소한 요청의 늦은 성공·실패를 무시한다. 서버가 오래된 ID를 거절하거나 응답에서 ID가 빠져도 경로 재시도가 가능하다. [T19 계약](T19-route-shapes.md)
- **디자인 값.** §4 그림자와 §6–7 배치·카드·마커·경로 값을 `@travel/design-tokens`의 `shadow`, `result`에 추가하고 문서 값과 같은지 토큰 테스트로 검사한다.

## 이유

- 카드 넘김과 지도 강조가 같은 순수 선택 함수에서 나오므로, 카드와 마커가 서로 다른 장소를 가리키는 상태가 생기지 않는다. 지도 SDK 없이 선택·강조 규칙을 단위 테스트할 수 있다.
- 결과 응답을 메모리로 넘기면 같은 입력의 재계산(Google 이동시간 조회)을 피하고, 검증된 응답과 화면이 일치한다(T23 결정과 같은 이유).
- 기존 T13 제약 API를 그대로 쓰므로 서버 계약·DB 변경이 없다.

## 대안

- 결과 화면을 열 때마다 POST로 다시 계산: 비용이 들고 응답이 달라질 수 있다. 저장된 최신 일정을 읽는 소유자용 GET은 아직 필요하지 않아 추가하지 않았다([질문](../questions.md#t22-결과-화면-가정)).
- 지도 컴포넌트를 컨텍스트에서 읽어 바로 렌더: React Compiler 규칙(`react-hooks/static-components`)에 걸린다. 흐름 컴포넌트가 한 번 읽어 prop으로 넘긴다.
- 패널을 끌어 높이를 바꾸는 이전 3단 패널: 2026-11-19 사람 결정(R2)으로 쓰지 않는다.

## 검증

- `apps/mobile/tests/result-browse.test.tsx`: 3-1(첫 카드 선택·도착 구간만 진하게), 카드·마커·이전/다음 연동, 3-2(전체 일정·도심 밖·효율), 날짜 칩, 3-6, 3-7, 경로 모양 실패 후 재요청.
- `apps/mobile/tests/result-shapes.test.tsx`: 같은 입력으로 다시 계산한 B의 카드와 경로 좌표를 확인한다. A가 이미 캐시된 경우와 B 뒤에 응답한 경우, 응답 ID 누락·불일치와 해시 불일치를 검증한다.
- `apps/mobile/tests/result-editing.test.tsx`: 3-3(수정 대상 구간 강조, 순서 고정 저장, 희망으로 바꾸기), 3-4(희망 마커·빈 날짜에서 날짜 추가), 3-5(재계산 중 해당 구간만 숨김, 카드 50%)와 토스트 `되돌리기`.
- `apps/mobile/tests/result-states.test.tsx`: 3-8(원인 카드 선택, 레드 구간, 고정 수정, 변경 취소), 3-9(이전 일정 흐리게, POST만 재시도), revision 불일치.
- `apps/mobile/tests/result-model.test.ts`, `map-geometry.test.ts`: 날짜 모델, 선택·이전/다음·스와이프, 강조·재계산 중 구간, 장면, 도심 밖, 색 보간, polyline, 문구.
- `packages/design-tokens/tests/design.test.ts`: §4 그림자, §6–7 결과 화면 값.
- 실제 지도 모양(선·곡선·그림자·마커 확대), 현재 위치 권한, 제스처 감각은 기기에서 사람이 확인한다.

제약 PUT의 응답을 받지 못하면 제출한 초안을 보관한다. 다시 계산할 때 저장 입력을 조회하고, 이미 초안이 반영됐으면 POST부터 진행한다. 처음 편집한 revision이 유지되면 PUT을 다시 시도한다. 다른 수정이 저장된 경우 최신 입력을 다시 계산한 뒤 편집을 재개한다. 되돌리기는 해당 수정이 저장된 revision에서만 허용한다. `apps/mobile/tests/result-edit-recovery.test.tsx`에서 저장 전 실패, 응답 유실, 다른 기기의 변경 및 희망 마커 편집을 검증한다.
