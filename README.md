# 여행 동선

한국어 해외여행 동선 PWA. 현재 Next.js App Router, 온라인 전용 PWA, Google 인증, PostgreSQL 스키마, 요금 계산과 순수 스케줄러가 있습니다. 구현 상태와 후속 작업의 인터페이스는 [아키텍처](docs/architecture.md)를 따릅니다.

## 개발

Node.js 24 (`nvm use`)와 PostgreSQL 16을 사용합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Next.js는 `.env.local`을 읽습니다. 테스트는 의도적으로 프로세스 환경 변수 `DATABASE_URL`을 사용합니다. 실제 비밀번호는 커밋하지 마세요.

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app
npm run lint
npm run typecheck
npm run build
npm test
```

`npm test`의 프로덕션 HTTP 검사는 먼저 `npm run build`가 필요합니다. 테스트는 사용 가능한 임시 포트를 사용하고 서버를 종료합니다. DB가 없거나 `DATABASE_URL`이 없으면 연결 테스트는 실패하며 건너뛰지 않습니다. DB 연결 검사는 읽기 전용이고, 인증·모델 검사는 격리된 임시 스키마에 데이터를 쓰고 정리하므로 테스트 DB 계정에 스키마 생성 권한이 필요합니다.

## PWA와 CI

`src/app/manifest.ts`가 manifest를 생성합니다. `public/sw.js`는 프로덕션에서 등록되며 오프라인 캐시를 만들지 않습니다. 빌드는 manifest와 PNG 아이콘, 서비스워커 구문을 검사합니다. HTTP 테스트는 실제 `next start`에서 HTML의 manifest 링크, manifest·아이콘·서비스워커 응답과 캐시 헤더를 검사합니다. 서비스워커는 Next.js의 public 자산으로 배포되므로 `.next`와 함께 `public`을 배포해야 합니다. 서비스워커에는 HTTPS가 필요합니다(localhost 제외).

기존 `.github/workflows/agent-review.yml`이 Node 24 / PostgreSQL 16에서 `npm ci`, lint, typecheck, build, test를 실행합니다. 이 작업에서는 보호된 워크플로를 변경하지 않습니다.

## 다음 작업

DB 접근은 `src/lib/db.ts`의 명시적 연결 풀 팩터리에서 시작합니다. 호출자는 풀을 재사용하고 종료 시 `pool.end()`를 호출합니다. 현재 홈은 로그인·로그아웃·탈퇴를 제공하며 여행 입력/결과 화면은 후속 작업입니다. 장소·이동시간 제공자와 일정 생성 API도 아직 연결되지 않았습니다. 배포 대상 결정과 실제 브라우저의 홈 화면 설치 확인은 사람이 진행합니다.

PWA 구성 참고: [Next.js 공식 PWA 안내](https://nextjs.org/docs/app/guides/progressive-web-apps).

## 인증 설정과 데이터베이스

`migrations/001_auth.sql`을 PostgreSQL에 적용한 뒤 `.env.local`에 `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`을 설정합니다. Google OAuth 웹 클라이언트의 승인된 리디렉션 URI에 `http://localhost:3000/api/auth/callback/google`을 등록합니다. 운영 환경에서는 운영 도메인의 HTTPS 콜백을 등록하세요. 비밀 값은 커밋하지 않습니다. Google의 인증된 이메일과 계정 ID만 저장합니다.

여행 조회는 `/api/trips/[id]`에서 소유자에게만 허용하며 현재 응답은 `{ id }`입니다. 탈퇴는 사용자 행을 삭제하고 외래 키 연쇄 삭제로 여행과 하위 데이터를 제거합니다. 새 사용자 소유 데이터도 사용자 또는 여행의 삭제 연쇄에 연결해야 합니다. 기존 세션은 매 요청에서 사용자 존재를 확인하므로 탈퇴 후 다시 사용할 수 없습니다.

## 여행 데이터 마이그레이션

데이터베이스에는 `migrations/001_auth.sql`, `migrations/002_travel_model.sql`, `migrations/003_city_profile_night_hours.sql`을 순서대로 한 번씩 적용합니다. T2에서 생성한 소유자 전용 여행은 보존되며 새 필드는 비어 있을 수 있습니다. 항공편의 현지 일시는 해당 여행의 IANA 시간대와 함께 해석합니다. 날짜별 설정은 `(trip_id, date)`를 기준으로 저장하며, 값이 없는 항목은 여행 기본값을 사용합니다. 장소는 여행과 분리된 공유 캐시이므로 후속 장소 서비스가 만료 시각을 확인해야 합니다.
