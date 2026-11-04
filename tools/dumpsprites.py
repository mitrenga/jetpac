#!/usr/bin/env python3
"""Vytáhne z originálu všechnu grafiku → data/sprites.json (+ PNG přehled).

    ./tools/dumpsprites.py [--png build/sprites.png]

**Formát spritu** (odečteno z `$723F` a `$7227`, `sources/docs/disasm_notes.md` §5):

    [dx] [šířka v bajtech] [výška v řádcích] [data: šířka*výška bajtů]

`dx` se přičte k x entity, pak `$7308` spočítá adresu ve videoram. Kreslí se
dvakrát: **maska** (`AND`, přes `CPL`) a **obraz** (`OR`) — dvě různé předlohy,
každá s vlastní hlavičkou.

**Tabulka předloh** je na `$76FA` a `$72C1` do ní počítá index v bajtech:

    ((typ - 1) * 16) + (směr ? 8 : 0) + (x & 6)

tedy **čtyři předsunuté kopie na směr** (posun 0, 2, 4 a 6 pixelů) — hra kreslí
jen na sudých x. Druhá tabulka `$67C3` (21 slov) drží rakety, palivo a poklady.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, HERE)
sys.path.insert(0, RETRO)
import jetpaclib as J                                   # noqa: E402
from scr2png import write_png, PALETTE                  # noqa: E402

SHIFT_TABLE = 0x76FA     # ((typ-1)*16) + dir*8 + (x&6), slova
# ★ Tabulka drží **čtyři typy po 16 bajtech**, tedy 64 B ($76FA-$7739):
# typ 1 = Jetman ve vzduchu, typ 2 = Jetman na plošině (oba osm kopií:
# čtyři posuny × dva směry), typ 3 a 4 = **díly rakety**, a ty ukazují do
# $5E00-$5FFF, kam si je hra před kolem předsune sama ($6929). Nepřátelé
# a předměty do téhle tabulky nepatří – ti jdou přes $67C3.
SHIFT_TYPES = 4
ITEM_TABLE = 0x67C3      # 21 slov: rakety, palivo, poklady
PLATFORMS = 0x6000       # 4 × [příznak, x, y, šířka]
LEVELGFX = 0x6945        # 8 × 2 slova: předlohy rakety pro skupinu kol
PLATFORM_TILES = (0x76E2, 0x76EA, 0x76F2)   # levý konec, střed, pravý konec ($766D)
LIFE_ICON = 0x70DB       # ikonka Jetmana v panelu ($70A4)
PANEL_TEXTS = ((0x18, 0x71AD), (0x78, 0x71B5), (0xD8, 0x71B1))   # x, řetězec ($7192)
SCORE_AT = {'player1': 0x4021, 'hiScore': 0x402D, 'player2': 0x4039}   # $711C/$712C/$7124
LIVES_AT = {'player1': 0x0040, 'player2': 0x00B0}                # x,y pro $7308 ($70A4)
EXPLOSION_TABLE = 0x690F  # tři fáze výbuchu, pak totéž na zhasnutí ($68B1)
ENEMY_BY_LEVEL = 0x6A64  # 8 B: typ nepřítele podle kola ($6A4C)
# ★ Plamen z trysek ($6669): **dvě fáze**, plné záznamy spritu jako předměty,
# kreslené rovnou pod raketu. V žádné tabulce nejsou — obsluha si obě adresy
# nese v instrukcích ($6688 a $66B3), a $5DCC bit 2 mezi nimi přepíná.
FLAME_SOURCES = (0x7F8C, 0x7FAF)


def source_at(mem, addr, header):
    """Zdrojová předloha pro předsunutí: **dvě bajty na řádek**.

    `$6945` (nepřátelé podle kola) má hlavičku jen `[výška]`, `$67C3`
    (předměty, díly rakety, výbuchy) je rovnou plnohodnotný záznam spritu
    `[dx][šířka][výška]` – `$6F42` proto první dva bajty přeskočí.
    """
    h = J.peek(mem, addr + header, 1)[0]
    data = J.peek(mem, addr + header + 1, 2 * h)
    return {'addr': addr, 'height': h, 'bytes': base64.b64encode(data).decode()}


def sprite_at(mem, addr):
    dx = J.peek(mem, addr, 1)[0]
    w = J.peek(mem, addr + 1, 1)[0]
    h = J.peek(mem, addr + 2, 1)[0]
    data = J.peek(mem, addr + 3, w * h)
    return {'addr': addr, 'dx': dx, 'width': w, 'height': h,
            'bytes': base64.b64encode(data).decode()}


def table_words(mem, addr, count):
    return [J.word(mem, addr + 2 * i) for i in range(count)]


def panel_string(mem, addr):
    """Řetězec panelu: první bajt je atribut, pak znaky, poslední má bit 7.

    Tak to čte `$716C`/`$7178`: atribut se odloží, znaky se tisknou ROM fontem
    a bit 7 na znaku je zarážka.
    """
    attr = J.peek(mem, addr, 1)[0]
    text, i = '', 1
    while True:
        c = J.peek(mem, addr + i, 1)[0]
        text += chr(c & 0x7F)
        i += 1
        if c & 0x80:
            break
    return {'attr': attr, 'text': text}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data/sprites.json'))
    ap.add_argument('--png', default=os.path.join(HERE, '..', 'build/sprites.png'))
    args = ap.parse_args()
    mem = J.memory_image()

    count = SHIFT_TYPES * 8
    shifted = table_words(mem, SHIFT_TABLE, count)

    out = {
        'note': ('grafika z originálu (tools/dumpsprites.py). Sprite = '
                 '[dx][šířka v bajtech][výška][data], a **data jdou zdola nahoru**: '
                 'bajt 0 je spodní řádek a kreslí se na y entity, každý další '
                 'o pixel výš ($72EE dělá DEC H). Ověřeno proti obrazovce originálu.'),
        'shiftTable': {'addr': SHIFT_TABLE, 'count': count, 'pointers': shifted},
        'itemTable': {'addr': ITEM_TABLE, 'pointers': table_words(mem, ITEM_TABLE, 21)},
        'sprites': {},
        'platforms': [],
        'platformTiles': {'$%04X' % a: base64.b64encode(J.peek(mem, a, 8)).decode()
                          for a in PLATFORM_TILES},
        'levelGfx': table_words(mem, LEVELGFX, 16),
        # ★ Zdroje pro předsunutí. Nepřítel kola se skládá ze **dvou předloh**
        # ($6929 vezme dvě slova a udělá z nich kopie s posunem 0 a 4), takže
        # u některých kol se zvíře „animuje" tím, jak se hýbe – druhá fáze je
        # zároveň druhý posun. Čtyři kola z osmi mají obě předlohy stejné.
        'enemySources': {'$%04X' % a: source_at(mem, a, 0)
                         for a in table_words(mem, LEVELGFX, 16)},
        # $67C3: díly rakety, palivo, poklady a výbuchy – plné záznamy spritu,
        # kreslené rovnou (stojí na místě, takže je předsouvat netřeba)
        'itemSources': {'$%04X' % a: sprite_at(mem, a)
                        for a in (set(table_words(mem, ITEM_TABLE, 21))
                                  | set(table_words(mem, EXPLOSION_TABLE, 6))
                                  | set(FLAME_SOURCES))},
        # dvě fáze plamene, v pořadí, ve kterém je vybírá $5DCC AND 4:
        # nenula = $7F8C ($66B3), nula = $7FAF ($6688)
        'flameSprites': list(FLAME_SOURCES),
        'explosionTable': table_words(mem, EXPLOSION_TABLE, 6),
        'enemyByLevel': list(J.peek(mem, ENEMY_BY_LEVEL, 8)),
        'panel': {
            'labels': [{'x': x, 'y': 0, **panel_string(mem, a)} for x, a in PANEL_TEXTS],
            'scoreAt': SCORE_AT,
            'livesAt': LIVES_AT,
            'digits': 6,
            'lifeIcon': base64.b64encode(J.peek(mem, LIFE_ICON, 8)).decode(),
        },
    }
    for a in sorted(set(shifted) | set(out['itemTable']['pointers'])):
        if 0x6000 <= a < 0x8000:
            out['sprites']['$%04X' % a] = sprite_at(mem, a)
    for i in range(4):
        f, x, y, w = J.peek(mem, PLATFORMS + 4 * i, 4)
        out['platforms'].append({'flag': f, 'x': x, 'y': y, 'width': w})

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
    print('%s: %d předloh, tabulka $%04X má %d slov'
          % (args.out, len(out['sprites']), SHIFT_TABLE, count))

    if args.png:
        render(out, args.png)


def render(out, path, cols=8, cell=(64, 40), scale=2):
    """Přehledový obrázek: bílé pixely na černé, jen pro oko."""
    items = sorted(out['sprites'].items())
    rows = (len(items) + cols - 1) // cols
    W, H = cols * cell[0], rows * cell[1]
    buf = [bytearray(b'\x00' * (W * 3)) for _ in range(H)]
    for i, (key, spr) in enumerate(items):
        ox, oy = (i % cols) * cell[0], (i // cols) * cell[1]
        data = base64.b64decode(spr['bytes'])
        for y in range(spr['height']):
            for bx in range(spr['width']):
                b = data[y * spr['width'] + bx]
                for bit in range(8):
                    if b >> (7 - bit) & 1:
                        px, py = ox + bx * 8 + bit, oy + y
                        if px < W and py < H:
                            buf[py][px * 3:px * 3 + 3] = bytes(PALETTE[15])
    write_png(path, [bytes(r) for r in buf], W, scale)
    print('%s (%dx%d)' % (path, W * scale, H * scale))


if __name__ == '__main__':
    main()
