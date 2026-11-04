#!/usr/bin/env python3
"""Zvuky z originálu → data/sounds.json.

    ./tools/dumpsound.py

★ **Celý zvuk Jetpacu jsou čtyři vstupy do jedné smyčky a jeden sweep.**
Žádná tabulka not, žádná obálka, žádná hudba (`sources/docs/disasm_notes.md`
§10). Smyčka `$680D` dělá obdélník: `D` je délka půlvlny v iteracích `DJNZ`,
`C` počet vln. Vstupy se liší jen tím, co do `D` a `C` dosadí — a **skáčou
doprostřed smyčky, na `DJNZ` v `$6812`**, takže první půlvlna má délku toho,
co zrovna zbylo v `B`, a reproduktor se rozhýbe až druhou půlkou.

Čísla jsou operandy instrukcí, čtené z obrazu paměti.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jetpaclib as J   # noqa: E402

# jméno → (adresa vstupu, adresa operandu D, adresa operandu C, k čemu to je)
ROUTINES = {
    'rocketFlame': (0x67ED, None, 0x67FA, 'plamen rakety – výška tónu je y rakety ($67ED)'),
    'built':       (0x67FD, 0x67FE, 0x6800, 'díl rakety nasazen / natankováno'),
    'pickUp':      (0x6803, 0x6804, 0x6806, 'zvednutí dílu nebo paliva'),
    'treasure':    (0x6809, 0x680A, 0x680C, 'poklad, odlet, konec odpočtu'),
}
SWEEP = {'addr': 0x681E, 'from': 0x681F, 'to': 0x6830,
         'note': 'laser – stoupající sweep, C od 8 do $38 ($681E)'}
SOUND_SLOT = {'short': 0x684B, 'long': 0x6854, 'table': 0x6847,
              'note': 'zvuk jako entita ve slotu $5D28 – typ 12 a 13 ($6834)'}
LOOP = {'addr': 0x680D, 'note': 'obdélník: D je půlvlna, C počet vln'}


def main():
    mem = J.memory_image()
    peek = lambda a: J.peek(mem, a, 1)[0]
    data = {
        'note': ('zvuky z originálu (tools/dumpsound.py): čtyři vstupy do jedné '
                 'smyčky a jeden sweep. Žádná hudba – ta v programu není.'),
        'machine': {'speakerOn': 0x10, 'speakerOff': 0x00},
        'loop': LOOP,
        'routines': {},
        'sweep': {'addr': SWEEP['addr'], 'from': peek(SWEEP['from']),
                  'to': peek(SWEEP['to']), 'note': SWEEP['note']},
        'soundSlot': {'types': list(J.peek(mem, SOUND_SLOT['table'], 4)),
                      'shortAddr': SOUND_SLOT['short'],
                      'longAddr': SOUND_SLOT['long'],
                      'note': SOUND_SLOT['note']},
    }
    for name, (addr, d_addr, c_addr, note) in ROUTINES.items():
        data['routines'][name] = {
            'addr': addr,
            'halfWave': peek(d_addr) if d_addr else None,
            'waves': peek(c_addr),
            'note': note,
        }
    out = os.path.join(HERE, '..', 'data', 'sounds.json')
    open(out, 'w').write(json.dumps(data, indent=1, ensure_ascii=False))
    print('%s: %d rutin + sweep + slot zvuku'
          % (os.path.relpath(out, os.path.join(HERE, '..')), len(data['routines'])))
    for name, item in sorted(data['routines'].items()):
        print('   %-12s půlvlna %s, vln %d' % (name,
              ('$%02X' % item['halfWave']) if item['halfWave'] else 'z y rakety',
              item['waves']))
    print('   %-12s C od $%02X do $%02X' % ('laser', data['sweep']['from'], data['sweep']['to']))


if __name__ == '__main__':
    main()
