import { privateJson as json } from '../lib/http';
import { PlaceInputError, PlaceProviderError, type PlaceProvider } from './index';
import { detailsRequest, placeId, searchRequest } from './validation';

type Dependencies = { userId(): Promise<string | undefined>; provider(): PlaceProvider };

/** Same handlers are used by Next routes and key-free HTTP contract tests. */
export function placeHandlers(dependencies: Dependencies) {
  const handle = async (action: () => Promise<Response>): Promise<Response> => {
    try {
      if (!await dependencies.userId()) return json({ error: '로그인이 필요합니다.' }, 401);
      return await action();
    } catch (error) {
      if (error instanceof PlaceInputError) return json({ error: error.message }, 400);
      if (error instanceof PlaceProviderError) return json({ error: error.message }, error.kind === 'UNAVAILABLE' ? 503 : 502);
      return json({ error: '장소 요청을 처리할 수 없습니다.' }, 500);
    }
  };
  return {
    search: (request: Request) => handle(async () => {
      const params = new URL(request.url).searchParams;
      const input = searchRequest({ query: params.get('query') ?? '', language: 'ko',
        ...(params.has('regionCode') ? { regionCode: params.get('regionCode')! } : {}) });
      return json({ places: await dependencies.provider().search(input), attribution: 'Google Maps' });
    }),
    details: (request: Request, googlePlaceId: string) => handle(async () => {
      placeId(googlePlaceId);
      const params = new URL(request.url).searchParams;
      const fields = params.get('fields') ?? 'details';
      if (fields !== 'details' && fields !== 'location') throw new PlaceInputError('fields는 details 또는 location이어야 합니다.');
      const input = fields === 'details' ? detailsRequest({
        googlePlaceId, language: 'ko', timeZone: params.get('timeZone') ?? '', dates: params.getAll('date'),
      }) : null;
      const provider = dependencies.provider();
      const place = input ? await provider.details(input) : await provider.location(googlePlaceId);
      return place ? json({ place, attribution: 'Google Maps' }) : json({ error: '장소를 찾을 수 없습니다.' }, 404);
    }),
  };
}
