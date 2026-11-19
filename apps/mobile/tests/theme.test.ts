import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { colors, motion, size, text, typography } from '../src/theme';
import { fonts } from '../src/theme/fonts';

test('theme maps Pretendard weights, tracking and tabular numerals for native text', () => {
  expect(text.title).toMatchObject({ fontFamily: 'Pretendard-SemiBold', fontSize: typography.title.size,
    letterSpacing: typography.title.size * typography.letterSpacingEm, fontVariant: ['tabular-nums'] });
  expect(text.body.fontFamily).toBe('Pretendard-Regular');
  expect(text.body.color).toBe(colors.gray.text);
  expect(size.button).toBeGreaterThanOrEqual(size.touch);
  expect(motion.screen.translateX).toBe(24);
});

test('both registered font weights are bundled TrueType assets with OFL license', () => {
  expect(Object.keys(fonts)).toEqual(['Pretendard-Regular', 'Pretendard-SemiBold']);
  for (const name of Object.keys(fonts)) {
    const data = readFileSync(path.join(__dirname, '../assets/fonts', `${name}.ttf`));
    expect(data.readUInt32BE(0)).toBe(0x00010000);
    expect(data.length).toBeGreaterThan(1000);
  }
  expect(readFileSync(path.join(__dirname, '../assets/fonts/LICENSE.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
});

test('mobile production source cannot import server code, use plaintext storage or hardcode colors', () => {
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (/\.tsx?$/.test(file)) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/(?:@travel\/server|apps\/server|\.\.\/server|AsyncStorage|localStorage)/);
        expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      }
    }
  }
  inspect(path.join(__dirname, '../src'));
  inspect(path.join(__dirname, '../app'));
});
