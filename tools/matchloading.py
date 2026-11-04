#!/usr/bin/env python3
"""Ověří, že `data/loading.json` je **doopravdy to, co kazeta nahraje**.

    ./tools/matchloading.py

Porovnává tři věci bajt po bajtu:

1. blok SCREEN$ `JPSP` z kazety (`tools/jetpaclib.py`)
2. `sources/media/screens/loading_screen.scr` (co se z něj vytáhlo)
3. `data/loading.json` (co dostane prohlížeč) — base64 zpátky na bajty
4. a k tomu **paměť `$4000–$5AFF` simulátoru** po nahrání kazety, tedy to,
   co na obrazovce opravdu je

Akceptační kritérium M1: 6912 kontrol, nula rozdílů.
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'app', 'svision', 'sources', 'skoolkit'))
import jetpaclib as J   # noqa: E402


def main():
    root = os.path.join(HERE, '..')
    tape = J.loading_screen()
    scr = open(os.path.join(root, 'sources/media/screens/loading_screen.scr'), 'rb').read()
    data = json.load(open(os.path.join(root, 'data/loading.json')))
    js = base64.b64decode(data['videoRAM'])
    mem = J.memory_image()[:6912]

    sources = (('kazeta (blok SCREEN$)', tape), ('sources/.../loading_screen.scr', scr),
               ('data/loading.json', js), ('obraz paměti $4000-$5AFF', mem))
    diffs = 0
    for name, buf in sources[1:]:
        if len(buf) != 6912:
            print('%-34s ŠPATNÁ DÉLKA %d' % (name, len(buf)))
            diffs += 1
            continue
        d = sum(1 for a, b in zip(tape, buf) if a != b)
        print('%-34s %6d kontrol, %d rozdílů' % (name, 6912, d))
        diffs += d
    print('celkem %d kontrol, **%d rozdílů**' % (3 * 6912, diffs))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
