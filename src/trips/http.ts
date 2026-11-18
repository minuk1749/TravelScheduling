import type { CityProfile } from '../fare';
import { parseTripDraft, TripInputError, type TripDraft } from './input';

type Dependencies = {
  userId(): Promise<string | undefined>;
  create(ownerId: string, input: TripDraft): Promise<string>;
  profile(cityCode: string): Promise<CityProfile | null>;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function tripHandlers(deps: Dependencies) {
  const handle = async (action: (userId: string) => Promise<Response>) => {
    try {
      const userId = await deps.userId();
      if (!userId) return json({ error: '로그인 후 다시 시도해 주세요.' }, 401);
      return await action(userId);
    } catch (error) {
      if (error instanceof TripInputError) return json({ error: error.message, fields: error.fields }, 400);
      return json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
  };
  return {
    create: (request: Request) => handle(async userId => {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 입력이 필요합니다.' }, 415);
      const body = await request.text();
      if (body.length > 100_000) return json({ error: '입력 크기를 줄여 주세요.' }, 413);
      let raw: unknown;
      try { raw = JSON.parse(body); } catch { return json({ error: '올바른 JSON 입력이 필요합니다.' }, 400); }
      const input = parseTripDraft(raw);
      return json({ id: await deps.create(userId, input) }, 201);
    }),
    profile: (request: Request) => handle(async () => {
      const code = new URL(request.url).searchParams.get('cityCode')?.trim();
      if (!code || code.length > 80) return json({ error: '도시를 선택해 주세요.' }, 400);
      return json({ profile: await deps.profile(code), recommendedPolicy: 'WHEN_NEEDED' });
    }),
  };
}
