![](/images/app-icon-256x256.png)

JET PAC
=====================
The 1983 classic, reborn for modern web browsers.

## About
Originally written in 1983 by Ultimate Play The Game for the 16K ZX Spectrum.
This will be a faithful remake based on the original ZX Spectrum version — not
an emulator and not a binary copy.

**Status: playable** (M0–M6 done, 2026-09-17). The tape is taken apart, the
program disassembled, and every rule in the game is a transcription of the
original's own handlers, checked against runs recorded off it in a simulator —
**324 682 checks, 356 differences** — 270 of them the colour trail the
original leaves behind and the remake does not yet, 86 the fine accounting of
a laser shot. See `MILNIKY.md` for the numbers and `sources/docs/disasm_notes.md`
for what was measured.

- 256×192 + border, integer scaling, `ZXPlatform`
- graphics extracted from the original program, not redrawn
- **LOAD TAPE**: the real loading screen off the tape, loaded byte by byte
- the beeper in Z80 T states, pulse for pulse (there is no music: the game
  has none)
- keyboard, gamepad, touch

Still to come (M7): incremental drawing, so the colour trail the original
leaves behind comes back; two-player games; performance on a phone; release.

## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 gate in `svtool verify` (`npm i -g es-check`)
- Python 3, only for the tools that extract and verify the data of the original

The remake will also offer **LOAD TAPE** as one of the ways to start the game:
the pilot tone, the border stripes, the headers and — if the tape carries one —
the loading screen loaded for real, byte by byte, because the sound *is* the
6912 bytes of the picture. That is why the tape image (TZX/TAP) is the source
this project is built from.

The original tape and cartridge images are copyrighted and are **not** part of
this repository — they are needed only to regenerate the game data, see
`sources/tape/README.md` and `sources/rom/README.md`.

## License
See the [LICENSE](LICENSE) file. *(To be added in M1.)*
