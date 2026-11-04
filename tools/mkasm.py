#!/usr/bin/env python3
"""Vyrobí disassembly Jetpacu → sources/asm/jetpac.asm.

    ./tools/mkasm.py [--map build/coverage.txt,build/coverage2.txt]

Kód se hledá dvěma cestami naráz: **rekurzivním sestupem** od vstupního bodu
`$61E5` (kazeta je nešifrovaná, takže to jde) a **mapou pokrytí** z běhu
v simulátoru (`tools/playtrace.py --map`), která doplní to, kam se skáče přes
tabulku. Co nezbude ani jednou cestou, je vypsané jako data.

Výstup se **commituje** (`../STANDARDS.md`): je to podklad, ne artefakt buildu.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asmlib                                            # noqa: E402
import jetpaclib as J                                    # noqa: E402

DEFAULT_MAPS = ('build/coverage.txt', 'build/coverage2.txt')


JUMPTABLE = (0x6374, 18)     # $6374: obsluhy entit, index = (IX+$00)*2 & $7E


def jumptable_seeds(mem):
    """Cíle tabulky obsluh entit ($6371: JP $5CB0, kde je JP (HL))."""
    addr, count = JUMPTABLE
    return [J.word(mem, addr + 2 * i) for i in range(count)]


def build(map_paths):
    covered = set()
    for p in map_paths:
        p = os.path.join(HERE, '..', p)
        if os.path.exists(p):
            covered |= asmlib.load_map(p)
    covered = {a for a in covered if 0x6000 <= a < 0x8000}
    mem = J.memory_image()
    seeds = [J.ENTRY] + jumptable_seeds(mem)
    code, _ = asmlib.walk(seeds=seeds, extra=sorted(covered))
    return code, covered


def targets(code):
    """Adresy, na které se někdo odkazuje – z nich budou návěští."""
    out = set()
    for ins in code.values():
        op = ins.operation
        head = op.split()[0]
        if head in ('JP', 'JR', 'CALL', 'DJNZ'):
            arg = op[len(head):].strip().split(',')[-1].strip()
            if arg.startswith('$'):
                out.add(int(arg[1:], 16))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--map', default=','.join(DEFAULT_MAPS))
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'sources/asm/jetpac.asm'))
    args = ap.parse_args()

    code, covered = build(args.map.split(','))
    mem = J.memory_image()
    labels = targets(code)
    lines = []
    lines.append('; Jetpac (Ultimate Play The Game, 1983, ZX Spectrum 16K)')
    lines.append('; Disassembly kódu a dat $6000-$7FFF **po přesunu** (tools/jetpaclib.py).')
    lines.append('; Vyrobil tools/mkasm.py: rekurzivní sestup od $%04X + mapa pokrytí z běhu.' % J.ENTRY)
    lines.append(';')
    addr = 0x6000
    ncode = nbytes_data = 0
    while addr < 0x8000:
        if addr in code:
            ins = code[addr]
            mark = ' ' if addr in covered else '.'      # '.' = jen staticky, neproběhlo
            lab = 'L%04X:' % addr if addr in labels else ''
            lines.append('%s $%04X %-8s %s%-20s ; %s' % (
                mark, addr, ' '.join('%02X' % b for b in ins.bytes),
                lab.ljust(7), ins.operation, ''))
            addr += len(ins.bytes)
            ncode += len(ins.bytes)
        else:
            start = addr
            while addr < 0x8000 and addr not in code:
                addr += 1
            data = J.peek(mem, start, addr - start)
            nbytes_data += len(data)
            lines.append('')
            lines.append('; --- data $%04X-$%04X (%d B) ---' % (start, addr - 1, len(data)))
            for off in range(0, len(data), 16):
                chunk = data[off:off + 16]
                txt = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
                lines.append('  $%04X %s | %s' % (start + off,
                                                  ' '.join('%02X' % b for b in chunk).ljust(47), txt))
            lines.append('')
    lines.append('; kód %d B, data %d B, celkem %d B' % (ncode, nbytes_data, ncode + nbytes_data))
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    open(args.out, 'w').write('\n'.join(lines) + '\n')
    print('%s: %d instrukcí, kód %d B, data %d B' % (args.out, len(code), ncode, nbytes_data))


if __name__ == '__main__':
    main()
