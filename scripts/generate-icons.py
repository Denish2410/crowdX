"""Generates CrowdX placeholder PWA icons into public/. Run: python3 scripts/generate-icons.py"""
from PIL import Image, ImageDraw
import math

NAVY = (7, 17, 31)
BLUES = [(22, 135, 255), (72, 164, 255)]
SS = 4  # supersampling


def render(size, safe):
    """safe = fraction of canvas the X may occupy (smaller for maskable)."""
    n = size * SS
    img = Image.new("RGB", (n, n), NAVY)
    d = ImageDraw.Draw(img)
    lo, hi = n * (0.5 - safe / 2), n * (0.5 + safe / 2)
    w = int(n * 0.085)
    # Each stroke of the X is a bundle of 3 parallel "crowd-flow" lines.
    for flip in (False, True):
        a, b = (lo, hi), (hi, lo)
        if flip:
            a, b = (hi, hi), (lo, lo)
            a, b = (lo, hi), (hi, lo)
        x0, y0 = (lo, lo) if not flip else (hi, lo)
        x1, y1 = (hi, hi) if not flip else (lo, hi)
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        px, py = -dy / L, dx / L
        for i, off in enumerate((-1.6, 0, 1.6)):
            ox, oy = px * off * w, py * off * w
            shrink = 0 if off == 0 else 0.08
            sx, sy = x0 + dx * shrink + ox, y0 + dy * shrink + oy
            ex, ey = x1 - dx * shrink + ox, y1 - dy * shrink + oy
            col = BLUES[1] if off == 0 else BLUES[0]
            d.line([(sx, sy), (ex, ey)], fill=col, width=w if off == 0 else int(w * 0.7))
            r = (w if off == 0 else w * 0.7) / 2
            for cx, cy in ((sx, sy), (ex, ey)):
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    return img.resize((size, size), Image.LANCZOS)


render(192, 0.62).save("public/pwa-192x192.png")
render(512, 0.62).save("public/pwa-512x512.png")
render(512, 0.46).save("public/pwa-maskable-512x512.png")  # X within the 80% safe zone
render(180, 0.62).save("public/apple-touch-icon.png")
render(64, 0.7).save("public/favicon.png")
