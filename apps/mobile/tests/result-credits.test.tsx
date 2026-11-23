import { fireEvent, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';
import { json } from './helpers';
import { openResult, place, resultFixture, view } from './result-fixture';

test('the schedule shows the Google Maps source and linked place credits even when shapes fail', async () => {
  const f = resultFixture();
  const id = place('museum');
  const url = 'https://example.org/museum';
  f.read.mockImplementation(() => json({ ...view, places: { ...view.places, [id]: {
    ...view.places[id], attributions: [{ provider: 'Museum archive', providerUri: url }],
  } } }));
  f.shapes.mockRejectedValue(new Error('offline'));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try {
    await openResult(f);
    await fireEvent.press(screen.getByRole('button', { name: '전체 일정' }));
    expect(screen.getByText('장소 정보 · Google Maps')).toBeVisible();
    await fireEvent.press(screen.getByRole('link', { name: 'Museum archive' }));
    expect(open).toHaveBeenCalledWith(url);
  } finally {
    open.mockRestore();
  }
});
