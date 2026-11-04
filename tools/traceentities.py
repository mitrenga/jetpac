#!/usr/bin/env python3
"""Záznam celé tabulky entit z běžícího originálu → build/entities/*.json.

    ./tools/traceentities.py [--scenario jmeno] [--passes N]

Krokuje se **po průchodech** hlavní smyčky: simulátor se zastaví na `$6351`
s `IX = $5D30`, tedy na začátku vnějšího kola, které obchází raketu, předměty
a nepřátele. Mezi dvěma zastaveními je přesně jeden průchod světa — a když
se mezi nimi změnil `FRAMES`, proběhlo i to kratší kolo přes Jetmana, jeho
střely a zvuk (`$6965`).

Zaznamenává se všechno, na co se obsluhy ptají:

- **všech sedmnáct záznamů entit** (`$5D00`–`$5D87`)
- zlomky Jetmanových souřadnic (`$5DC7`, `$5DC8`)
- **stav generátoru náhody** `$5DCE` — ★ ten se v remaku zopakovat nedá,
  protože originál do něj míchá obnovovací registr a bajt z ROM Spectra
  (`$69C7`: `H=0`, takže `(HL)` čte adresu 0–255). `tools/matchentities.js`
  ho proto sype zpátky „průchod po průchodu", stejně jako to dělá sabrewulf
- počítadlo průchodů `$5DCC`, `FRAMES`, kolo `$5DF0`, životy a skóre
- stav ovládání, který v tu chvíli držel skript
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

import playtrace as P                                       # noqa: E402
from tracephysics import Original, CONTROL_KEYS             # noqa: E402
from skoolkit.simutils import IXh, IXl                      # noqa: E402

ENTITIES, SLOTS = 0x5D00, 17
# sloty krátkého kola: Jetman, čtyři střely, zvuk
SHORT_SLOTS = 6
LOOP, OUTER_IX = 0x6351, 0x5D30
FRAC_X, FRAC_Y = 0x5DC7, 0x5DC8
RANDOM, PASSES, FRAMES = 0x5DCE, 0x5DCC, 0x5C78
LEVEL, DELAY = 0x5DF0, 0x5DD7
LIVES1, LIVES2, PLAYER = 0x5DF1, 0x5DF9, 0x5DD1
SCORE1, SCORE2, HISCORE = 0x5CF4, 0x5CF7, 0x5CF0

SCENARIOS = {
    # stát a dívat se, co svět dělá sám od sebe: nepřátelé, poklady, palivo
    'idle': [(0, 400, [])],
    # sbírat: doletět k dílu rakety a odnést ho
    'fetch': [(0, 60, ['thrust', 'left']), (60, 200, ['left']),
              (200, 400, ['right']), (400, 600, ['thrust', 'right'])],
    # střílet: laser proti nepřátelům
    'shoot': [(0, 40, ['fire']), (40, 120, ['thrust', 'fire']),
              (120, 400, ['right', 'fire'])],
    # létat sem a tam a mlátit se o plošiny
    'fly': [(0, 80, ['thrust']), (80, 160, ['thrust', 'right']),
            (160, 240, ['left']), (240, 400, ['thrust', 'left'])],
}


def state(sim, held):
    mem = sim.memory
    entities = [list(mem[ENTITIES + 8*slot:ENTITIES + 8*slot + 8]) for slot in range(SLOTS)]
    return {
        'entities': entities,
        'fracX': mem[FRAC_X], 'fracY': mem[FRAC_Y],
        'random': mem[RANDOM],
        'pass': mem[PASSES] | (mem[PASSES + 1] << 8),
        'frames': mem[FRAMES] | (mem[FRAMES + 1] << 8),
        'level': mem[LEVEL], 'delay': mem[DELAY],
        'lives': [mem[LIVES1], mem[LIVES2]],
        # skóre je **BCD po třech bajtech** ($7107 sčítá s DAA): hráč, druhý
        # hráč a nejvyšší ($5CF4, $5CF7, $5CF0)
        'scores': [list(mem[SCORE1:SCORE1 + 3]), list(mem[SCORE2:SCORE2 + 3]),
                   list(mem[HISCORE:HISCORE + 3])],
        'player': 2 if mem[PLAYER] else 1,
        'controls': {action: action in held for action in CONTROL_KEYS},
    }


def step_pass(original, seen):
    """Doběhne na začátek dalšího průchodu vnějšího kola.

    ★ Cestou si všímá, **u kterého slotu proběhlo krátké kolo**: `$6351` se
    ptá na `FRAMES` před každou entitou, takže krátké kolo (Jetman, střely,
    zvuk) se vklíní přesně tam, kde se snímek zrovna překlopil. Bez téhle
    informace nejde zopakovat stav generátoru náhody, který se hýbe **po každé
    entitě** (`$69AB`), a rozejdou se barvy výbuchů.
    """
    rounds_at = []
    last_frames = seen['frames']
    # krátké kolo, které se vklínilo přesně na hranici průchodu, poběží až
    # v tomhle a jeho stav se čte až u první zastávky (viz níž)
    pending = seen.pop('pending', None)
    inside = seen.pop('inside', False)
    while True:
        original._run(LOOP)
        mem = original.sim.memory
        ix = original.sim.registers[IXh]*256 + original.sim.registers[IXl]
        frames = mem[FRAMES] | (mem[FRAMES + 1] << 8)
        if pending is not None:
            # ★ stav krátkého kola, **až když doběhne**. `$6965` neskáče nikam
            # stranou: přestaví konec tabulky a skočí zase na `$6351`, takže
            # krátké kolo se pozná podle toho, že `IX` spadne do slotů 0–5 —
            # a je hotové, když je zase nahoře. Bez těchhle mezistavů nejde
            # zopakovat kreslení, když se do jednoho dlouhého kola vejdou dvě
            # krátká: Jetman se mezi nimi pohne a jeho obrázek se dvakrát
            # smaže a dvakrát nakreslí (`tools/matchtrail.js`).
            if (ix - ENTITIES) // 8 < SHORT_SLOTS:
                # ★ bere se to při **každé** zastávce krátkého kola a platí
                # ta poslední (slot 5): po ní už běží obsluhy dlouhého kola
                # a ty do Jetmanova záznamu sahají — sráží ho ($648D). Kdyby
                # se stav četl až za krátkým kolem, vypadalo by to, že Jetman
                # zemřel dřív, než ho jeho vlastní obsluha stihla nakreslit.
                inside = True
                pending['entities'] = [list(mem[ENTITIES + 8*slot:ENTITIES + 8*slot + 8])
                                       for slot in range(SHORT_SLOTS)]
            elif inside:
                pending, inside = None, False
        if frames != last_frames:
            # slot, u kterého se krátké kolo vklínilo, a hodnota FRAMES, se
            # kterou poběží — ta se nedá odvodit, protože přerušení může
            # přeskočit i dva snímky naráz
            pending = {'slot': (ix - ENTITIES) // 8, 'frame': frames}
            rounds_at.append(pending)
            last_frames = frames
        if ix == OUTER_IX:
            seen['frames'] = frames
            seen['pending'] = pending
            seen['inside'] = inside
            return rounds_at


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenario')
    ap.add_argument('--passes', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build/entities'))
    ap.add_argument('--screens', action='store_true',
                    help='uložit i videopaměť ke každému průchodu (build/screens/)')
    args = ap.parse_args()

    names = [args.scenario] if args.scenario else sorted(SCENARIOS)
    os.makedirs(args.out, exist_ok=True)
    total = 0
    for name in names:
        script = SCENARIOS[name]
        passes = args.passes or max(end for _, end, _ in script)
        original = Original(os.path.join(HERE, '..', 'build/jetpac.z80'))
        original.boot()
        original.hold([])
        # počkat, až doběhne odpočet startu života
        while original.step()['delay']:
            pass
        trace = []
        screens = None
        if args.screens:
            # ★ videopaměť ke **každému** průchodu, ne jen k vybraným snímkům:
            # bez souvislé řady se nedá ověřit přírůstkové kreslení, protože
            # barevná stopa na obrazovce je výsledek celé historie
            screens = os.path.join(HERE, '..', 'build/screens', name)
            os.makedirs(screens, exist_ok=True)
        seen = {'frames': original.sim.memory[FRAMES] | (original.sim.memory[FRAMES+1] << 8)}
        for index in range(passes):
            held = []
            for start, end, controls in script:
                if start <= index < end:
                    held = controls
            original.hold(held)
            rounds_at = step_pass(original, seen)
            item = state(original.sim, held)
            item['index'] = index
            item['roundsAt'] = rounds_at
            trace.append(item)
            if screens:
                open(os.path.join(screens, '%05d.scr' % index), 'wb').write(
                    bytes(original.sim.memory[0x4000:0x5B00]))
        data = {'scenario': name, 'script': script, 'passes': len(trace), 'trace': trace}
        open(os.path.join(args.out, name + '.json'), 'w').write(json.dumps(data))
        alive = sum(1 for record in trace[-1]['entities'] if record[0])
        print('%-10s %4d průchodů   kolo %d, %d živých entit na konci'
              % (name, len(trace), trace[-1]['level'], alive))
        total += len(trace)
    print('celkem %d průchodů v %d scénářích → %s'
          % (total, len(names), os.path.relpath(args.out, os.path.join(HERE, '..'))))


if __name__ == '__main__':
    main()
