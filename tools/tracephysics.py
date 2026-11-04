#!/usr/bin/env python3
"""Záznam Jetmanova letu z běžícího originálu → build/physics/*.json.

    ./tools/tracephysics.py [--scenario jmeno] [--steps N]

Krokuje se **po obsluhách Jetmana**, ne po snímcích: simulátor se zastavuje
na `$6351` (hlava smyčky entit) a čeká, až bude `IX = $5D00`, tedy těsně
před tím, než hra sáhne na Jetmana. Ze dvou po sobě jdoucích zastavení je
jeden krok fyziky, a to je přesně to, co porovnává `tools/matchphysics.js`.

★ **Jetman se hýbe jednou za snímek, ne jednou za průchod.** Hlavní smyčka
originálu obchází entity od `$5D30` výš pořád dokola, ale sloty `$5D00`–`$5D28`
(Jetman, čtyři střely a zvuk) projde jen tehdy, když se změnil `FRAMES`:
`$6351` to porovná s `$5DD4` a `$6965` na to přepíše mez smyčky sebemodifikací
(`$69B5`) a vrátí se přes `$699D`. Jeden krok Jetmana je tedy 1/50,08 s —
a to je jediný důvod, proč pevných 50 Hz remaku sedí zrovna jemu
(`ZADANI.md` §10).

Zaznamenává se pro každý krok:

- osm bajtů záznamu Jetmana (`$5D00`–`$5D07`)
- **zlomky souřadnic** `$5DC7` (x) a `$5DC8` (y) — bez nich by se krok nedal
  zopakovat, protože rychlost je v šestnáctinách pixelu
- stav ovládání, jak ho v tu chvíli drží skript
- odpočet startu `$5DD7` a počítadlo snímků `$5DCC`, protože obsluha se na
  obojí ptá
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

import playtrace as P                                       # noqa: E402
from skoolkit.snapshot import Snapshot                      # noqa: E402
from skoolkit.simulator import Simulator                    # noqa: E402
from skoolkit.simutils import from_snapshot, PC, IXh, IXl   # noqa: E402
from skoolkit.trace import Tracer                           # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                         # pragma: no cover
    CSimulator = None
try:
    from skoolkit.cmiosimulator import CMIOSimulator
except ImportError:                                             # pragma: no cover
    CMIOSimulator = None
try:
    from skoolkit import CCMIOSimulator
except ImportError:                                             # pragma: no cover
    CCMIOSimulator = None

JETMAN = 0x5D00          # slot Jetmana
LOOP = 0x6351            # hlava smyčky entit (IX = právě obsluhovaná entita)
FRAC_X, FRAC_Y = 0x5DC7, 0x5DC8
DELAY, FRAMES16, ACCEL = 0x5DD7, 0x5DCC, 0x5DCA

# klávesy, kterými se ovládání posílá do simulátoru (§4 disasm_notes.md):
# horní řada = tryska, prostřední = laser, spodní půlky = vlevo/vpravo
CONTROL_KEYS = {'left': 'Z', 'right': 'X', 'thrust': 'Q', 'fire': 'A',
                # ★ „brzda": $7435 čte **celou číselnou řadu** a když je na ní
                # cokoli stisknuté, vynuluje svislou rychlost. V žádných
                # instrukcích to není, je to jen v kódu.
                'brake': '6'}

# (jméno, [(od kroku, do kroku, [ovládání])]) — kroky se počítají od začátku
# scénáře, tedy až po odpočtu startu
SCENARIOS = {
    # vodorovné zrychlení a strop rychlosti: $73F8 přičítá 4, strop $40
    'right': [(0, 120, ['right'])],
    'left': [(0, 120, ['left'])],
    # zrychlit doprava a pak doleva – to je ta větev, kde se rychlost nuluje
    # a otáčí se bit 6 příznaků ($7541)
    'right-then-left': [(0, 60, ['right']), (60, 160, ['left'])],
    # pustit řízení: $7562 ubírá 4, ale **jen každý druhý snímek** ($73E3)
    'right-then-nothing': [(0, 60, ['right']), (60, 200, [])],
    # tryska a volný pád: $745A přičítá 4 se stropem $3F, $7515 ubírá a při
    # nule otočí směr
    'thrust': [(0, 100, ['thrust'])],
    'thrust-then-fall': [(0, 80, ['thrust']), (80, 260, [])],
    # letět šikmo a narazit do stropu hrací plochy ($74A4: CP $2A)
    'thrust-right': [(0, 200, ['thrust', 'right'])],
    # doletět k plošině shora a postavit se na ni ($74DC: typ na 2)
    'land-on-platform': [(0, 70, ['thrust', 'left']), (70, 240, ['left'])],
    # chůze po zemi: $75E2 a $75F4 hýbou o pixel za snímek
    'walk': [(0, 40, []), (40, 140, ['right']), (140, 240, ['left'])],
    # laser za letu – fyziky se netýká, ale prochází se jím tatáž obsluha
    'thrust-fire': [(0, 120, ['thrust', 'fire'])],
    # projet levým okrajem obrazovky: x je jeden bajt, takže přeteče
    'left-edge': [(0, 300, ['left', 'thrust'])],
}


class Original:
    """Originál v simulátoru, krokovaný po obsluhách Jetmana.

    ★ **Simuluje se s kontencí** (`CMIOSimulator`), tedy s tím, že ULA bere
    Z80 přístup do dolních 16 KB, kdykoli kreslí obraz. Pro Jetpac to není
    detail: **celá hra leží v kontendované paměti** (`$6000`–`$7FFF`) a kreslí
    do obrazovky, takže dlouhé kolo je s kontencí o **35 % pomalejší** než bez
    ní (140 643 proti 103 774 T-stavům ve stejné scéně). Bez kontence vyjde
    kadence světa o půlku vyšší, než jakou má skutečný stroj — a přesně to se
    stalo, než se to změřilo z videa (`ZADANI.md` §10 odchylka 1).
    """

    def __init__(self, snapshot_path, contention=True):
        snapshot = Snapshot.get(snapshot_path)
        if snapshot is None:
            raise SystemExit('nelze načíst snapshot %s' % snapshot_path)
        cls = (CCMIOSimulator or CMIOSimulator) if contention else (CSimulator or Simulator)
        self.sim = from_snapshot(cls, snapshot, {},
                                 {'ay': [None] * 16},
                                 {'fast_djnz': False, 'fast_ldir': False}, None)
        self.tracer = Tracer(self.sim, snapshot.border, snapshot.out7ffd,
                             snapshot.outfffd, list(snapshot.ay), snapshot.outfe, True)
        self.sim.set_tracer(self.tracer)
        self.pc = snapshot.pc
        self.held = []

    def _run(self, stop, draw=None):
        # Pozor: když se `draw` předá, Tracer si klávesnici na začátku běhu
        # vynuluje — proto se při krokování nepředává a drží se ručně.
        self.tracer.run(self.pc, stop, 0, 0, True, draw, None, None, None,
                        '$', '04X', '04X')
        self.pc = self.sim.registers[PC]

    def boot(self):
        """Projde menu originálu (1 hráč, klávesnice, start) a zastaví se
        u Jetmana."""
        script = P.parse_script('60:70:1,100:110:3,140:150:5')

        def draw(scr, frame, border, keyboard):
            for i in range(8):
                keyboard[i] = 0
            for start, end, key in script:
                if start <= frame < end:
                    row, bit = P.KEYS[key]
                    keyboard[P.ROWS[row]] |= 1 << bit
            return True

        self._run(0x73B2, draw)
        self.tracer.keyboard = [0] * 8

    def hold(self, controls):
        """Co se drží – celý stav, ne změna."""
        self.held = list(controls)
        keyboard = self.tracer.keyboard
        keyboard[:] = [0] * 8
        for action in self.held:
            row, bit = P.KEYS[CONTROL_KEYS[action]]
            keyboard[P.ROWS[row]] |= 1 << bit

    def step(self):
        """Doběhne k další obsluze Jetmana a vrátí jeho stav."""
        while True:
            self._run(LOOP)
            ix = self.sim.registers[IXh] * 256 + self.sim.registers[IXl]
            if ix == JETMAN:
                return self.state()

    def state(self):
        mem = self.sim.memory
        return {
            'record': list(mem[JETMAN:JETMAN + 8]),
            'fracX': mem[FRAC_X],
            'fracY': mem[FRAC_Y],
            'delay': mem[DELAY],
            'frames': mem[FRAMES16] | (mem[FRAMES16 + 1] << 8),
            'accel': mem[ACCEL],
            'controls': {action: action in self.held for action in CONTROL_KEYS},
        }


def fuzz_scenarios(count, steps, seed=20260917):
    """Náhodné scénáře ovládání — proti tomu, aby se ověřovalo jen to, na co
    se při psaní myslelo.

    Losuje se seedovaně, takže sada je pokaždé tatáž a nález se dá zopakovat
    (`METHODOLOGY.md`: co se nedá zopakovat, není doklad). Držené kombinace
    jsou úplné, včetně `left`+`right` naráz a klávesy `brake` (číselná řada,
    `$7435`), na kterou by se jinak nepřišlo.
    """
    import random
    rng = random.Random(seed)
    options = [[], ['left'], ['right'], ['thrust'], ['fire'],
               ['thrust', 'left'], ['thrust', 'right'], ['left', 'right'],
               ['thrust', 'fire'], ['brake'], ['thrust', 'brake'],
               ['left', 'fire'], ['right', 'thrust', 'fire']]
    out = {}
    for index in range(count):
        script, at = [], 0
        while at < steps:
            length = rng.randint(3, 25)
            script.append((at, min(at + length, steps), rng.choice(options)))
            at += length
        out['fuzz%02d' % index] = script
    return out


def run_scenario(original, name, script, steps):
    """Přehraje jeden scénář a vrátí záznam krok po kroku.

    ★ Scénář se **ukončí ve chvíli, kdy do Jetmana sáhne něco jiného než
    fyzika** — pozná se to podle toho, že se znovu rozběhl odpočet `$5DD7`
    (tedy začal nový život) nebo že typ přestal být 1 či 2. Kolize
    s nepřítelem je M5; do záznamu fyziky nepatří, protože porovnání by pak
    měřilo něco jiného, než co se ověřuje.
    """
    trace, stopped = [], None
    for step in range(steps):
        held = []
        for start, end, controls in script:
            if start <= step < end:
                held = controls
        original.hold(held)
        state = original.step()
        state['step'] = step
        if state['delay'] or (state['record'][0] & 0x3F) not in (1, 2):
            stopped = 'do Jetmana sáhlo něco mimo fyziku (smrt nebo nový život)'
            break
        trace.append(state)
    return {'scenario': name, 'script': script, 'steps': len(trace),
            'requested': steps, 'stopped': stopped, 'trace': trace}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenario', help='jen jeden scénář (jinak všechny)')
    ap.add_argument('--steps', type=int, default=0, help='kolik kroků (0 = podle scénáře)')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build/physics'))
    ap.add_argument('--fuzz', type=int, default=0, help='kolik náhodných scénářů přidat')
    ap.add_argument('--fuzz-steps', type=int, default=80)
    args = ap.parse_args()

    scenarios = dict(SCENARIOS)
    if args.fuzz:
        scenarios.update(fuzz_scenarios(args.fuzz, args.fuzz_steps))
    names = [args.scenario] if args.scenario else sorted(scenarios)
    os.makedirs(args.out, exist_ok=True)
    total = 0
    for name in names:
        script = scenarios[name]
        steps = args.steps or max(end for _, end, _ in script)
        original = Original(os.path.join(HERE, '..', 'build/jetpac.z80'))
        original.boot()
        # odpočet startu ($80 průchodů) – teprve po něm se Jetman hýbe
        original.hold([])
        while original.step()['delay']:
            pass
        data = run_scenario(original, name, script, steps)
        path = os.path.join(args.out, name + '.json')
        open(path, 'w').write(json.dumps(data, indent=1))
        first, last = data['trace'][0], data['trace'][-1]
        print('%-20s %3d kroků   x %3d->%3d  y %3d->%3d  typ %02X->%02X%s'
              % (name, data['steps'], first['record'][1], last['record'][1],
                 first['record'][2], last['record'][2],
                 first['record'][0], last['record'][0],
                 '   (' + data['stopped'] + ')' if data['stopped'] else ''))
        total += data['steps']
    print('celkem %d kroků v %d scénářích → %s'
          % (total, len(names), os.path.relpath(args.out, os.path.join(HERE, '..'))))


if __name__ == '__main__':
    main()
