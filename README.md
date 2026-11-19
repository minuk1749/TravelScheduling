# 여행 동선

한국어 해외여행 동선 앱의 npm workspaces 저장소. 모바일 화면은 T20부터 구현하며 기존 PWA는 T25까지 유지합니다. 현재 Next.js App Router, 온라인 전용 PWA, Google 인증, PostgreSQL 스키마, 요금 계산과 순수 스케줄러가 있습니다. 구현 상태와 후속 작업의 인터페이스는 [아키텍처](docs/architecture.md)를 따릅니다.

## 개발

Node.js 24 (`nvm use`)와 PostgreSQL 16을 사용합니다.

```sh
npm ci
cp .env.example apps/server/.env.local
# 아래 설명대로 DATABASE_URL을 환경 변수로 설정한 뒤 실행합니다.
npm run migrate
npm run dev
```

Next.js는 `apps/server/.env.local`을 읽습니다. 마이그레이션과 테스트는 의도적으로 프로세스 환경 변수 `DATABASE_URL`을 사용하며 `.env.local`을 자동으로 읽지 않습니다. 실제 비밀번호는 커밋하지 마세요.

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app
npm run lint
npm run typecheck
npm run build
npm test
```

`npm test`의 프로덕션 HTTP 검사는 먼저 `npm run build`가 필요합니다. 테스트는 사용 가능한 임시 포트를 사용하고 서버를 종료합니다. DB가 없거나 `DATABASE_URL`이 없으면 연결 테스트는 실패하며 건너뛰지 않습니다. DB 연결 검사는 읽기 전용이고, 인증·모델 검사는 격리된 임시 스키마에 데이터를 쓰고 정리하므로 테스트 DB 계정에 스키마 생성 권한이 필요합니다.

## 워크스페이스

- `apps/server` (`@travel/server`): 기존 Next 서버·웹 화면·SQL·HTTP/DB/UI 테스트.
- `packages/core` (`@travel/core`): scheduler·fare·공용 DTO·검증·표시 변환. `@travel/core/scheduler`, `@travel/core/contracts/trips/input` 같은 하위 경로로 가져옵니다.
- `apps/mobile`, `packages/design-tokens`: T20 구현 전 예약 패키지입니다. 빈 성공 스크립트는 없습니다.

루트 lint·typecheck·build·test·migrate는 모든 워크스페이스에 같은 명령을 위임합니다. `migrate`는 서버만 구현합니다.
`npm run dev`, `npm run start`, `npm run test:e2e`는 서버에 인자까지 전달합니다.
core는 TS 원본을 export하므로 Next가 직접 변환하고, core build는 별도로 JS와 선언 파일을 생성합니다.
공용 소스는 Node·DB·네트워크·화면 프레임워크에 의존하지 않으며 구조 테스트와 ES 표준 라이브러리만 사용하는 타입 검사로 확인합니다.
새 패키지는 루트에서 `npm install <package> --workspace <name>`으로 추가하고 루트 `package-lock.json`을 함께 갱신합니다.

## PWA와 CI

`apps/server/src/app/manifest.ts`가 manifest를 생성합니다. `apps/server/public/sw.js`는 프로덕션에서 등록되며 오프라인 캐시를 만들지 않습니다. 빌드는 manifest와 PNG 아이콘, 서비스워커 구문을 검사합니다. HTTP 테스트는 실제 `next start`에서 HTML의 manifest 링크, manifest·아이콘·서비스워커 응답과 캐시 헤더를 검사합니다. 서비스워커는 Next.js의 public 자산으로 배포되므로 `apps/server/.next`와 함께 `apps/server/public`을 배포해야 합니다. 서비스워커에는 HTTPS가 필요합니다(localhost 제외).

기존 CI와 `agent-review`가 Node 24 / PostgreSQL 16에서 `npm ci`, lint, typecheck, build, test를 실행합니다. DB 테스트는 격리 스키마에서 새 마이그레이션 실행기로 스키마를 준비하고, 실행기 통합 테스트는 `npm run migrate`도 직접 호출합니다. 따라서 보호된 워크플로 변경 없이 CI에서도 같은 실행 경로를 검증합니다.

## 다음 작업

DB 접근은 `apps/server/src/lib/db.ts`의 명시적 연결 풀 팩터리에서 시작합니다. 호출자는 풀을 재사용하고 종료 시 `pool.end()`를 호출합니다. 현재 홈은 로그인·로그아웃·탈퇴를 제공하며 여행 입력 → 생활 설정 → 지도·타임라인 결과 화면이 연결되어 있습니다. 장소·이동시간 제공자와 동선 생성/제약 저장 API는 포트 뒤에서 동작합니다. 전체 점검과 성능 측정은 [T13A 점검](docs/t13a-audit.md)을 참고하세요. 배포 대상 결정과 실제 브라우저의 홈 화면 설치 확인은 사람이 진행합니다.

PWA 구성 참고: [Next.js 공식 PWA 안내](https://nextjs.org/docs/app/guides/progressive-web-apps).

## 인증 설정과 데이터베이스

`npm run migrate`로 PostgreSQL 스키마를 준비한 뒤 `apps/server/.env.local`에 `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`을 설정합니다. Google OAuth 웹 클라이언트의 승인된 리디렉션 URI에 `http://localhost:3000/api/auth/callback/google`을 등록합니다. 운영 환경에서는 운영 도메인의 HTTPS 콜백을 등록하세요. 비밀 값은 커밋하지 않습니다. Google의 인증된 이메일과 계정 ID만 저장합니다.

