import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { json } from './helpers';
import { D1, legId, openResult, place, resultFixture, REVISION, ROAD, routes, trip, view } from './result-fixture';

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
  expect(screen.queryByRole('button', { name: '경로 모양 다시 불러오기' })).toBeNull();
});

test('scheduled legs use their road shapes even when one or both place lookups returned null', async () => {
  const f = resultFixture({ ...view, places: { ...view.places, [place('airport')]: null, [place('hotel')]: null } });
  const airportLeg = legId(D1, 'airport', 'hotel', 'AIRPORT'), museumLeg = legId(D1, 'hotel', 'museum');
  const marketLeg = legId(D1, 'museum', 'market'), walkBack = legId(D1, 'market', 'hotel');
  // Two Tokyo road shapes: Haneda to the lodging (about 15 km), then the lodging to the museum (under 4 km).
  f.shapes.mockImplementationOnce(async url => json({ inputHash: REVISION, itineraryId: url.searchParams.get('itineraryId'),
    legs: trip(REVISION).comparisons.map(leg => {
      const encoded = leg.kind === 'AIRPORT' ? 'wf~wEwvctY_xNvhAw}HrD' : leg.to === place('museum') ? 'o~wxEkgatYgbC{JwrAka@' : null;
      return { date: leg.date, kind: leg.kind, from: leg.from, to: leg.to, mode: leg.selected.mode,
        shape: encoded ? { status: 'OK', encodedPolyline: encoded } : { status: 'NONE' } };
    }),
  }));
  await openResult(f);
  await waitFor(() => expect(routes()[airportLeg]).toMatch(/TRANSIT FLOATING DIM .* ROAD$/));
  expect(JSON.parse(screen.getByTestId('points-' + airportLeg).props.children)).toContainEqual({ latitude: 35.6302, longitude: 139.768 });
  expect(routes()[museumLeg]).toMatch(/TRANSIT SOLID STRONG .* ROAD$/);
  expect(JSON.parse(screen.getByTestId('points-' + museumLeg).props.children)).toContainEqual({ latitude: 35.7022, longitude: 139.769 });
  expect(routes()[marketLeg]).toMatch(/TAXI DOTTED DIM .* STRAIGHT$/);
  expect(routes()[walkBack]).toBeUndefined();
  await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
  expect(screen.getByTestId('schedule-leg-' + airportLeg)).toHaveTextContent(/40분.*도심 밖/);
  expect(screen.getByTestId('schedule-leg-' + museumLeg)).toHaveTextContent(/10:30.*10:55/);
  expect(screen.getByTestId('schedule-leg-' + museumLeg)).not.toHaveTextContent(/도심 밖/);
  expect(screen.getByTestId('schedule-leg-' + walkBack)).toHaveTextContent(/도보 30분/);
});
