"""Generates the MyPlayer logo files in assets/logo/ and build/icon.png.
Run: python3 scripts/make-logo.py   (needs fonttools + brotli, and ImageMagick's `magick` for PNGs)
The wordmark is converted to outlines so the SVGs render the same without any font installed."""
import subprocess
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'logo'
FONT = ROOT / 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2'

INK, BONE, LAMP, RULE = '#0f1217', '#ece8df', '#ffb23f', '#2a313c'

# The mark: an "M" drawn as one seek-line. The lamp is the playhead, resting where the line peaks.
M_PATH = 'M132 352 V176 L256 300 L380 176 V352'

def m_shape(fg: str) -> str:
    """Whole M in the foreground color, then the left half (the 'played' side) redrawn in amber, cut at the valley."""
    sw = 'fill="none" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"'
    return (f'<defs><clipPath id="played"><rect x="0" y="0" width="256" height="512"/></clipPath></defs>\n  '
            f'<path d="{M_PATH}" stroke="{fg}" {sw}/>\n  '
            f'<path d="{M_PATH}" stroke="{LAMP}" {sw} clip-path="url(#played)"/>')

def mark(bg: bool, fg=BONE) -> str:
    rect = '<rect width="512" height="512" rx="112" fill="%s"/>' % INK if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  {rect}
  {m_shape(fg)}
</svg>
'''

def text_path(text: str, size: float, wght: int = 700, wdth_scale: float = 1.0) -> tuple[str, float]:
    font = instancer.instantiateVariableFont(TTFont(FONT), {'wght': wght})
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    scale, x, parts = size / upm, 0.0, []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        parts.append(pen.getCommands())
        x += gs[name].width * scale
    return ' '.join(parts), x

def horizontal(on_dark: bool) -> str:
    fg = BONE if on_dark else INK
    d, w = text_path('MyPlayer', 128, wght=600)
    total = 230 + w + 56
    bg = f'<rect width="{total:.0f}" height="280" rx="44" fill="{INK}"/>' if on_dark else ''
    # the mark is drawn 512 wide; scale it to 200 and place it left of the wordmark
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{total:.0f}" height="280" viewBox="0 0 {total:.0f} 280">
  {bg}
  <g transform="translate(-6 8) scale(0.5)">
  {m_shape(fg)}
  </g>
  <path transform="translate(230 184)" d="{d}" fill="{fg}"/>
</svg>
'''

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'app-icon.svg').write_text(mark(True))
(OUT / 'mark.svg').write_text(mark(False))
(OUT / 'logo-dark.svg').write_text(horizontal(True))
(OUT / 'logo-light.svg').write_text(horizontal(False))
(ROOT / 'build' / 'icon.svg').write_text(mark(True))

def png(src: Path, dst: Path, width: int):
    subprocess.run(['magick', '-background', 'none', '-density', '384', str(src), '-resize', f'{width}x', str(dst)], check=True)

png(OUT / 'app-icon.svg', OUT / 'app-icon.png', 512)
png(OUT / 'app-icon.svg', ROOT / 'build' / 'icon.png', 512)
png(OUT / 'logo-dark.svg', OUT / 'logo-dark.png', 1200)
png(OUT / 'logo-light.svg', OUT / 'logo-light.png', 1200)
print('written:', *sorted(p.name for p in OUT.iterdir()))
