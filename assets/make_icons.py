"""Gera o ícone do Scanner de Bolso (amarelo) em todos os tamanhos. Uso: python3 assets/make_icons.py"""
from PIL import Image, ImageDraw, ImageFilter
import os, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INK = (31, 27, 20, 255)
Y1, Y2 = (255, 214, 64), (247, 163, 0)

def gradient(size):
    im = Image.new('RGBA', (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            px[x, y] = tuple(int(Y1[i] + (Y2[i] - Y1[i]) * t) for i in range(3)) + (255,)
    return im

def glyph(S, scale=1.0):
    """Folha com canto dobrado + cantoneiras de enquadramento, sobre fundo transparente."""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = S / 2; u = S * 0.30 * scale  # meia-largura do enquadramento
    # sombra suave da folha
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    pw, ph = u * 1.24, u * 1.60
    def sheet(dx=0, dy=0):
        f = pw * 0.36
        return [(c - pw / 2 + dx, c - ph / 2 + dy), (c + pw / 2 - f + dx, c - ph / 2 + dy), (c + pw / 2 + dx, c - ph / 2 + f + dy), (c + pw / 2 + dx, c + ph / 2 + dy), (c - pw / 2 + dx, c + ph / 2 + dy)]
    sd.polygon(sheet(0, S * 0.018), fill=(120, 70, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.018))
    im.alpha_composite(sh)
    d.polygon(sheet(), fill=(255, 253, 246, 255))
    f = pw * 0.36
    d.polygon([(c + pw / 2 - f, c - ph / 2), (c + pw / 2 - f, c - ph / 2 + f), (c + pw / 2, c - ph / 2 + f)], fill=(255, 205, 60, 255))
    # linhas de texto
    lw = S * 0.028
    for i, k in enumerate([0.62, 0.78, 0.70, 0.48]):
        y = c - ph / 2 + ph * (0.40 + i * 0.13)
        x0 = c - pw / 2 + pw * 0.17
        d.rounded_rectangle([x0, y - lw / 2, x0 + pw * 0.66 * k, y + lw / 2], radius=lw / 2, fill=INK)
    # cantoneiras (L com pontas arredondadas)
    t, L = S * 0.05, u * 0.42
    fx, fy = u * 0.86, u * 1.02
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = c + sx * fx, c + sy * fy
            pts = [(x - sx * L, y), (x, y), (x, y - sy * L)]
            d.line(pts, fill=INK, width=int(t), joint='curve')
            for px, py in (pts[0], pts[2], pts[1]):
                d.ellipse([px - t / 2, py - t / 2, px + t / 2, py + t / 2], fill=INK)
    # linha de leitura
    yl = c + ph * 0.06
    d.rounded_rectangle([c - fx - t * 0.2, yl - S * 0.011, c + fx + t * 0.2, yl + S * 0.011], radius=S * 0.011, fill=(230, 60, 20, 235))
    return im

def full_icon(size, radius_frac=0.225, scale=1.0):
    S = size * 4
    bg = gradient(S)
    mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius_frac, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(bg, (0, 0), mask)
    out.alpha_composite(glyph(S, scale))
    return out.resize((size, size), Image.LANCZOS)

def square_icon(size, scale=0.82):  # sem cantos arredondados (maskable / iOS)
    S = size * 4; im = gradient(S); im.alpha_composite(glyph(S, scale)); return im.resize((size, size), Image.LANCZOS).convert('RGB')

def foreground(size):  # Android adaptive: 108dp, conteúdo dentro de 66dp
    S = size * 4; im = glyph(S, 0.66); return im.resize((size, size), Image.LANCZOS)

www = os.path.join(ROOT, 'www', 'icons'); os.makedirs(www, exist_ok=True)
full_icon(1024).save(os.path.join(ROOT, 'assets', 'icon-1024.png'))
for s in (192, 512): full_icon(s).save(os.path.join(www, f'icon-{s}.png'))
square_icon(512).save(os.path.join(www, 'maskable-512.png'))
square_icon(180, 0.9).save(os.path.join(www, 'apple-touch-icon.png'))
full_icon(64).save(os.path.join(www, 'favicon.png'))

res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
if os.path.isdir(res):
    for name, legacy, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
        dd = os.path.join(res, f'mipmap-{name}'); os.makedirs(dd, exist_ok=True)
        full_icon(legacy).save(os.path.join(dd, 'ic_launcher.png'))
        full_icon(legacy, 0.5).save(os.path.join(dd, 'ic_launcher_round.png'))
        foreground(fg).save(os.path.join(dd, 'ic_launcher_foreground.png'))
    print('ícones Android gerados')
print('ok')
