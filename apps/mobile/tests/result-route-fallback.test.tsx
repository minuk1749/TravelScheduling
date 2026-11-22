import { waitFor } from 'expo-router/testing-library';
import { json } from './helpers';
import { D1, legId, openResult, place, resultFixture, REVISION, ROAD, routes, trip } from './result-fixture';

test('each leg keeps its own mode and falls back independently when a shape is unusable', async () => {
  const f = resultFixture();
  f.shapes.mockImplementationOnce(async url => json({
    inputHash: REVISION, itineraryId: url.searchParams.get('itineraryId'),
    legs: trip(REVISION).comparisons.map(leg => ({
      date: leg.date, kind: leg.kind, from: leg.from, to: leg.to,
      mode: leg.to === place('museum') ? 'TAXI' : leg.selected.mode,
      shape: { status: 'OK', encodedPolyline: leg.kind === 'AIRPORT' ? '!!!!' : leg.from === place('market') ? '??' : ROAD },
    })),
  }));
  await openResult(f);
  await waitFor(() => expect(routes()[legId(D1, 'museum', 'market')]).toMatch(/TAXI SOLID .* ROAD$/));
  expect(routes()[legId(D1, 'airport', 'hotel', 'AIRPORT')]).toMatch(/TRANSIT DOTTED .* STRAIGHT$/);
  expect(routes()[legId(D1, 'hotel', 'museum')]).toMatch(/TRANSIT DOTTED .* STRAIGHT$/);
  expect(routes()[legId(D1, 'market', 'hotel')]).toMatch(/WALK DOTTED .* STRAIGHT$/);
});
