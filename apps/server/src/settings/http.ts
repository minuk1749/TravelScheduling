import { readJsonBody } from '../lib/json-body';
import { apiError, privateJson as json, isCrossSiteRequest } from '../lib/http';
import { TripInputError } from '../trips/input';
import { SettingsError } from './model';
import type { LivingSettingsService } from './service';
export function settingsHandlers(deps: { userId(request: Request): Promise<string | undefined>; service: Pick<LivingSettingsService, 'load' | 'save'> }) {
  return async (request: Request, id: string): Promise<Response> => {
    try {
      const ownerId = await deps.userId(request);
      if (!ownerId) throw new SettingsError(401, '로그인 후 다시 시도해 주세요.');
      if (request.method === 'GET') return json(await deps.service.load(id, ownerId));
      if (request.method !== 'PUT') throw new SettingsError(405, '허용되지 않은 메서드입니다.');
      if (isCrossSiteRequest(request)) throw new SettingsError(403, '허용되지 않은 요청입니다.');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SettingsError(415, 'JSON 입력이 필요합니다.');
      const body = await readJsonBody(request, 30_000);
      if ('error' in body) return body.error;
      return json(await deps.service.save(id, ownerId, body.value));
    } catch (error) {
      if (error instanceof TripInputError) return apiError(400, 'INVALID_INPUT', error.message, error.fields);
      if (error instanceof SettingsError) return apiError(error.status, error.code, error.message);
      return apiError(500, 'INTERNAL', '설정을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
}
