/** Offline T13A benchmark: fresh services per run, fixed fixtures, no Google or DB latency. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FareConverter } from '../src/services/itinerary/routes';
import type { TravelMatrix } from '../src/travel-time';
import { FixtureTravel, okVisits, sampleTrip } from '../tests/fixtures/itinerary';
import { cityProfile } from '../tests/fixtures/trip-input';
import { conflictVisits, service } from '../tests/helpers/itinerary-service';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function measure(name: string, run: () => unknown | Promise<unknown>) {
  for (let i = 0; i < 3; i++) await run();
  const times: number[] = [];
  let result: unknown;
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    result = await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, medianMs: +times[7].toFixed(3), minMs: +times[0].toFixed(3),
    maxMs: +times[14].toFixed(3), resultHash: hash(result) }));
}

console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, warmup: 3, samples: 15 }));
for (const [name, visits] of [
  ['OK', okVisits], ['OVER_CAPACITY', okVisits.map(v => ({ ...v, minutes: 300 }))], ['CONFLICT', conflictVisits],
] as const) {
  await measure(name, async () => {
    const travel = new FixtureTravel();
    const { service: itinerary, places } = service({ travel });
    const result = await itinerary.compute(sampleTrip(visits));
    return { result, calls: { matrix: travel.matrixCalls.length, route: travel.routeCalls.length,
      details: places.detailCalls.length, location: places.locationCalls.length } };
  });
}
for (const size of [20, 100]) {
  const matrix: TravelMatrix = new Map(Array.from({ length: size }, (_, from) => [String(from),
    new Map(Array.from({ length: size }, (_, to) => [String(to), {
      TRANSIT: { durationSeconds: 600 + from + to, distanceMeters: 2000, fare: { amount: 200, currency: 'JPY' } },
      DRIVE: { durationSeconds: 300 + from + to, distanceMeters: 1500 + from * to, fare: null },
    }]))]));
  await measure(`fare-matrix-${size}`, () => [...new FareConverter(cityProfile, 'Asia/Tokyo')
    .table(matrix, '2026-12-01T13:00:00Z')].map(([id, row]) => [id, [...row]]));
}
