#!/usr/bin/env python3
"""Konstanty fyziky z originálu → data/physics.json, a kontrola portu.

    ./tools/dumpphysics.py [--check]

Jetpac nemá tabulku fyziky — **každé číslo je operand instrukce**. Tenhle
nástroj je proto přečte přímo z obrazu paměti (tools/jetpaclib.py) na adresách,
kde stojí, a uloží je i s tím, odkud jsou. S `--check` navíc ověří, že
`app/jetmanPhysics.js` používá pořád tatáž čísla — kdyby někdo v portu sáhl
na konstantu, je to vidět hned a ne až na tisícím kroku porovnání.

Že ta čísla dávají dohromady pohyb originálu, hlídá `tools/matchphysics.js`
proti nahraným běhům. Tohle hlídá tu druhou půlku: že se neopisují odjinud.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jetpaclib as J   # noqa: E402

# jméno v portu → (adresa operandu, co to je)
CONSTANTS = {
    'MAX_SPEED_X': (0x7403, 'strop vodorovné rychlosti ($7402: CP $40)'),
    'MAX_SPEED_Y': (0x7465, 'strop svislé rychlosti ($7464: CP $3F)'),
    'CEILING':     (0x74A5, 'strop hrací plochy ($74A4: CP $2A)'),
    'BOTTOM':      (0x74A1, 'spodek obrazovky ($74A0: CP $C0)'),
    'WALK_HOLD':   (0x75B0, 'počítadlo kroku chůze ($75AD: LD (IX+$05),$20)'),
}
# čísla, která se v kódu objevují jako součást instrukce, ne jako operand bajtu
DERIVED = {
    'ACCELERATION': (8, 'zrychlení za krok: $73FD ADD A,$08 nad -($5DCA), '
                        'a $5DCA je za hry nula ($6333 vynuluje $5CF4-$5FFF)'),
    'STEP_SHIFT': (8, 'posun za krok = rychlost * 8 v 1/256 px '
                      '($7414: třikrát ADD HL,HL)'),
    'EDGE_MARGIN': (0x12, 'okraj plošiny ($7637: ADD A,$12)'),
    'TAKEOFF_LIFT': (2, 'odskok od plošiny ($75D9: dvakrát DEC (IX+$02))'),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true',
                    help='ověřit, že app/jetmanPhysics.js drží tatáž čísla')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data/physics.json'))
    args = ap.parse_args()

    mem = J.memory_image()
    data = {
        'note': ('konstanty fyziky Jetmana, přečtené jako operandy instrukcí '
                 '(tools/dumpphysics.py); že z nich vychází pohyb originálu, '
                 'dokazuje tools/matchphysics.js'),
        'constants': {},
        'derived': {},
    }
    for name, (addr, what) in sorted(CONSTANTS.items()):
        data['constants'][name] = {'value': J.peek(mem, addr, 1)[0],
                                   'addr': addr, 'note': what}
    for name, (value, what) in sorted(DERIVED.items()):
        data['derived'][name] = {'value': value, 'note': what}

    open(args.out, 'w').write(json.dumps(data, indent=1, ensure_ascii=False))
    print('%s: %d konstant z operandů, %d odvozených'
          % (os.path.relpath(args.out, os.path.join(HERE, '..')),
             len(data['constants']), len(data['derived'])))
    for name, item in sorted(data['constants'].items()):
        print('   %-12s $%02X (%3d)  z $%04X' % (name, item['value'], item['value'], item['addr']))

    if not args.check:
        return 0

    source = open(os.path.join(HERE, '..', 'app/jetmanPhysics.js')).read()
    problems = []
    for name, item in sorted(data['constants'].items()):
        found = re.search(r'\b' + name + r':\s*(0x[0-9A-Fa-f]+|\d+)', source)
        if not found:
            problems.append('%s v portu není' % name)
            continue
        used = int(found.group(1), 0)
        if used != item['value']:
            problems.append('%s: port má $%02X, originál má $%02X na $%04X'
                            % (name, used, item['value'], item['addr']))
    if problems:
        print('\nNÁLEZY:')
        for text in problems:
            print('  - ' + text)
        return 1
    print('\nport app/jetmanPhysics.js drží všech %d konstant tak, jak jsou v originálu'
          % len(data['constants']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
