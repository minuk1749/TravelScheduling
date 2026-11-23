"""앱 아이콘·적응형 아이콘·스플래시 이미지를 만든다 (표준 라이브러리만 사용).

실행: python3 -I apps/mobile/scripts/generate-icons.py apps/mobile/assets
색은 docs/design.md의 스카이 블루 주 색(#2A64A8)과 흰색이다. 결과 PNG는 저장소에 커밋하므로
디자인을 바꿀 때만 다시 실행한다.
"""
import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
SAMPLES = 2  # 축마다 2x2 슈퍼샘플링으로 가장자리를 부드럽게 한다
BLUE = (0x2A, 0x64, 0xA8)
WHITE = (255, 255, 255)


def in_pin(x, y, scale):
    """핀 모양(원 + 아래쪽 뾰족 끝)에서 흰 영역이면 1, 가운데 구멍이면 -1, 밖이면 0."""
    cx, cy = SIZE / 2, SIZE / 2 - 70 * scale
    radius = 230 * scale
    tip_y = SIZE / 2 + 330 * scale
    hole = 90 * scale
    if math.hypot(x - cx, y - cy) <= hole:
        return -1
    if math.hypot(x - cx, y - cy) <= radius:
        return 1
    # 원에 접하는 두 직선과 끝점이 만드는 삼각형
    if y > cy:
        d = tip_y - cy
        tangent = math.asin(radius / d)
        half = math.tan(tangent) * (tip_y - y)
        if y <= tip_y and abs(x - cx) <= half and (y - cy) >= radius * math.sin(tangent):
            return 1
    return 0


def in_route(x, y, scale):
    """핀 아래의 점선 경로와 출발 점."""
    start = (SIZE / 2 - 300 * scale, SIZE / 2 + 300 * scale)
    end = (SIZE / 2 - 60 * scale, SIZE / 2 + 330 * scale)
    if math.hypot(x - start[0], y - start[1]) <= 48 * scale:
        return True
    for i in range(1, 4):
        t = i / 4
        dot = (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
        if math.hypot(x - dot[0], y - dot[1]) <= 18 * scale:
            return True
    return False


def render(scale, opaque):
    """RGBA 바이트 행 목록. opaque면 파란 배경을 채우고, 아니면 투명 바탕에 흰 핀만 그린다."""
    rows = []
    for py in range(SIZE):
        row = bytearray([0])
        for px in range(SIZE):
            white = blue = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    x = px + (sx + 0.5) / SAMPLES
                    y = py + (sy + 0.5) / SAMPLES
                    pin = in_pin(x, y, scale)
                    if pin == 1 or in_route(x, y, scale):
                        white += 1
                    elif pin == -1 and not opaque:
                        blue += 1  # 투명 이미지에서도 핀 구멍은 파란색으로 채운다
            total = SAMPLES * SAMPLES
            if opaque:
                coverage = white / total
                row += bytes(round(BLUE[i] + (WHITE[i] - BLUE[i]) * coverage) for i in range(3)) + b'\xff'
            else:
                alpha = (white + blue) / total
                if alpha == 0:
                    row += b'\x00\x00\x00\x00'
                else:
                    mixed = tuple(round((WHITE[i] * white + BLUE[i] * blue) / (white + blue)) for i in range(3))
                    row += bytes(mixed) + bytes([round(255 * alpha)])
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)
    data = zlib.compress(b''.join(rows), 9)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', data) + chunk(b'IEND', b''))


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    write_png(out / 'icon.png', render(1.0, True))
    # 적응형 아이콘은 가운데 지름 66% 안이 항상 보이므로 핀을 줄인다.
    write_png(out / 'adaptive-icon.png', render(0.62, False))
    write_png(out / 'splash-icon.png', render(0.8, False))


if __name__ == '__main__':
    main()
