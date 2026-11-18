import type { Constraints } from '../../src/results/model';
import type { TripInputs } from '../../src/services/itinerary/types';
export function applyEdits(input: TripInputs, constraints: Constraints): TripInputs {
  return { ...input, legModes: constraints.legModes, visits: input.visits.map(v => {
    const edit = constraints.visits.find(e => e.id === v.id)!;
    return { ...v, priority: edit.priority, fixedDate: edit.fixedDate ?? undefined, fixedTime: edit.fixedTime ?? undefined, fixedOrder: edit.fixedOrder ?? undefined };
  }) };
}