여행 조회는 `/api/trips/[id]`에서 소유자에게만 허용하며 현재 응답은 `{ id }`입니다. 탈퇴는 사용자 행을 삭제하고 외래 키 연쇄 삭제로 여행과 하위 데이터를 제거합니다. 새 사용자 소유 데이터도 사용자 또는 여행의 삭제 연쇄에 연결해야 합니다. 기존 세션은 매 요청에서 사용자 존재를 확인하므로 탈퇴 후 다시 사용할 수 없습니다.

## 여행 데이터 마이그레이션

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app
npm run migrate
```

실행기는 `apps/server/migrations/NNN_name.sql`을 번호순으로 적용하고 `schema_migrations`에 파일명, SHA-256, 적용 시각, 적용/기존 이력 등록 여부를 남깁니다. 이미 적용한 파일은 실행하지 않으며 재실행 결과는 `{"applied":[],"baselined":[]}`입니다. 파일을 수정·삭제하거나 번호를 빠뜨리면 실패합니다. 새 변경은 다음 번호의 SQL 파일로 추가하세요. 기존 001–003 파일은 변경하지 않습니다.

이력이 없는 기존 DB는 001만, 001–002, 001–003이 온전히 적용된 스키마인지 열·기본값·제약조건을 검증한 뒤 해당 이력을 등록하고 남은 파일만 실행합니다. 검증용 임시 스키마를 생성했다가 롤백하므로 최초 이관 계정에는 DB의 `CREATE` 권한이 필요합니다. 알 수 없는/부분 적용 스키마는 자동 보정하지 않고 실패하므로 원래 마이그레이션과 대조해 복구한 뒤 다시 실행하세요. 원래 데이터는 삭제하지 않습니다.

한 번의 실행 전체가 트랜잭션이며 실패하면 이번 실행의 DDL·데이터 변경·이력이 모두 롤백됩니다. 같은 DB/스키마의 동시 실행은 잠금으로 직렬화됩니다. 대상은 연결의 `current_schema()`(기본 `public`)이며, 다른 스키마는 연결 옵션의 `search_path`로 선택합니다. 실행 SQL에는 `BEGIN/COMMIT`, `CREATE INDEX CONCURRENTLY` 등 별도 트랜잭션 제어/트랜잭션 밖 명령을 넣지 마세요. 운영 실행은 해당 테이블을 변경할 권한이 있는 계정으로 하고, 기존 무이력 DB 이관 중에는 앱 쓰기를 멈추세요.

004는 FK 인덱스와 사용자 소유 행의 생성·수정 시각을 추가합니다. 수정 시각은 DB 트리거로 자동 갱신하며 도시 요금표의 `updated_at`은 기존 출처 갱신일 의미를 유지합니다. 여행별 최신 일정은 `WHERE trip_id = $1 ORDER BY generation DESC LIMIT 1`로 읽습니다. 기존 일정의 과거 생성 순서는 복구할 수 없으며 이관 번호는 그 순서를 보장하지 않습니다. 상세 결정과 후속 저장소 주의점은 [ADR 0004](docs/decisions/0004-database-migrations-and-timestamps.md), [T8A 인계](docs/t8a-handoff.md)를 참고하세요.

T2에서 생성한 소유자 전용 여행은 보존되며 새 여행 입력 필드는 비어 있을 수 있습니다. 항공편의 현지 일시는 해당 여행의 IANA 시간대와 함께 해석합니다. 날짜별 설정은 `(trip_id, date)`를 기준으로 저장하며, 값이 없는 항목은 여행 기본값을 사용합니다. 장소는 여행과 분리된 공유 캐시이므로 후속 장소 서비스가 만료 시각을 확인해야 합니다.
