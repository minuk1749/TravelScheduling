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
      const body = await request.text();
      if (body.length > 30_000) throw new SettingsError(413, '입력 크기를 줄여 주세요.');
      let raw: unknown;
      try { raw = JSON.parse(body); } catch { throw new SettingsError(400, '올바른 JSON 입력이 필요합니다.'); }
      return json(await deps.service.save(id, ownerId, raw));
    } catch (error) {
      if (error instanceof TripInputError) return apiError(400, 'INVALID_INPUT', error.message, error.fields);
      if (error instanceof SettingsError) return apiError(error.status, error.code, error.message);
      return apiError(500, 'INTERNAL', '설정을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
}
