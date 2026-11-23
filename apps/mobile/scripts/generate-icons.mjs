// 앱 아이콘·적응형 아이콘·스플래시 이미지를 만든다 (Node 내장 모듈만 사용).
//
// 실행: node apps/mobile/scripts/generate-icons.mjs apps/mobile/assets
// 색은 docs/design.md의 스카이 블루 주 색(#2A64A8)과 흰색이다. 결과 PNG는 저장소에 커밋하므로
// 디자인을 바꿀 때만 다시 실행한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 1024;
const SAMPLES = 2; // 축마다 2x2 슈퍼샘플링으로 가장자리를 부드럽게 한다
const BLUE = [0x2a, 0x64, 0xa8];
const WHITE = [255, 255, 255];

/** 핀(원 + 아래쪽 뾰족 끝): 흰 영역 1, 가운데 구멍 -1, 밖 0. */
function pinAt(x, y, scale) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 - 70 * scale;
  const radius = 230 * scale;
  const tipY = SIZE / 2 + 330 * scale;
  const distance = Math.hypot(x - cx, y - cy);
  if (distance <= 90 * scale) return -1;
  if (distance <= radius) return 1;
  // 원에 접하는 두 직선과 끝점이 만드는 삼각형
  const tangent = Math.asin(radius / (tipY - cy));
  const half = Math.tan(tangent) * (tipY - y);
  return y <= tipY && y - cy >= radius * Math.sin(tangent) && Math.abs(x - cx) <= half ? 1 : 0;
}

/** 핀 왼쪽 아래의 출발 점과 핀으로 이어지는 점 세 개. */
function routeAt(x, y, scale) {
  const start = [SIZE / 2 - 300 * scale, SIZE / 2 + 300 * scale];
  const end = [SIZE / 2 - 60 * scale, SIZE / 2 + 330 * scale];
  if (Math.hypot(x - start[0], y - start[1]) <= 48 * scale) return true;
  for (const t of [0.42, 0.64, 0.86]) {
    const dotX = start[0] + (end[0] - start[0]) * t;
    const dotY = start[1] + (end[1] - start[1]) * t;
    if (Math.hypot(x - dotX, y - dotY) <= 18 * scale) return true;
  }
  return false;
}

/** RGBA 필터 바이트가 붙은 행. opaque면 파란 배경을 채우고, 아니면 투명 바탕에 흰 핀만 그린다. */
function render(scale, opaque) {
  const data = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let py = 0; py < SIZE; py += 1) {
    data[offset++] = 0;
    for (let px = 0; px < SIZE; px += 1) {
      let white = 0;
      let blue = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          const pin = pinAt(x, y, scale);
          if (pin === 1 || routeAt(x, y, scale)) white += 1;
          else if (pin === -1 && !opaque) blue += 1; // 투명 이미지에서도 핀 구멍은 파란색으로 채운다
        }
      }
      const total = SAMPLES * SAMPLES;
      if (opaque) {
        for (let i = 0; i < 3; i += 1) data[offset++] = Math.round(BLUE[i] + ((WHITE[i] - BLUE[i]) * white) / total);
        data[offset++] = 255;
      } else if (white + blue === 0) {
        offset += 4;
      } else {
        for (let i = 0; i < 3; i += 1) data[offset++] = Math.round((WHITE[i] * white + BLUE[i] * blue) / (white + blue));
        data[offset++] = Math.round((255 * (white + blue)) / total);
      }
    }
  }
  return data;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

function png(data) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8비트 RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = process.argv[2];
if (!out) throw new Error('출력 디렉터리를 인자로 지정하세요.');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), png(render(1, true)));
// 적응형 아이콘은 가운데 지름 66% 안이 항상 보이므로 핀을 줄인다.
writeFileSync(join(out, 'adaptive-icon.png'), png(render(0.62, false)));
writeFileSync(join(out, 'splash-icon.png'), png(render(0.8, false)));
