# @travel/design-tokens

`src/index.ts`가 `docs/design.md` 2–5·8절의 색·글자·간격·모서리·크기·움직임 값을 제공한다. `colors`, `legColors`, `typography`, `spacing`, `radius`, `size`, `motion`을 export한다. 플랫폼 타입·런타임 의존성은 없다.

범위 값(입력 모서리 14–16, 카드 18–20, 작은 글자 12–13)은 `min`/`max`를 보존한다. 화면은 토큰을 플랫폼 스타일로 바꾼 theme만 참조한다. `tests/design.test.ts`는 문서의 각 행에서 값을 추출하여 역할별 토큰과 비교한다.

`assets/fonts/`에는 네이티브 앱과 공유 웹 열람 페이지가 사용하는 Pretendard Regular·SemiBold와 SIL OFL 라이선스가 있다.

루트의 lint·typecheck·build·test가 이 패키지도 검사한다. 빌드는 `dist`에 JS·선언 파일을 생성하며, 앱과 서버는 TypeScript 원본 export를 각 번들러로 변환한다.
