# 여행 동선

한국어 해외여행 동선 PWA. T1은 Next.js App Router, 온라인 전용 PWA, PostgreSQL 연결 및 자동 테스트 기반을 제공합니다.

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

`npm test`의 프로덕션 HTTP 검사는 먼저 `npm run build`가 필요합니다. 테스트는 사용 가능한 임시 포트를 사용하고 서버를 종료합니다. DB가 없거나 `DATABASE_URL`이 없으면 연결 테스트는 실패하며 건너뛰지 않습니다. DB 테스트는 읽기 전용 쿼리를 실행합니다.

## PWA와 CI

`src/app/manifest.ts`가 manifest를 생성합니다. `public/sw.js`는 프로덕션에서 등록되며 오프라인 캐시를 만들지 않습니다. 빌드는 manifest와 PNG 아이콘, 서비스워커 구문을 검사합니다. HTTP 테스트는 실제 `next start`에서 HTML의 manifest 링크, manifest·아이콘·서비스워커 응답과 캐시 헤더를 검사합니다. 서비스워커는 Next.js의 public 자산으로 배포되므로 `.next`와 함께 `public`을 배포해야 합니다. 서비스워커에는 HTTPS가 필요합니다(localhost 제외).

기존 `.github/workflows/agent-review.yml`이 Node 24 / PostgreSQL 16에서 `npm ci`, lint, typecheck, build, test를 실행합니다. 이 작업에서는 보호된 워크플로를 변경하지 않습니다.

## 다음 작업

DB 접근은 `src/lib/db.ts`의 명시적 연결 풀 팩터리에서 시작합니다. 호출자는 풀을 재사용하고 종료 시 `pool.end()`를 호출합니다. 스키마 및 마이그레이션은 T3 범위입니다. 인증은 T2 범위이며 현재 홈은 정적 안내 화면입니다. 배포 대상 결정과 실제 브라우저의 홈 화면 설치 확인은 사람이 진행합니다.

PWA 구성 참고: [Next.js 공식 PWA 안내](https://nextjs.org/docs/app/guides/progressive-web-apps).
