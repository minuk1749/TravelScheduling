import { apiError, privateJson as json, providerError } from '../lib/http';
import { PlaceInputError, PlaceProviderError, type PlaceProvider } from './index';
import { detailsRequest, placeId, searchRequest } from './validation';

type Dependencies = { userId(request: Request): Promise<string | undefined>; provider(): PlaceProvider };

/** Same handlers are used by Next routes and key-free HTTP contract tests. */
export function placeHandlers(dependencies: Dependencies) {
  const handle = async (request: Request, action: () => Promise<Response>): Promise<Response> => {
    try {
      if (!await dependencies.userId(request)) return apiError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
      return await action();
    } catch (error) {
      if (error instanceof PlaceInputError) return apiError(400, 'INVALID_INPUT', error.message);
      if (error instanceof PlaceProviderError) return providerError(error.kind, error.message);
      return apiError(500, 'INTERNAL', '장소 요청을 처리할 수 없습니다.');
    }
  };
  return {
    search: (request: Request) => handle(request, async () => {
      const params = new URL(request.url).searchParams;
      const input = searchRequest({ query: params.get('query') ?? '', language: 'ko',
        ...(params.has('regionCode') ? { regionCode: params.get('regionCode')! } : {}) });
      return json({ places: await dependencies.provider().search(input), attribution: 'Google Maps' });
    }),
    details: (request: Request, googlePlaceId: string) => handle(request, async () => {
      placeId(googlePlaceId);
      const params = new URL(request.url).searchParams;
      const fields = params.get('fields') ?? 'details';
      if (fields !== 'details' && fields !== 'location') throw new PlaceInputError('fields는 details 또는 location이어야 합니다.');
      const input = fields === 'details' ? detailsRequest({
        googlePlaceId, language: 'ko', timeZone: params.get('timeZone') ?? '', dates: params.getAll('date'),
      }) : null;
      const provider = dependencies.provider();
      const place = input ? await provider.details(input) : await provider.location(googlePlaceId);
      return place ? json({ place, attribution: 'Google Maps' }) : apiError(404, 'NOT_FOUND', '장소를 찾을 수 없습니다.');
    }),
  };
}
