import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { colors, legColors, typography, spacing, radius, size, motion, shadow, result } from '../src/index';

const document = readFileSync(new URL('../../../docs/design.md', import.meta.url), 'utf8');
function section(number: number) {
  const heading = `## ${number}.`;
  const start = document.indexOf(heading);
  assert.ok(start >= 0, heading);
  const end = document.indexOf('\n## ', start + heading.length);
  return document.slice(start, end < 0 ? undefined : end);
}
function row(number: number, label: string) {
  const line = section(number).split('\n').find(line => line.startsWith(`| ${label} |`));
  assert.ok(line, `${number}: ${label}`);
  return line.split('|').slice(2, -1).join('|');
}
function numbers(value: string) { return [...value.matchAll(/-?(?:\d*\.)?\d+/g)].map(match => Number(match[0])); }
function hexes(value: string) { return value.match(/#[A-Fa-f0-9]{6}/g) ?? []; }
function line(number: number, prefix: string) {
  const value = section(number).split('\n').find(line => line.startsWith(prefix));
  assert.ok(value, prefix);
  return value;
}

test('all semantic colors and six leg colors equal their own design document rows', () => {
  for (const [label, values] of [
    ['스카이 블루', Object.values(colors.sky)], ['피치', Object.values(colors.peach)],
    ['앰버', Object.values(colors.amber)], ['그린', Object.values(colors.green)],
    ['레드', Object.values(colors.red)], ['그레이', Object.values(colors.gray)],
    ['배경', [colors.background, colors.card]], ['지도 노선색', colors.subwayExamples],
  ] as const) assert.deepEqual(values, hexes(row(2, label)), label);
  assert.deepEqual(legColors, hexes(line(2, '| `#5B')));
  assert.equal(motion.subwayOpacity, numbers(row(2, '지도 노선색').split('예:')[0])[0] / 100);
});

test('Pretendard, tracking, tabular numerals and each size/weight equal §3', () => {
  assert.equal(typography.family, section(3).match(/\*\*(\w+)\*\*/)?.[1]);
  assert.equal(typography.letterSpacingEm, Number(section(3).match(/자간 (-?[\d.]+)em/)?.[1]));
  assert.match(section(3), /숫자 고정폭/);
  assert.equal(typography.numbers, 'tabular-nums');
  for (const [label, spec] of [
    ['화면 제목', typography.title], ['날짜 제목', typography.date],
    ['장소 이름 · 주 버튼', typography.place], ['본문', typography.body],
    ['설명', typography.description], ['보조 (이동 요약 등)', typography.secondary],
  ] as const) assert.deepEqual([spec.size, spec.weight], numbers(row(3, label)), label);
  assert.deepEqual(Object.values(typography.small), numbers(row(3, '작은 글자 (범례, 개수)')));
});

test('spacing, radius ranges, touch target and top bar match §4', () => {
  assert.deepEqual(spacing.steps, numbers(line(4, '- 간격 단계:')));
  assert.deepEqual([spacing.screen, spacing.cardOutside, spacing.cardInside, spacing.cardGap, spacing.section],
    numbers(line(4, '- 화면 좌우')));
  assert.deepEqual([radius.small, radius.input.min, radius.input.max, radius.card.min, radius.card.max, radius.panel],
    numbers(line(4, '- 모서리:')));
  assert.deepEqual([size.touch, size.touch], numbers(line(4, '- 터치 영역')));
  assert.deepEqual([size.topBar, size.back, typography.title.size, typography.title.weight], numbers(line(4, '- 상단 바')));
});

test('component sizes and footer spacing match §5', () => {
  const primary = row(5, '주 버튼').replace(/`#[\w]+`/g, '');
  assert.deepEqual([size.button, radius.button, typography.place.size, typography.place.weight, spacing.buttonTop, spacing.buttonBottom], numbers(primary));
  assert.deepEqual([size.switch.width, size.switch.height], numbers(row(5, '스위치').replace(/`#[\w]+`/g, '')));
  assert.deepEqual([size.checkbox, size.checkboxBorder, size.checkboxTouch], numbers(row(5, '체크박스(필수 선택)').replace(/`#[\w]+`/g, '')));
  assert.deepEqual([size.search, radius.search], numbers(row(5, '검색 칸')));
  assert.deepEqual([size.chip, radius.chip, size.focusBorder, typography.place.weight], numbers(row(5, '필터 칩').replace(/`#[\w]+`/g, '')));
  assert.deepEqual([radius.panel, size.handle.width, size.handle.height, motion.sheet.backdropOpacity * 100, 1, 2], numbers(row(5, '하단 시트').replace(/`#[\w]+`/g, '')));
  assert.deepEqual([radius.toast], numbers(row(5, '토스트')));
  assert.deepEqual([size.iconTile, radius.tile, typography.place.size, typography.place.weight, typography.secondary.size, size.rowButton], numbers(row(5, '목록 줄').replace(/`#[\w]+`/g, '')));
});

test('floating, panel and toast shadows match §4', () => {
  const shadows = line(4, '- 그림자는').split(', ');
  const values = (label: string) => {
    const part = shadows.find(value => value.includes(label));
    assert.ok(part, label);
    return numbers(part.slice(part.indexOf('`')));
  };
  for (const [label, spec] of [['날짜 선택', shadow.floating], ['하단 시트·패널', shadow.panel], ['토스트', shadow.toast]] as const) {
    assert.deepEqual(values(label), [0, spec.y, spec.blur, ...spec.rgb, spec.opacity], label);
  }
});

test('R2 result layout, card, marker and route values match §6–7', () => {
  const layout = (label: string) => numbers(row(7, label).replace(/`#[\w]+`/g, ''));
  assert.deepEqual(layout('상단 바'), [result.topBar.top, result.topBar.inset, result.topBar.height, result.topBar.radius,
    size.back, result.name.size, result.name.weight, typography.secondary.size, size.touch]);
  assert.deepEqual(layout('날짜 선택').slice(0, 5), [result.dateChips.top, result.dateChips.inset, result.dateChips.height,
    result.dateChips.radius, result.dateChips.gap]);
  assert.ok(layout('날짜 선택').includes(size.focusBorder));
  assert.deepEqual(layout('현재 위치 버튼'), [result.locate.offset, result.locate.inset, result.locate.size]);
  assert.deepEqual(layout('장소 패널'), [result.panel.top, result.panel.ratio * 100]);
  assert.deepEqual(numbers(line(7, '3. 장소 카드 줄')), [3, result.cardRow.width, result.cardRow.gap, result.cardRow.inset]);
  const pager = line(7, '4. 넘김 줄');
  assert.deepEqual(numbers(pager.replace(/`#[\w]+`/g, '')), [4, size.touch, typography.place.weight, size.touch, size.touch, result.pager.editRadius]);
  assert.deepEqual(hexes(pager), [result.pager.disabled]);
  const card = line(7, '**장소 카드**');
  assert.deepEqual(hexes(card), [result.card.surface, colors.sky.primary]);
  assert.deepEqual(numbers(card.replace(/`#[\w]+`/g, '')), [result.card.radius, result.card.padding, result.card.border]);
  assert.deepEqual(numbers(row(7, '1').replace(/`#[\w]+`/g, '')), [result.number.size, typography.small.min,
    result.name.weight, result.name.size, result.name.weight]);
  assert.deepEqual([...numbers(row(7, '구분선').replace(/`#[\w]+`/g, '')), ...hexes(row(7, '구분선'))],
    [result.card.dividerWidth, result.card.divider]);
  assert.deepEqual(numbers(row(7, '5').replace(/`#[\w]+`/g, '').replace(/"[^"]*"/g, '')),
    [typography.secondary.size, result.switchChip.height, typography.small.min, result.name.weight, size.touch]);
  assert.equal(numbers(line(7, '- 선택하지 않은 카드'))[0], result.overlay.unselected * 100);
  assert.ok(line(7, '- 이동수단을 바꾸면').includes(`카드 ${result.overlay.busy * 100}% 흐리게`));
  const marker = line(7, '- 카드를 넘기거나');
  assert.ok(marker.includes(`${result.marker.selectedScale}배`) && marker.includes(`바깥 ${result.marker.ring} 반투명`));
  assert.ok(line(7, '- 희망 마커는').includes(`${result.marker.wishOpacity * 100}% 불투명도`));
  assert.ok(row(6, '기본 · 카드 선택 (3-1)').includes(`${result.route.dimOpacity * 100}%로 흐리게`));
  assert.ok(line(6, '- **도심 밖 판정').includes(`직선거리 ${result.route.outsideKm}km 이상`));
});

test('all transition durations, distances, easing, scale and opacity match §8', () => {
  assert.deepEqual([motion.screen.duration, motion.screen.translateX], numbers(row(8, '화면 전환')));
  assert.ok(row(8, '화면 전환').includes(motion.screen.easing));
  assert.deepEqual([motion.panel.duration, ...motion.panel.bezier], numbers(row(8, '카드 넘김')));
  assert.deepEqual([motion.sheet.duration, motion.sheet.backdropOpacity * 100], numbers(row(8, '시트 등장')));
  assert.deepEqual([motion.press.duration, motion.press.scale], numbers(row(8, '누름 반응')));
  assert.equal(motion.skeleton.duration, numbers(row(8, '재계산'))[0] * 1000);
});

test('token module has no imports or platform/I/O dependencies', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|process|fetch)\b/);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.dependencies ?? {}, {});
});
