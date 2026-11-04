#!/usr/bin/env python3
"""Záznam toho, **co Jetman dělá, když se pustí směrovka na plošině**
→ `build/walk.json`.

    ./tools/tracewalk.py [--steps 6]

Vzniklo z hlášení „stisknu doleva, pustím a Jetman jde dál, dokud nespadne".
Odpověď je `$7597` a je to **chování originálu**, ne ztracené uvolnění
klávesy: stojí-li Jetman na **kraji** plošiny a nedrží se nic, šourá se sám
tím směrem, kterým kouká.

    $7592 BIT 3,E      ; kraj? (|dx| + $12 >= šířka, $7637)
    $7594 JP Z,$74C7   ; ne -> hotovo, stojí
    $7597 LD A,(IX+$05); rychlost z drženého směru
    $759A JP NZ,$74C7  ; drží se směrovka -> hotovo
    $759E BIT 6,(IX+$00) ; kouká doleva?
    $75A4 DEC (IX+$01) ; ano -> o pixel doleva, **a rychlost se nenastaví**
    $75AA INC (IX+$01) ; ne  -> o pixel doprava

Šourá se tedy **každý snímek znovu**, dokud kraj nepřestane platit (vrátí se
na plošinu) nebo dokud pod ním plošina neskončí (spadne). Uprostřed plošiny
se neděje nic — a to je celé to „jde dokud nespadne": na malé plošině je
stabilní pás úzký a chůze doleva z něj vyjde dřív, než člověk klávesu pustí.

Měří se to tak, že se Jetmanovi **předepíše záznam** (`$5D00`–`$5D07`) na
každé souřadnici napříč každou plošinou, pro oba směry pohledu a s ničím
drženým, a nechá se proběhnout několik obsluh. `tools/matchwalk.js` pak
totéž pustí portem a porovná celý záznam bajt po bajtu.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, RETRO)
sys.path.insert(0, HERE)

import tracephysics as T                                    # noqa: E402

SNAPSHOT = os.path.join(HERE, '..', 'sources/tape',
                        'Jetpac_1983_Ultimate_Play_The_Game_16K.z80')
SPRITES = os.path.join(HERE, '..', 'data/sprites.json')
OUT = os.path.join(HERE, '..', 'build/walk.json')

# ★ Záznam, který se předepisuje: typ 2 (stojí na plošině) s bitem 7 (pozice
# bez trysky) a bitem 6 podle směru pohledu, `+3` barva, `+4` příznaky se
# stejným bitem 6, `+5` rychlost **nula** (klávesa je puštěná), `+7` výška.
HEIGHT = 36
ATTR = 0x47


def probe(original, x, y, face_left, steps):
    """Předepíše záznam a nechá proběhnout `steps` obsluh Jetmana."""
    record = [0xC2 if face_left else 0x82, x, y, ATTR,
              0x40 if face_left else 0x00, 0, 0, HEIGHT]
    memory = original.sim.memory
    memory[T.JETMAN:T.JETMAN + 8] = record
    memory[T.FRAC_X] = 0
    memory[T.FRAC_Y] = 0
    out = []
    for _ in range(steps):
        # ★ `accel` ($5DCA) a počítadlo snímků ($5DCC) jsou **vstupy** kroku,
        # ne jeho výsledek: `$73E3` z nich dělá „jen každý druhý snímek", a bez
        # nich se port po pádu z plošiny rozejde s originálem ve svislé
        # rychlosti. Čtou se těsně před krokem, tedy v hlavě smyčky entit —
        # přesně jako je bere `tools/matchphysics.js`.
        before = {'accel': memory[T.ACCEL],
                  'frames': memory[T.FRAMES16] | (memory[T.FRAMES16 + 1] << 8)}
        state = original.step()
        out.append({'accel': before['accel'], 'frames': before['frames'],
                    'record': list(state['record']), 'delay': state['delay'],
                    'fracX': state['fracX'], 'fracY': state['fracY']})
        # ★ Sonda končí krokem, ve kterém Jetman z plošiny sejde. Dál už to
        # není chůze, ale pád — a ten měří `tools/matchphysics.js`. Navíc by
        # se tu neměřil ani pořádně: předepsaný záznam stojí uprostřed
        # rozehrané hry, takže Jetmana ve vzduchu do pár snímků něco sebere
        # a originál pak stojí na místě, protože běží odpočet nového života.
        if state['record'][0] & 0x3F != 2:
            break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--steps', type=int, default=6)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    platforms = json.load(open(SPRITES))['platforms']
    original = T.Original(SNAPSHOT)
    original.boot()
    original.hold([])
    # ★ `boot()` se zastaví **uvnitř** obsluhy `$73B2`, takže první krok by byl
    # doběhnutím té staré. Jeden se zahodí a od té chvíle sedí předepsaný
    # záznam na obsluhu.
    original.step()

    probes = []
    for index, platform in enumerate(platforms):
        for x in range(platform['x'] - platform['width'] + 1,
                       platform['x'] + platform['width']):
            for face_left in (True, False):
                probes.append({'platform': index, 'x': x & 0xFF,
                               'y': platform['y'] - 1, 'faceLeft': face_left,
                               'steps': probe(original, x & 0xFF,
                                              platform['y'] - 1, face_left,
                                              args.steps)})

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump({'note': 'co dělá Jetman na plošině bez držené klávesy '
                       '(tools/tracewalk.py, $7571/$7597)',
               'height': HEIGHT, 'attr': ATTR, 'platforms': platforms,
               'probes': probes}, open(args.out, 'w'))
    print('%s: %d sond, %d kroků'
          % (args.out, len(probes), sum(len(p['steps']) for p in probes)))


if __name__ == '__main__':
    main()
