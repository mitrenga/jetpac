#!/usr/bin/env python3
"""Společné čtení kazety a obrazu paměti Jetpacu.

Jedno místo, kde je napsané, co je na kazetě, jak se z ní skládá obraz paměti
a kde v něm co leží. Nástroje `dump*`, `trace*` a `match*` to berou odsud,
aby se ta znalost nemusela opakovat (a rozcházet).

Kazeta je **standardní ROM rychlost, bez šifrování** – na rozdíl od Sabre
Wulfa, kde byl Speedlock a `CPL` od `$6000`. Viz `sources/docs/tape_layout.md`.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAPE = os.path.join(ROOT, 'sources', 'tape', 'Jetpac (1983)(Ultimate).tap')
SKOOLKIT = os.path.join(ROOT, 'app', 'svision', 'sources', 'skoolkit')

# --- kazeta -----------------------------------------------------------------

TYPES = {0: 'Program', 1: 'Number array', 2: 'Character array', 3: 'Bytes'}


def tap_blocks(path=TAPE):
    """TAP → seznam bloků: (flag, data, checksum_ok, header_or_None)."""
    raw = open(path, 'rb').read()
    out, i = [], 0
    while i < len(raw):
        length = raw[i] | (raw[i + 1] << 8)
        i += 2
        blk = raw[i:i + length]
        i += length
        flag, body, chk = blk[0], blk[1:-1], blk[-1]
        acc = 0
        for b in blk[:-1]:
            acc ^= b
        header = None
        if flag == 0 and len(body) == 17:
            header = {
                'type': body[0],
                'typeName': TYPES.get(body[0], str(body[0])),
                'name': body[1:11].decode('latin1'),
                'length': body[11] | (body[12] << 8),
                'param1': body[13] | (body[14] << 8),
                'param2': body[15] | (body[16] << 8),
            }
        out.append((flag, body, acc == chk, header))
    return out


def tape_data_blocks(path=TAPE):
    """Datové bloky (flag $FF) v pořadí, jak jdou po kazetě."""
    return [b for b in tap_blocks(path) if b[0] == 0xFF]


def loading_screen(path=TAPE):
    """6912 B bloku SCREEN$ `JPSP` – přesně to, co kazeta nahraje na $4000."""
    blocks = tap_blocks(path)
    for i, (flag, body, ok, hdr) in enumerate(blocks):
        if hdr and hdr['name'].strip() == 'JPSP':
            data = blocks[i + 1][1]
            assert len(data) == 6912, len(data)
            return data
    raise LookupError('blok SCREEN$ JPSP na kazete neni')


# --- obraz paměti -----------------------------------------------------------

# Kam co kazeta nahraje (z hlaviček, ne z odhadu)
CODE_LOAD = 0x6000      # blok "0", 8192 B
RELOC_SRC = 0x6004      # $6000: DI / JP $5B80, a $5B80 udělá LDIR $6004->$6000
CODE_BASE = 0x6000      # kde kód leží po přesunu
ENTRY = 0x61E5          # kam $5B80 skočí
CODE_LEN = 0x2000


def memory_image(path=TAPE):
    """Obraz RAM $4000–$FFFF **po přesunu**, tedy tak, jak hra opravdu běží.

    Kazeta nahraje kód na $6000 a `PRINT USR 24576` skočí na $6000, kde je
    `DI / JP $5B80`. Blok na $5B80 je patnáct bajtů:

        LD HL,$6004 / LD DE,$6000 / LD BC,$2000 / LDIR / JP $61E5

    tedy celý blok se posune o čtyři bajty dolů (ty čtyři bajty byly jen ta
    skokánka) a hra začíná na $61E5. Tohle je jediný správný obraz pro
    disassembly i pro extrakci dat – v nahraném bloku jsou všechny adresy
    posunuté o 4.
    """
    mem = bytearray(0xC000)          # $4000–$FFFF
    blocks = tap_blocks(path)
    for i, (flag, body, ok, hdr) in enumerate(blocks):
        if hdr and hdr['type'] == 3:
            addr, data = hdr['param1'], blocks[i + 1][1]
            mem[addr - 0x4000:addr - 0x4000 + len(data)] = data
    # LDIR $6004 -> $6000, 8192 B (čte i pár bajtů nad $7FFF; na 16K stroji tam
    # není paměť, takže tam zůstane, co bylo – pro data hry to je jedno)
    src = RELOC_SRC - 0x4000
    mem[CODE_BASE - 0x4000:CODE_BASE - 0x4000 + CODE_LEN] = mem[src:src + CODE_LEN]
    return bytes(mem)


def code_image(path=TAPE):
    """Jen kód a data hry: $6000–$7FFF po přesunu."""
    mem = memory_image(path)
    return mem[CODE_BASE - 0x4000:CODE_BASE - 0x4000 + CODE_LEN]


def peek(mem, addr, n=1):
    return mem[addr - 0x4000:addr - 0x4000 + n]


def word(mem, addr):
    b = peek(mem, addr, 2)
    return b[0] | (b[1] << 8)
