import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { colors, legColors, typography, spacing, radius, size, motion } from '../src/index';

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

test('all transition durations, distances, easing, scale and opacity match §8', () => {
  assert.deepEqual([motion.screen.duration, motion.screen.translateX], numbers(row(8, '화면 전환')));
  assert.ok(row(8, '화면 전환').includes(motion.screen.easing));
  assert.deepEqual([motion.panel.duration, ...motion.panel.bezier], numbers(row(8, '패널 스냅')));
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
