"""
Generate the app icon (icon.png 256px + icon.ico with 16..256 sizes) with no
dependencies beyond the Python standard library.

Design: dark rounded tile, three "datablock rows"; the middle row is the accent
blue used in the UI and carries a small check notch (the validator).

    python packages/app/build/make-icon.py
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIZE = 1024  # render size; downsampled for every ICO entry

BG = (0x1E, 0x22, 0x2A, 255)
BORDER = (0x3A, 0x41, 0x4D, 255)
ROW = (0x9A, 0xA1, 0xAE, 255)
ACCENT = (0x4D, 0xA3, 0xFF, 255)
DARK = (0x15, 0x17, 0x1B, 255)


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def rounded_rect_sdf(px: float, py: float, cx: float, cy: float, hw: float, hh: float, r: float) -> float:
    """Signed distance to a rounded rectangle centred at (cx, cy)."""
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    outside = (ox * ox + oy * oy) ** 0.5
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def over(dst, src, a):
    """Alpha-composite src (with extra coverage a) over dst; both RGBA tuples 0..255."""
    sa = src[3] / 255.0 * a
    if sa <= 0:
        return dst
    da = dst[3] / 255.0
    oa = sa + da * (1 - sa)
    if oa == 0:
        return (0, 0, 0, 0)
    out = tuple(int(round((src[i] * sa + dst[i] * da * (1 - sa)) / oa)) for i in range(3))
    return (*out, int(round(oa * 255)))


def render(size: int) -> list[list[tuple[int, int, int, int]]]:
    s = size / 1024.0
    img = [[(0, 0, 0, 0)] * size for _ in range(size)]
    # Shapes in 1024-space: (cx, cy, hw, hh, r, colour)
    tile = (512, 512, 460, 460, 190)
    rows = [
        (512, 330, 250, 52, 52, ROW),
        (512, 512, 300, 60, 60, ACCENT),
        (512, 694, 250, 52, 52, ROW),
    ]
    for y in range(size):
        py = (y + 0.5) / s
        row = img[y]
        for x in range(size):
            px = (x + 0.5) / s
            d = rounded_rect_sdf(px, py, *tile)
            if d > 2 / s:
                continue
            c = (0, 0, 0, 0)
            # Border ring then fill.
            c = over(c, BORDER, clamp(0.5 - d * s))
            c = over(c, BG, clamp(0.5 - (d + 26) * s))
            for cx, cy, hw, hh, r, col in rows:
                dr = rounded_rect_sdf(px, py, cx, cy, hw, hh, r)
                c = over(c, col, clamp(0.5 - dr * s))
            # Check notch cut into the accent row's right end.
            dn = rounded_rect_sdf(px, py, 740, 512, 34, 34, 8)
            c = over(c, DARK, clamp(0.5 - dn * s) * 0.95)
            row[x] = c
    return img


def downsample(img, factor: int):
    n = len(img) // factor
    out = []
    for y in range(n):
        row = []
        for x in range(n):
            r = g = b = a = 0
            for dy in range(factor):
                for dx in range(factor):
                    p = img[y * factor + dy][x * factor + dx]
                    w = p[3]
                    r += p[0] * w
                    g += p[1] * w
                    b += p[2] * w
                    a += w
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r // a, g // a, b // a, a // (factor * factor)))
        out.append(row)
    return out


def png_bytes(img) -> bytes:
    n = len(img)
    raw = bytearray()
    for row in img:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def ico_bytes(pngs: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack('<HHH', 0, 1, len(pngs))
    entries = b''
    data = b''
    offset = 6 + 16 * len(pngs)
    for size, png in pngs:
        s = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(png), offset)
        data += png
        offset += len(png)
    return header + entries + data


def main() -> None:
    print('rendering 1024px…')
    big = render(SIZE)
    pngs = []
    for size in (256, 128, 64, 48, 32, 16):
        img = downsample(big, SIZE // size)
        pngs.append((size, png_bytes(img)))
        print(f'  {size}px')
    (HERE / 'icon.png').write_bytes(pngs[0][1])
    (HERE / 'icon.ico').write_bytes(ico_bytes(pngs))
    print('wrote', HERE / 'icon.png', 'and', HERE / 'icon.ico')


if __name__ == '__main__':
    main()
