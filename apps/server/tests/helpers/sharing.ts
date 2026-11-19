import { sampleTrip } from '../fixtures/itinerary';
import { service } from './itinerary-service';
import type { ShareRepository, SharedSnapshot } from '../../src/sharing/model';

export async function sharedSnapshot(): Promise<SharedSnapshot> {
  const input = sampleTrip();
  return { input, result: await service().service.compute(input) };
}
export class MemoryShares implements ShareRepository {
  private hash: string | null = null;
  constructor(private readonly snapshot: SharedSnapshot | 'UNAVAILABLE') {}
  async rotate(id: string, owner: string, hash: string) {
    if (id !== 'trip' || owner !== 'owner') return false;
    this.hash = hash; return true;
  }
  async load(hash: string) { return hash === this.hash ? this.snapshot : null; }
  async isActive(hash: string) { return hash === this.hash; }
}
