![](/images/app-icon-256x256.png)

JETPAC
=====================
The 1983 classic, reborn for modern web browsers.

## About
Originally written in 1983 by Tim and Chris Stamper of Ultimate Play The Game
for the 16K ZX Spectrum. A faithful remake based on the original ZX Spectrum
version — not an emulator and not a binary copy.

**Status: playable** (M0–M6 done, M7 — tuning and release — under way). The
tape is taken apart, the program disassembled, and every rule in the game is a
transcription of the original's own handlers, checked against runs recorded
off it in a simulator. Every `match*` tool reports zero differences but one:
the entity table (`tools/matchentities.js`, 244 256 checks) differs in **two**
bytes of a laser shot, which on the original asks the video memory what is in
front of it.

- 256×192 + border, integer scaling, `ZXPlatform`
- graphics extracted from the original program, not redrawn; drawn
  incrementally as the original draws, with colour per pixel instead of the
  Spectrum's attribute clash (the video memory itself stays the original's,
  byte for byte)
- **LOAD TAPE**: the loader's own messages and the real loading screen off
  the tape, loaded byte by byte
- the beeper in Z80 T states, pulse for pulse (there is no music: the game
  has none)
- one player (the original's two-player mode is left out on purpose); a hall
  of fame on the server

Supported:
- keyboard (redefinable keys)
- gamepad
- touchscreen
- PWA application

Still to come (M7): the two laser bytes, performance on a phone, release.


## Play now
https://jetpac.remake.free


## Controls
| key | action |
|---|---|
| ← → | fly left / right |
| ↑ | thrust |
| ↓ | brake |
| space | fire the laser |
| Esc | pause |

All keys can be redefined in the menu. The original has no single keys but
whole rows: the top row (Q to P) is the thrust, the middle row (A to ENTER)
the laser, and the bottom row is split between left (Z, C, B, M) and right
(X, V, N, SYMBOL SHIFT). The number row brakes.


## Requirements
- PHP 8.1+
- nginx
- MySQL / MariaDB
- Node.js + terser, for building the bundle (`npm i -g terser`)
- es-check, for the ES2018 compatibility gate in `svtool verify` (`npm i -g es-check`)
- Python 3, only for the tools that extract and verify the data of the original


## Install
(`~/` below refers to the project root, not your home directory.)
- clone this repository
- clone library repository https://github.com/mitrenga/svision **next to it** —
  `~/app/svision` is a relative symlink to `../../svision`
- check symlink ~/app/svision
- configure nginx (example: ~/config/nginx.conf)
- create path ~/js with permissions 0777
- create database (script: ~/config/createDB.sql) — without it the menu does not open
- create configuration file ~/config/config.php (example: ~/config/config.php.sample)
- build the production bundle: ~/app/svision/tools/svtool build bundle


## Developer mode
Developer mode is switched in `~/config/config.php` (both settings are optional; without them the app runs in production mode):

```php
$devMode = true;
$devModeName = '.{\"penColor\":\"#000000\",\"bkColor\":\"#fefe00\",\"width\":185}◢◤ ◢◤ ◢◤ ◢◤  DEVELOPER MODE ◢◤ ◢◤ ◢◤ ◢◤';
```

`$devMode` values:
- `true` — development: JS sources are served directly instead of the bundle and the service worker is unregistered/bypassed
- `['serviceWorker' => true]` — development, but the service worker stays enabled (for testing SW behavior against a built `js/` deploy)
- `false` or not set — production: minified bundle + service worker

`$devModeName` is a label rendered in the top border of the game screen, so a development instance is recognizable at a glance. Set it to `false` (or leave it empty) to hide the label. The value is either plain text, or text prefixed with `.{...}` — a JSON object whose properties are applied to the label's TextEntity, typically:
- `penColor` — text color
- `bkColor` — background color
- `width` — label width in game pixels (the text is centered inside it)

The config is written into a double-quoted JavaScript string, so quotes inside the JSON prefix must be escaped as `\"` (see the example above).


## Build & tooling
The `svtool` CLI (`~/app/svision/tools/svtool`) builds and checks the deploy. Run it from the project root:
- `svtool build bundle` — minified production bundle `js/bundle.<version>.min.js` (requires terser)
- `svtool build debug-bundle` — the same concatenation left unminified, `js/bundle.<version>.js`, for debugging on a device whose console cannot be opened
- `svtool verify` — check the `js/` deploy is complete, matches the current sources, and stays within ES2018 (authoritative via es-check if installed, otherwise a heuristic scan)
- `svtool info` — show the app version, deploy state and the most recent database records
- `svtool clean` — remove everything generated from `js/`

Optional — run `svtool` from anywhere and enable bash completion (adjust the path to your svision clone):
- `sudo ln -s /path/to/svision/tools/svtool /usr/bin/svtool`
- `sudo ln -s /path/to/svision/tools/svtool-completion.bash /etc/bash_completion.d/svtool`

Open a new shell afterwards, then run `svtool <command>` from any project root.

Production serves the bundle; in development, with no bundle built, the sources under `app/` are served and loaded one by one through dynamic `import()`.


## Game data
The data of the game are in `data/` — `global.json`, `sprites.json`,
`loading.json`, `sounds.json`, `physics.json` and `cadence.json`, described
in [data/README.md](data/README.md). The server sends them to the application
in a single request (`db/appData.php`). Each file is written by one tool from
`tools/`, never by hand, so the game runs from this repository as it is.

**LOAD TAPE** is one of the ways to start the game: the pilot tone, the border
stripes, the headers and the loading screen loaded for real, byte by byte,
because the sound *is* the 6912 bytes of the picture. That is why the tape
image is the source this project is built from.

Regenerating or verifying the data needs the original tape image, which is
copyrighted and **not part of this repository**. It goes to
`sources/tape/Jetpac (1983)(Ultimate).tap`: 15 648 bytes, SHA1
`999d78212c578687b53e9a53f1135bd5464cd316`. What is seen while loading was
measured from the TZX re-release
`sources/tape/Jetpac (1983)(Sinclair Research)(16K)[re-release].tzx`
(15 724 bytes, SHA1 `1aebee965cf7f5af307aa427367ba47f60ff7081`), whose
twelve blocks carry the same data byte for byte. The tools need Python 3 with
the SkoolKit vendored in svision, and Node.js for the `*.js` tools, which load
the game's own code from `app/`.


## Repository layout
| path | contents |
|---|---|
| `app/` | the game — ES modules; the worker is a classic script |
| `data/` | the data extracted from the original |
| `tools/` | extraction (`dump*`, `mk*`), recording (`trace*`) and verification (`match*`) tools |
| `db/` | PHP endpoints: game data, hall of fame, statistics |
| `config/` | nginx, database, bundle configuration |
| `images/` | icons, poster, cover |


## Credits
- **Jetpac** © 1983 Ultimate Play The Game (Ashby Computers and Graphics),
  written by Tim and Chris Stamper; the rights are now with Rare / Microsoft.
  This is an unofficial fan remake, not affiliated with the rights holders.
- The game prints with the ZX Spectrum ROM font © Amstrad plc; Amstrad permits
  its redistribution for non-commercial use.
- Built on the [svision](https://github.com/mitrenga/svision) library.


## License
The remake's source code is licensed under CC BY-NC-SA 4.0, see the
[LICENSE](LICENSE) file. The license does not cover the original game — its
graphics, texts, sounds and the data extracted from it belong to their
authors.
