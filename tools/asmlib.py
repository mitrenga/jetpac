#!/usr/bin/env python3
"""Rozebrání kódu Jetpacu: rekurzivní průchod od vstupního bodu + mapa pokrytí.

Kód je čistý (žádné šifrování), takže rekurzivní sestup od `$61E5` najde skoro
všechno. Mapa z běhu (`tools/playtrace.py --map`) k tomu přidá to, co se volá
přes tabulky skoků, a naopak potvrdí, co je opravdu kód.
"""
import os, sys
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
RETRO = os.path.join(HERE, '..', 'app', 'svision', 'tools', 'retro')
sys.path.insert(0, os.path.join(RETRO, '..', '..', 'sources', 'skoolkit'))
sys.path.insert(0, HERE)

from skoolkit.disassembler import Disassembler   # noqa: E402
import jetpaclib as J                            # noqa: E402

class Ins:
    """Instrukce: adresa, text a bajty."""
    def __init__(self, address, operation, data):
        self.address, self.operation, self.bytes = address, operation, list(data)

    def __repr__(self):
        return '$%04X %-16s %s' % (self.address, self.operation,
                                   ' '.join('%02X' % b for b in self.bytes))


CFG = SimpleNamespace(defb_size=8, defm_size=66, defw_size=1, asm_hex=True,
                      asm_lower=False, wrap=False, opcodes='', handle_rst=False,
                      imaker=Ins)

STOP = ('RET', 'RETI', 'RETN')


def make(mem=None):
    if mem is None:
        mem = J.memory_image()
    snapshot = [0] * 0x4000 + list(mem)
    return Disassembler(snapshot, CFG), snapshot


def decode(dis, addr):
    """Jedna instrukce na adrese."""
    return dis.disassemble(addr, addr + 1, 'h')[0]


def walk(seeds=(J.ENTRY,), extra=(), limit=(0x6000, 0x8000)):
    """Rekurzivní sestup. Vrátí (instrukce podle adresy, množina adres kódu)."""
    dis, _ = make()
    lo, hi = limit
    code, todo = {}, list(seeds) + list(extra)
    seen = set()
    while todo:
        addr = todo.pop()
        while True:
            if addr in seen or not (lo <= addr < hi):
                break
            ins = decode(dis, addr)
            seen.add(addr)
            code[addr] = ins
            op = ins.operation
            head = op.split()[0]
            target = None
            rest = op[len(head):].strip()
            if head in ('JP', 'JR', 'CALL', 'DJNZ'):
                arg = rest.split(',')[-1].strip()
                if arg.startswith('$'):
                    target = int(arg[1:], 16)
                elif arg.startswith('('):
                    target = None          # JP (HL) / JP (IX)
            if target is not None and lo <= target < hi:
                todo.append(target)
            # konec lineárního toku?
            if head in STOP and not rest:
                break
            if head == 'JP' and ',' not in rest:
                break
            if head == 'JR' and ',' not in rest:
                break
            if head == 'JP' and rest.startswith('('):
                break
            addr += len(ins.bytes)
    return code, seen


def load_map(path):
    out = set()
    for line in open(path):
        line = line.strip().lstrip('$')
        if line:
            out.add(int(line, 16))
    return out
