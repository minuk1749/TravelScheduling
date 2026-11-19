import type { LivingSettings, SettingsSnapshot } from '@travel/core/contracts/settings/model';
export * from '@travel/core/contracts/settings/model';

export interface LivingSettingsStore {
  load(id: string, ownerId: string): Promise<SettingsSnapshot>;
  save(id: string, ownerId: string, expectedRevision: string, settings: LivingSettings): Promise<SettingsSnapshot>;
}
