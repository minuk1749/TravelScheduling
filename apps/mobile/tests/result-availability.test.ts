import { freeTime } from '../src/result/format';

test('empty-day availability distinguishes a closed flight day from a legacy result with unknown bounds', () => {
  expect(freeTime(null, 'Asia/Tokyo')).toBe('여유 시간 없음');
  expect(freeTime(undefined, 'Asia/Tokyo')).toBe('여유 시간 정보 없음');
});
