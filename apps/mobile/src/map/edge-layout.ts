import type { EdgeSide } from './geometry';
import type { MapRect } from './types';

type Size = Pick<MapRect, 'width' | 'height'>;

function overlaps(a: MapRect, b: MapRect, gap: number) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Keep the badge as close to its natural edge anchor as the measured controls and other labels allow. */
export function placeEdgeBadge(side: EdgeSide, size: Size, bounds: MapRect, blocked: readonly MapRect[], gap: number) {
  const right = bounds.x + bounds.width - size.width, bottom = bounds.y + bounds.height - size.height;
  const x = side === 'LEFT' ? bounds.x + gap : side === 'RIGHT' ? right - gap : (bounds.x + right) / 2;
  const y = side === 'TOP' ? bounds.y + gap : side === 'BOTTOM' ? bottom - gap : (bounds.y + bottom) / 2;

  // In a shallow viewport the labels may need to touch a control's edge to keep both names visible.
  for (const clearance of [gap, 0]) {
    const minX = bounds.x + clearance, minY = bounds.y + clearance;
    const maxX = right - clearance, maxY = bottom - clearance;
    const xs = [x, minX, maxX], ys = [y, minY, maxY];
    for (const rect of blocked) {
      xs.push(rect.x - clearance - size.width, rect.x + rect.width + clearance);
      ys.push(rect.y - clearance - size.height, rect.y + rect.height + clearance);
    }
    let best: MapRect | null = null, distance = Infinity;
    for (const left of xs) {
      if (left < minX || left > maxX) continue;
      for (const top of ys) {
        if (top < minY || top > maxY) continue;
        const rect = { x: left, y: top, ...size };
        const cost = (left - x) ** 2 + (top - y) ** 2;
        if (cost >= distance || blocked.some(obstacle => overlaps(rect, obstacle, clearance))) continue;
        best = rect;
        distance = cost;
      }
    }
    if (best) return { rect: best, translateX: best.x - x, translateY: best.y - y };
  }
  return null;
}
