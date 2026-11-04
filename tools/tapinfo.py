#!/usr/bin/env python3
"""Rozebere kazetu blok po bloku a vypíše, co na ní je.

    ./tools/tapinfo.py [--basic]

Výstup téhle věci je zapsaný v `sources/docs/tape_layout.md`.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jetpaclib as J   # noqa: E402

# tokeny ZX BASICu od $A5 výš
TOKENS = ('RND INKEY$ PI FN POINT SCREEN$ ATTR AT TAB VAL$ CODE VAL LEN SIN COS TAN '
          'ASN ACS ATN LN EXP INT SQR SGN ABS PEEK IN USR STR$ CHR$ NOT BIN OR AND '
          '<= >= <> LINE THEN TO STEP DEF-FN CAT FORMAT MOVE ERASE OPEN# CLOSE# MERGE '
          'VERIFY BEEP CIRCLE INK PAPER FLASH BRIGHT INVERSE OVER OUT LPRINT LLIST '
          'STOP READ DATA RESTORE NEW BORDER CONTINUE DIM REM FOR GO-TO GO-SUB INPUT '
          'LOAD LIST LET PAUSE NEXT POKE PRINT PLOT RUN SAVE RANDOMIZE IF CLS DRAW '
          'CLEAR RETURN COPY').split()


def basic_listing(data):
    out, i = [], 0
    while i + 4 <= len(data):
        line = (data[i] << 8) | data[i + 1]
        ln = data[i + 2] | (data[i + 3] << 8)
        i += 4
        body, i = data[i:i + ln], i + ln
        text, j = [], 0
        while j < len(body):
            c = body[j]
            if c == 0x0E:          # binární podoba čísla – přeskočit
                j += 6
                continue
            if c == 0x0D:
                break
            if c >= 0xA5:
                text.append(' %s ' % TOKENS[c - 0xA5].replace('-', ' '))
            elif c == 0x10:
                text.append('<INK %d>' % body[j + 1]); j += 1
            elif c == 0x11:
                text.append('<PAPER %d>' % body[j + 1]); j += 1
            elif c == 0x12:
                text.append('<FLASH %d>' % body[j + 1]); j += 1
            elif c == 0x13:
                text.append('<BRIGHT %d>' % body[j + 1]); j += 1
            elif 32 <= c < 127:
                text.append(chr(c))
            else:
                text.append('[%02X]' % c)
            j += 1
        out.append('%4d %s' % (line, ''.join(text)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--basic', action='store_true', help='vypsat i zavaděč v BASICu')
    ap.add_argument('tape', nargs='?', default=J.TAPE)
    args = ap.parse_args()

    blocks = J.tap_blocks(args.tape)
    print('%s: %d bloků' % (os.path.basename(args.tape), len(blocks)))
    for n, (flag, body, ok, hdr) in enumerate(blocks, 1):
        kind = 'hlavička' if flag == 0 else 'data    '
        line = '  %2d. %s  %5d B  součet %s' % (n, kind, len(body), 'OK' if ok else 'CHYBA')
        if hdr:
            line += "   %-14s '%s'  %5d B  -> $%04X" % (
                hdr['typeName'], hdr['name'], hdr['length'], hdr['param1'])
            if hdr['type'] == 0:
                line += '  (autostart %d)' % hdr['param1']
        print(line)
    if args.basic:
        print('\nzavaděč v BASICu:')
        for l in basic_listing(blocks[1][1]):
            print('  ' + l)


if __name__ == '__main__':
    main()
