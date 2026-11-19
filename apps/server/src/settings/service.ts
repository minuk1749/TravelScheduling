import type { LivingSettingsStore } from './model';
import { TripInputError } from '../trips/input';
import { calculateSettings } from './calculate';
import { parseSettings } from './input';
import { SettingsError, type SettingsView } from './model';

export class LivingSettingsService {
  constructor(private readonly store: LivingSettingsStore) {}
  async load(id: string, ownerId: string): Promise<SettingsView> {
    const snapshot = await this.store.load(id, ownerId);
    return { snapshot, calculation: calculateSettings(snapshot, snapshot.settings) };
  }
  async save(id: string, ownerId: string, raw: unknown): Promise<SettingsView> {
    if (!raw || typeof raw !== 'object' || !('revision' in raw) || typeof raw.revision !== 'string' || !('settings' in raw)) {
      throw new TripInputError({ request: '설정과 변경 확인 번호가 필요합니다.' });
    }
    const current = await this.store.load(id, ownerId);
    if (current.revision !== raw.revision) throw new SettingsError(409, '다른 화면에서 입력이 변경되었습니다. 다시 불러온 뒤 수정해 주세요.', 'STALE_INPUT');
    const settings = parseSettings(raw.settings, current);
    // Validate calculation before writing; conflicts are domain results and never move fixed visits.
    calculateSettings(current, settings);
    const snapshot = await this.store.save(id, ownerId, raw.revision, settings);
    return { snapshot, calculation: calculateSettings(snapshot, snapshot.settings) };
  }
}
