import type { ItineraryPlaces, TripLoad } from './types';
import type { Constraints, ConstraintWriteOptions, ResultSnapshot, ResultView } from '../../results/model';
import { parseConstraints } from '../../results/input';
import { TripInputError } from '../../trips/input';
import { displayPlaces, tripPlaceRefs } from './display-places';

export type ConstraintLoad = TripLoad & Pick<ResultSnapshot, 'writeVersion' | 'receipt'>;
export interface ConstraintRepository {
  loadInputs(tripId: string, ownerId: string, operationId?: string): Promise<ConstraintLoad | null>;
  save(tripId: string, ownerId: string, revision: string, constraints: Constraints, options?: ConstraintWriteOptions): Promise<ResultSnapshot | null>;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TripInputError({ [field]: '올바른 저장 요청 식별자가 필요합니다.' });
  }
  return value.toLowerCase();
}
export class ResultEditService {
  constructor(private readonly repository: ConstraintRepository, private readonly places: ItineraryPlaces) {}
  private async loadReady(tripId: string, ownerId: string, operationId?: string) {
    const loaded = await this.repository.loadInputs(tripId, ownerId, operationId);
    if (!loaded) throw new ResultTripNotFoundError();
    if (loaded.status !== 'READY') throw new ResultUnavailableError();
    return loaded;
  }
  async load(tripId: string, ownerId: string, operationId?: string): Promise<ResultView> {
    const loaded = await this.loadReady(tripId, ownerId, optionalUuid(operationId, 'operationId'));
    const { input, inputHash: revision, writeVersion, receipt } = loaded;
    return { input, revision, writeVersion, receipt, places: await displayPlaces(this.places, tripPlaceRefs(input), input.timeZone, input.startDate) };
  }
  async save(tripId: string, ownerId: string, body: unknown): Promise<ResultSnapshot> {
    const loaded = await this.loadReady(tripId, ownerId);
    const row = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
    if (typeof row.revision !== 'string') throw new TripInputError({ revision: '다시 불러온 후 저장해 주세요.' });
    if (row.revision !== loaded.inputHash) throw new ResultStaleError();
    const constraints = parseConstraints(row.constraints, loaded.input);
    const options = { operationId: optionalUuid(row.operationId, 'operationId'), expectedOperationId: optionalUuid(row.expectedOperationId, 'expectedOperationId'),
      expectedWriteVersion: optionalUuid(row.expectedWriteVersion, 'expectedWriteVersion') };
    const saved = await this.repository.save(tripId, ownerId, row.revision, constraints, options);
    if (!saved) throw new ResultStaleError();
    return saved;
  }
}
export class ResultTripNotFoundError extends Error {}
export class ResultUnavailableError extends Error {}
export class ResultStaleError extends Error {}
