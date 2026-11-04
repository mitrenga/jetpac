#!/usr/bin/env python3
"""Spustí Jetpac v Z80 simulátoru, odsimuluje stisky kláves a uloží snímky.

    ./tools/playtrace.py [--frames N] [--out DIR] [--map FILE] [--script "..."]

Klávesnice se adresuje po půlřádcích jako na skutečném Spectru. Skript kláves
se dá zadat na příkazové řádce jako `od:do:klavesa,od:do:klavesa,...`
(snímky se počítají od začátku běhu), jinak platí `SCRIPT` níž – ten projde
menu originálu: `1` jeden hráč, `3` klávesnice, `5` start.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

from scr2png import scr_to_rgb, write_png                       # noqa: E402
from skoolkit.snapshot import Snapshot                          # noqa: E402
from skoolkit.simulator import Simulator                        # noqa: E402
from skoolkit.simutils import from_snapshot                     # noqa: E402
from skoolkit.trace import Tracer                               # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                             # pragma: no cover
    CSimulator = None

ROWS = {'$FEFE': 0, '$FDFE': 1, '$FBFE': 2, '$F7FE': 3,
        '$EFFE': 4, '$DFFE': 5, '$BFFE': 6, '$7FFE': 7}
KEYS = {
    'CAPS': ('$FEFE', 0), 'Z': ('$FEFE', 1), 'X': ('$FEFE', 2), 'C': ('$FEFE', 3), 'V': ('$FEFE', 4),
    'A': ('$FDFE', 0), 'S': ('$FDFE', 1), 'D': ('$FDFE', 2), 'F': ('$FDFE', 3), 'G': ('$FDFE', 4),
    'Q': ('$FBFE', 0), 'W': ('$FBFE', 1), 'E': ('$FBFE', 2), 'R': ('$FBFE', 3), 'T': ('$FBFE', 4),
    '1': ('$F7FE', 0), '2': ('$F7FE', 1), '3': ('$F7FE', 2), '4': ('$F7FE', 3), '5': ('$F7FE', 4),
    '0': ('$EFFE', 0), '9': ('$EFFE', 1), '8': ('$EFFE', 2), '7': ('$EFFE', 3), '6': ('$EFFE', 4),
    'P': ('$DFFE', 0), 'O': ('$DFFE', 1), 'I': ('$DFFE', 2), 'U': ('$DFFE', 3), 'Y': ('$DFFE', 4),
    'ENTER': ('$BFFE', 0), 'L': ('$BFFE', 1), 'K': ('$BFFE', 2), 'J': ('$BFFE', 3), 'H': ('$BFFE', 4),
    'SPACE': ('$7FFE', 0), 'SYMSHIFT': ('$7FFE', 1), 'M': ('$7FFE', 2), 'N': ('$7FFE', 3), 'B': ('$7FFE', 4),
}

# (od snímku, do snímku, klávesa)
SCRIPT = [(60, 70, '1'), (100, 110, '3'), (140, 150, '5')]
SHOTS = (50, 130, 200, 400, 800)


def parse_script(text):
    out = []
    for item in text.split(','):
        if not item.strip():
            continue
        a, b, k = item.split(':')
        out.append((int(a), int(b), k.upper()))
    return out


def run(snapshot_path, frames, out_dir, map_path, script, shots, dump=None):
    snapshot = Snapshot.get(snapshot_path)
    if snapshot is None:
        raise SystemExit('nelze nacist snapshot %s' % snapshot_path)
    cls = CSimulator or Simulator
    simulator = from_snapshot(cls, snapshot, {}, {'ay': [None] * 16},
                              {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Tracer(simulator, snapshot.border, snapshot.out7ffd, snapshot.outfffd,
                    list(snapshot.ay), snapshot.outfe, True)
    simulator.set_tracer(tracer)
    os.makedirs(out_dir, exist_ok=True)
    saved = []

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = KEYS[key]
                keyboard[ROWS[row]] |= 1 << bit
        if frame in shots:
            path = os.path.join(out_dir, 'frame%05d.png' % frame)
            write_png(path, scr_to_rgb(bytes(scr)), 256, 2)
            open(path[:-4] + '.scr', 'wb').write(bytes(scr))
            saved.append(path)
        if dump is not None and frame in dump:
            open(os.path.join(out_dir, 'ram%05d.bin' % frame), 'wb').write(
                bytes(simulator.memory[0x4000:0x10000]))
        return frame < frames

    exec_map = set() if map_path else None
    tracer.run(snapshot.pc, -1, 0, 0, True, draw, exec_map, None, None, '$', '04X', '04X')
    for p in saved:
        print('ulozeno', p)
    if exec_map is not None:
        with open(map_path, 'w') as f:
            for a in sorted(exec_map):
                f.write('$%04X\n' % a)
        print('mapa pokryti: %s (%d adres)' % (map_path, len(exec_map)))
    return simulator


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('snapshot', nargs='?', default=os.path.join(HERE, '..', 'build/jetpac.z80'))
    ap.add_argument('--frames', type=int, default=900)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build'))
    ap.add_argument('--map')
    ap.add_argument('--script')
    ap.add_argument('--shots')
    args = ap.parse_args()
    script = parse_script(args.script) if args.script else SCRIPT
    shots = tuple(int(x) for x in args.shots.split(',')) if args.shots else SHOTS
    run(args.snapshot, args.frames, args.out, args.map, script, shots)


if __name__ == '__main__':
    main()
