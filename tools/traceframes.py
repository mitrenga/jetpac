#!/usr/bin/env python3
"""Referenční snímky z běžícího originálu pro `tools/matchscreen.js`.

    ./tools/traceframes.py [--frames 1400] [--shots 260,400,700]

Pro každý vybraný snímek uloží dvě věci ze **stejného okamžiku**:

- `build/ref/frameNNNNN.scr` – celou videopaměť originálu (6912 B)
- `build/ref/frameNNNNN.json` – stav entit z `$5D00`–`$5D87` a hodnoty panelu

Tím je porovnání poctivé: remake dostane přesně ten stav, který originál
v tu chvíli měl, a musí z něj složit přesně tu obrazovku, kterou měl na sobě.
"""
import argparse, base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

import playtrace as P                                       # noqa: E402
from skoolkit.snapshot import Snapshot                      # noqa: E402
from skoolkit.simulator import Simulator                    # noqa: E402
from skoolkit.simutils import from_snapshot                 # noqa: E402
from skoolkit.trace import Tracer                           # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                         # pragma: no cover
    CSimulator = None

ENTITIES = 0x5D00        # 17 záznamů po 8 B
ENTITY_COUNT = 17
SCORE1, SCORE2, HISCORE = 0x5CF4, 0x5CF7, 0x5CF0
LIVES1, LIVES2, PLAYER = 0x5DF1, 0x5DF9, 0x5DD1
LEVEL = 0x5DF0
START_DELAY = 0x5DD7     # odpočet po startu kola a po smrti ($73B2)
SHIFTED = 0x5E00         # předsunuté kopie, které si hra před kolem udělala sama
SHIFTED_END = 0x5F98


def bcd(mem, addr):
    """Tři bajty BCD → číslo (originál drží skóre přesně takhle, `$70F9`)."""
    value = 0
    for i in range(3):
        b = mem[addr + i]
        value = value * 100 + (b >> 4) * 10 + (b & 0x0F)
    return value


def snapshot_state(mem):
    entities = []
    for slot in range(ENTITY_COUNT):
        base = ENTITIES + 8 * slot
        raw = mem[base:base + 8]
        entities.append({
            'slot': slot,
            'type': raw[0] & 0x3F,
            'left': bool(raw[0] & 0x40),
            'x': raw[1],
            'y': raw[2],
            'attr': raw[3],
            'flags': raw[4],
            'raw': list(raw),
        })
    return {
        'entities': entities,
        'level': mem[LEVEL],
        'startDelay': mem[START_DELAY],
        # ★ Kopie, které si originál předsunul do $5E00-$5F97, se berou s sebou:
        # `tools/matchscreen.js` se s nimi porovná, takže se kontroluje i to,
        # že naše předsouvání (`ScreenComposer.shift`) dělá totéž co `$6E9D`.
        'shifted': base64.b64encode(bytes(mem[SHIFTED:SHIFTED_END])).decode(),
        'panel': {
            'score': bcd(mem, SCORE1),
            'score2': bcd(mem, SCORE2),
            'hiScore': bcd(mem, HISCORE),
            'lives': mem[LIVES1],
            'lives2': mem[LIVES2],
            'player': 2 if mem[PLAYER] else 1,
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--frames', type=int, default=1400)
    ap.add_argument('--shots', default='260,400,700,1000,1300')
    ap.add_argument('--script', default='60:70:1,100:110:3,140:150:5,260:340:Q,300:420:Z,'
                                        '430:520:Q,520:700:X,700:900:Q,900:1300:X')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build/ref'))
    args = ap.parse_args()

    shots = {int(x) for x in args.shots.split(',')}
    script = P.parse_script(args.script)
    os.makedirs(args.out, exist_ok=True)

    snap = Snapshot.get(os.path.join(HERE, '..', 'build/jetpac.z80'))
    sim = from_snapshot(CSimulator or Simulator, snap, {}, {'ay': [None] * 16},
                        {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Tracer(sim, snap.border, snap.out7ffd, snap.outfffd, list(snap.ay),
                    snap.outfe, True)
    sim.set_tracer(tracer)
    saved = []

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = P.KEYS[key]
                keyboard[P.ROWS[row]] |= 1 << bit
        if frame in shots:
            name = os.path.join(args.out, 'frame%05d' % frame)
            open(name + '.scr', 'wb').write(bytes(scr))
            state = snapshot_state(sim.memory)
            open(name + '.json', 'w').write(json.dumps(state, indent=1))
            saved.append(name)
        return frame < args.frames

    tracer.run(snap.pc, -1, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
    for name in saved:
        print('uloženo', os.path.relpath(name, os.path.join(HERE, '..')))


if __name__ == '__main__':
    main()
