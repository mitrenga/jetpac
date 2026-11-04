#!/usr/bin/env python3
"""Porovná snapshot (.z80/.sna/.szx) s obrazem paměti z kazety.

    ./tools/matchsnapshot.py [soubor ...]

Bez argumentů vezme všechny snapshoty v `sources/tape/`.

★ **K čemu to je.** Hraje-li se originál z jiného souboru, než ze kterého se
měří, je celá metodika k ničemu — čísla by platila pro jiný program. Tenhle
nástroj proto řekne, jestli je to **týž program bajt po bajtu**, a ne „vypadá
to stejně".

★ **Snapshot bývá pořízený před přesunem.** Kazeta nahraje kód na `$6000`
a ten se **hned posune o čtyři bajty dolů** (`$5B80`: `LDIR $6004→$6000`,
`disasm_notes.md` §1). Snapshot sejmutý hned po nahrání ten přesun ještě
nemá — na `$6000` má `DI / JP $5B80`, tedy ten přesouvač. Nástroj proto
zkusí obojí a řekne, která poloha sedí.

Obrazovka se porovnává zvlášť a **rozdíl v ní není chyba**: snapshot po
nahrání má přes loading screen ještě to, co na něj vypsal zavaděč v BASICu.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

import jetpaclib as J                                     # noqa: E402
from skoolkit.snapshot import Snapshot                    # noqa: E402

CODE, CODE_END = 0x6000, 0x8000
SCREEN, SCREEN_END = 0x4000, 0x5B00
# o kolik je kód v paměti proti kazetě posunutý, než se provede $5B80
SHIFTS = (0, 4)
SNAPSHOTS = ('.z80', '.sna', '.szx')


def compare(image, ram, shift):
    """Kolik bajtů kódu se liší, je-li snapshot posunutý o `shift`."""
    return sum(1 for addr in range(CODE, CODE_END - shift)
               if ram[addr + shift - SCREEN] != image[addr - SCREEN])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='*')
    ap.add_argument('--tape', default=None, help='kazeta, proti které se měří')
    args = ap.parse_args()

    root = os.path.join(HERE, '..')
    tape_dir = os.path.join(root, 'sources', 'tape')
    tape = args.tape
    if tape is None:
        tapes = [name for name in sorted(os.listdir(tape_dir))
                 if name.lower().endswith(('.tap', '.tzx'))]
        if not tapes:
            print('v sources/tape není kazeta, není proti čemu měřit')
            return 2
        tape = os.path.join(tape_dir, tapes[0])
    image = J.memory_image(tape)

    files = args.files
    if not files:
        files = [os.path.join(tape_dir, name) for name in sorted(os.listdir(tape_dir))
                 if name.lower().endswith(SNAPSHOTS)]
    if not files:
        print('v sources/tape není žádný snapshot — není co porovnávat')
        return 0

    print('kazeta: %s' % os.path.basename(tape))
    worst = 0
    for path in files:
        snapshot = Snapshot.get(path)
        if snapshot is None:
            print('%-46s nelze načíst' % os.path.basename(path))
            worst = 2
            continue
        ram = snapshot.ram(-1)
        best, diffs = min(((shift, compare(image, ram, shift)) for shift in SHIFTS),
                          key=lambda item: item[1])
        screen = sum(1 for addr in range(SCREEN, SCREEN_END)
                     if ram[addr - SCREEN] != image[addr - SCREEN])
        checks = CODE_END - CODE - best
        print('%-46s kód %5d kontrol, **%d rozdílů**%s'
              % (os.path.basename(path), checks, diffs,
                 '   (posunutý o %d B, tedy před $5B80)' % best if best else ''))
        print('%-46s obrazovka %d rozdílů z %d   (zavaděč v BASICu, ne chyba)'
              % ('', screen, SCREEN_END - SCREEN))
        worst = max(worst, 1 if diffs else 0)

    return worst


if __name__ == '__main__':
    sys.exit(main())
