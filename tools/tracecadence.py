#!/usr/bin/env python3
"""Změří **kadenci dlouhého kola** ze záznamů a uloží ji → data/cadence.json.

    ./tools/tracecadence.py [--out data/cadence.json]

★ **Originál se zadrhne, když je na obrazovce nálož** — a není to dojem, je to
měřitelné. Hlavní smyčka na snímek nečeká (`disasm_notes.md` §3b), takže kolik
dlouhých kol se do snímku vejde, závisí na tom, kolik práce v něm je: každý
nepřítel stojí obsluhu a hlavně **smazání a nakreslení spritu**, a to všechno
v kontendované paměti.

Počítá se z `build/entities/*.json` (`tools/traceentities.py`, simulátor
**s kontencí**): každý záznam je jedno dlouhé kolo a nese `frames`, tedy
`FRAMES` v tu chvíli. Poměr „kol / uplynulých snímků" tříděný podle počtu
živých nepřátel je přesně ta tabulka, kterou remake potřebuje.

★ **Bez kontence vyjde kadence skoro o polovinu vyšší** (0,568 proti 0,466),
protože ULA bere Z80 přístup do dolních 16 KB — a Jetpac je celý tam. Než se
to změřilo, běžel remake o tolik rychleji; potvrdilo to až video skutečné hry
(`sources/media/video/README.md`).
"""
import argparse, collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TRACES = os.path.join(HERE, '..', 'build', 'entities')
FRAME_TSTATES = 69888           # T-stavů na snímek (hw_notes.md)
FRAME_MS = FRAME_TSTATES/3500.0 # 19,968 ms — jeden snímek
CREATURES = range(9, 17)        # sloty nepřátel ($5D48–$5D80)


def measure(traces):
    """{počet nepřátel: [dlouhých kol, uplynulých snímků]}"""
    bins = collections.defaultdict(lambda: [0, 0])
    for path in traces:
        trace = json.load(open(path))['trace']
        for index in range(len(trace) - 1):
            entities = trace[index]['entities']
            creatures = sum(1 for slot in CREATURES if entities[slot][0])
            frames = (trace[index + 1]['frames'] - trace[index]['frames']) & 0xFFFF
            if not 1 <= frames <= 8:        # přeskočené místo (smrt, nové kolo)
                continue
            bins[creatures][0] += 1
            bins[creatures][1] += frames
    return bins


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'cadence.json'))
    ap.add_argument('--min-samples', type=int, default=15)
    args = ap.parse_args()

    if not os.path.isdir(TRACES):
        print('chybí záznamy v build/entities — spusť tools/traceentities.py')
        return 2
    traces = [os.path.join(TRACES, name) for name in sorted(os.listdir(TRACES))
              if name.endswith('.json')]
    bins = measure(traces)

    rounds = sum(v[0] for v in bins.values())
    frames = sum(v[1] for v in bins.values())
    table, samples = {}, {}
    print('%9s %8s %10s %12s %9s' % ('nepřátel', 'kol', 'T/kolo', 'kol/snímek', 'ms/kolo'))
    for creatures in sorted(bins):
        count, elapsed = bins[creatures]
        if count < args.min_samples:
            continue
        rate = count / elapsed
        table[str(creatures)] = round(rate, 4)
        samples[str(creatures)] = count
        print('%9d %8d %10.0f %12.3f %9.1f'
              % (creatures, count, FRAME_TSTATES * elapsed / count, rate, FRAME_MS/rate))

    # ★ Tenhle soubor je **měření, ne nastavení**. Perioda, kterou remake
    # doopravdy jede, je `LONG_ROUND_TICKS` v `app/gameWorker.js` — **čtyři
    # tiky, 79,9 ms** (`ZADANI.md` §10/1: vědomé zpomalení světa proti
    # změřeným 54,7 ms). Klíč `longRoundTicks` tady je proto, aby se dala
    # zkusit jiná hodnota bez zásahu do kódu; když chybí, platí ty čtyři.
    #
    # ★ **A musí být sudý.** Hra se ptá počítadla `$5DCC` na zbytky (palivo
    # `& $0F`, poklad `& $7F`), počítadlo roste s oběma koly, takže mezi dvěma
    # dlouhými koly přibude `ticks+1`. Liché číslo je s mocninou dvojky
    # nesoudělné a padnou všechny fáze; při **třech** ticích přibývají čtyři,
    # tři čtvrtiny fází nepadnou nikdy a palivo přestane chodit úplně
    # (`ZADANI.md` §10).
    #
    # Rozpad podle počtu nepřátel (`byCreatures`) se **nepoužívá jako předpis**:
    # originál se při nálože zadrhne, ale remake má běžet plynule
    # (`ZADANI.md` §10).
    with_creatures = [v for k, v in bins.items() if k > 0]
    play_rounds = sum(v[0] for v in with_creatures)
    play_frames = sum(v[1] for v in with_creatures)
    data = {
        'note': ('kadence dlouhého kola změřená v simulátoru s kontencí '
                 '(tools/tracecadence.py); worker používá roundsPerFrame, '
                 'rozpad podle nepřátel je měření, ne předpis'),
        'frameTstates': FRAME_TSTATES,
        'average': round(rounds / frames, 4),
        'playAverage': round(play_rounds / play_frames, 4) if play_frames else None,
        'playLongRoundMs': (round(FRAME_MS * play_frames / play_rounds, 1)
                            if play_rounds else None),
        'byCreatures': table,
        'samples': samples,
        'rounds': rounds,
        'frames': frames,
    }
    open(args.out, 'w').write(json.dumps(data, indent=1, ensure_ascii=False) + '\n')
    print('\nprůměr %.3f kola na snímek (%d kol, %d snímků) → %s'
          % (data['average'], rounds, frames, os.path.relpath(args.out, os.path.join(HERE, '..'))))
    if data['playAverage']:
        print('se živými nepřáteli na obrazovce: %.3f kola na snímek = **%.1f ms** '
              'na kolo\n   (remake jede na 55 ms, app/gameWorker.js LONG_ROUND_MS)'
              % (data['playAverage'], data['playLongRoundMs']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
