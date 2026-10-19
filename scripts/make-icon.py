"""Generates Hopper's app icon (red rounded square, white hop arc) and the
monochrome tray glyph. Pure Python, no dependencies. Run from the repo root:
    python3 scripts/make-icon.py
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RED = (0xE0, 0x2E, 0x22)


def write_png(path: Path, w: int, h: int, pixels):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixels[y][x])
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def sd_rounded_box(px, py, cx, cy, half, r):
    qx, qy = abs(px - cx) - half + r, abs(py - cy) - half + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def sd_hop(px, py, size):
    """Signed distance to the hop glyph: an arc from the left dot to the right
    dot plus the two dots, in a coordinate system where `size` is the canvas."""
    s = size
    stroke = 0.075 * s
    dot_r = 0.07 * s
    # Arc: upper half of a circle centred slightly below the middle.
    cx, cy, r = 0.5 * s, 0.60 * s, 0.26 * s
    ang = math.atan2(cy - py, px - cx)  # 0 at right, pi at left, positive up
    d_arc = abs(math.hypot(px - cx, py - cy) - r) - stroke / 2
    if not (0.05 <= ang <= math.pi - 0.05):
        # Outside the upper arc: measure to the arc's end caps.
        for a in (0.05, math.pi - 0.05):
            ex, ey = cx + r * math.cos(a), cy - r * math.sin(a)
            d_arc = min(d_arc, math.hypot(px - ex, py - ey) - stroke / 2) if d_arc >= 0 else d_arc
        if 0.05 > ang > -math.pi or ang > math.pi - 0.05:
            d_arc = min(math.hypot(px - (cx + r), py - cy), math.hypot(px - (cx - r), py - cy)) - stroke / 2
    d_dots = min(
        math.hypot(px - (cx - r), py - (cy + 0.14 * s)) - dot_r,
        math.hypot(px - (cx + r), py - (cy + 0.14 * s)) - dot_r,
    )
    return min(d_arc, d_dots)


def coverage(sd, aa):
    return max(0.0, min(1.0, 0.5 - sd / aa))


def render_app_icon(size=1024, out=ROOT / "src-tauri" / "icons" / "hopper-source.png"):
    aa = 1.5
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            bg = coverage(sd_rounded_box(px, py, size / 2, size / 2, size * 0.45, size * 0.2), aa)
            # Subtle vertical gradient on the red so it reads as a surface.
            t = y / size
            r = int(RED[0] + (0xFF - RED[0]) * 0.12 * (1 - t))
            g = int(RED[1] + 18 * (1 - t))
            b = int(RED[2] + 18 * (1 - t))
            glyph = coverage(sd_hop(px, py, size), aa)
            cr = int(r + (255 - r) * glyph)
            cg = int(g + (255 - g) * glyph)
            cb = int(b + (255 - b) * glyph)
            row.append((cr, cg, cb, int(255 * bg)))
        pixels.append(row)
    write_png(out, size, size, pixels)
    return out


def render_tray(size=44, out=ROOT / "src-tauri" / "icons" / "tray.png"):
    # Black glyph on transparent: macOS tints template images itself.
    aa = 1.0
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            g = coverage(sd_hop(px, py, size), aa)
            row.append((0, 0, 0, int(255 * g)))
        pixels.append(row)
    write_png(out, size, size, pixels)
    return out


if __name__ == "__main__":
    print(render_app_icon())
    print(render_tray())
