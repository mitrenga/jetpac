#!/usr/bin/env python3
"""Výchozí stav hry z originálu → data/global.json.

    ./tools/mkglobal.py

Nic se tu nevymýšlí: všechno jsou bajty, které si hra sama kopíruje do
proměnných, když začíná kolo (`$60CD`, `$619A`, `$630F`).
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jetpaclib as J   # noqa: E402

TEMPLATES = {
    # $619A: Jetman – osm bajtů do $5D00 na začátku každého života
    'jetman': 0x6010,
    # $60CD: 24 B do $5D30 – raketa a dva díly, které na ni čekají
    'levelEntities': 0x6018,
    # $6630 / $65DF: co se dosazuje, když se má objevit poklad a palivo
    'treasure': 0x6030,
    'fuel': 0x6038,
    # $6A19: nepřítel, kterého hra klade do volného slotu
    'enemy': 0x6DCB,
}


def main():
    mem = J.memory_image()
    data = {
        'note': ('výchozí stav z originálu (tools/mkglobal.py): záznamy entit, '
                 'které si hra kopíruje do $5D00 a $5D30, a konstanty, které '
                 'si nastaví při startu hry'),
        # $6316: LD A,$04 / LD ($5DF1),A – čtyři životy, přesně to, co ukazuje panel
        'lives': 4,
        # $61FC: LD A,$04 / LD ($5DCA),A – z tohohle čísla je zrychlení
        # (8 - $5DCA = +4 za průchod) i zpomalení ($5DCA - 8 = -4)
        'acceleration': J.peek(mem, 0x61FD, 1)[0],
        # $6324: pět životů druhého hráče ve hře dvou hráčů ($5DF9)
        'lives2': J.peek(mem, 0x6325, 1)[0],
        'hiScore': 0,
        'templates': {name: list(J.peek(mem, addr, 24 if name == 'levelEntities' else 8))
                      for name, addr in TEMPLATES.items()},
        'templateAddresses': {name: addr for name, addr in TEMPLATES.items()},
        # $6A64: typ nepřítele podle kola, $6945: jeho předlohy
        'enemyByLevel': list(J.peek(mem, 0x6A64, 8)),
        # $6620: šestnáct míst, kde se zhmotňují předměty ($6612 do nich sahá
        # spodním půlbajtem stavu náhody)
        'spawnPlaces': list(J.peek(mem, 0x6620, 16)),
    }
    out = os.path.join(HERE, '..', 'data', 'global.json')
    open(out, 'w').write(json.dumps(data, indent=1, ensure_ascii=False))
    print('%s: %d šablon, %d životů, zrychlení %d'
          % (out, len(data['templates']), data['lives'], 8 - data['acceleration']))


if __name__ == '__main__':
    main()
