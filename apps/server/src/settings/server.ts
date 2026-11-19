import { auth } from '../auth';
import { createDatabasePool } from '../lib/db';
import { LivingSettingsRepository } from '../repositories/living-settings';
import { settingsHandlers } from './http';
import { LivingSettingsService } from './service';

class SettingsServer {
  private service: LivingSettingsService | undefined;
  private getService() {
    return this.service ??= new LivingSettingsService(new LivingSettingsRepository(createDatabasePool()));
  }
  readonly handle = settingsHandlers({ userId: async () => (await auth())?.user?.id,
    service: { load: (id, owner) => this.getService().load(id, owner), save: (id, owner, raw) => this.getService().save(id, owner, raw) },
  });
}
export const settingsServer = new SettingsServer();
