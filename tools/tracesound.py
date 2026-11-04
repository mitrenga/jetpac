#!/usr/bin/env python3
"""Záznam zvuku z běžícího originálu → build/sounds/*.json.

    ./tools/tracesound.py

★ Zvukové rutiny Jetpacu jsou samostatné podprogramy, takže se nemusí čekat,
až situace ve hře nastane — **zavolají se přímo**. Do volné paměti se položí
`CALL rutina` a `RET`, nastaví se registry, které rutina čte (`B`, a u plamene
rakety `IX`), a simulátor se nechá doběhnout. Co u toho rutina zapsala do
reproduktoru, vyčte `Tracer.audio_log`, který si stavy bitu 4 portu `$FE`
zapisuje i s časem v T-stavech.

Z toho jsou **délky pulzů** — a přesně ty porovnává `tools/matchsound.js`
s tím, co spočítá `app/beeper.js`.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

from tracephysics import Original                            # noqa: E402
from skoolkit.simutils import PC, T, IXh, IXl, B, C, D       # noqa: E402

SCRATCH = 0x5B00         # tiskový buffer, po startu hry volný
# jméno → (adresa rutiny, B na vstupu, záznam pro IX, parametr pro beeper)
#
# ★ Dvě z nich nejsou rutiny „na zavolání", ale **obsluhy zvukového slotu**
# (`$5D28`, typy 12 a 13): čtou svůj záznam přes `IX`, ubírají mu počítadlo
# a **jedno kolo = jeden šleh**. Volají se tedy stejně, jen se jim podstrčí
# záznam, jaký jim dosadí `$6834` — `0C 04` a `0D 04`. Po `DEC (IX+$01)` je
# počítadlo 3, takže výbuch jede s `C = $10` ($6850) a smrt s
# `C = 3 + $18 = $1B` ($6859).
CALLS = {
    'built':       (0x67FD, 0x10, None, {}),
    'pickUp':      (0x6803, 0x10, None, {}),
    'treasure':    (0x6809, 0x10, None, {}),
    'rocketFlame': (0x67ED, 0x10, [0x00, 0x00, 0xB7], {'rocketY': 0xB7}),
    'laser':       (0x681E, 0x10, None, {}),
    'explosion':   (0x684B, 0x10, [0x0C, 0x04], {'c': 0x10}),
    'death':       (0x6854, 0x10, [0x0D, 0x04], {'c': 0x1B}),
}


def run_routine(original, addr, b_value, record):
    """Položí do paměti `CALL addr / RET`, zavolá to a vrátí zápisy do reproduktoru."""
    sim = original.sim
    memory = sim.memory
    memory[SCRATCH] = 0xCD                       # CALL nn
    memory[SCRATCH + 1] = addr & 0xFF
    memory[SCRATCH + 2] = addr >> 8
    memory[SCRATCH + 3] = 0x76                   # HALT jako zarážka
    registers = sim.registers
    registers[B] = b_value
    if record is not None:
        # rutina si čte svůj záznam přes IX ($67ED bere y z (IX+$02), obsluhy
        # slotu typ z (IX+$00) a počítadlo z (IX+$01)) — položí se do volné
        # paměti a IX se nastaví na něj
        for offset, byte in enumerate(record):
            memory[SCRATCH + 0x10 + offset] = byte
        registers[IXh] = (SCRATCH + 0x10) >> 8
        registers[IXl] = (SCRATCH + 0x10) & 0xFF
    tracer = original.tracer
    tracer.audio_log.clear()
    # ★ v jakém stavu je reproduktor, **než** rutina začne: první zápis je
    # hrana jen tehdy, když ho přehodí. Originál po sobě stav nechává, takže
    # to závisí na tom, co se hrálo předtím.
    speaker = tracer.spkr
    start = registers[T]
    original.pc = SCRATCH
    original._run(SCRATCH + 3)
    # audio_log má dvojice (T-stav, ...) pro každou změnu bitu 4 portu $FE
    return ([entry[0] - start for entry in tracer.audio_log],
            registers[T] - start, speaker)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'build/sounds'))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    original = Original(os.path.join(HERE, '..', 'build/jetpac.z80'))
    original.boot()
    original.hold([])

    total = 0
    for name, (addr, b_value, record, params) in sorted(CALLS.items()):
        times, length, speaker = run_routine(original, addr, b_value, record)
        pulses = [times[i+1] - times[i] for i in range(len(times) - 1)]
        data = {'sound': name, 'addr': addr, 'b': b_value,
                'rocketY': params.get('rocketY'), 'c': params.get('c'),
                'speaker': speaker, 'tstates': length, 'edges': times,
                'pulses': pulses}
        open(os.path.join(args.out, name + '.json'), 'w').write(json.dumps(data))
        print('%-12s $%04X   %4d pulzů, %6d T-stavů (%.3f s)'
              % (name, addr, len(pulses), length, length/3500000))
        total += len(pulses)
    print('celkem %d pulzů v %d zvucích → %s'
          % (total, len(CALLS), os.path.relpath(args.out, os.path.join(HERE, '..'))))


if __name__ == '__main__':
    main()
