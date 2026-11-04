#!/bin/sh
# Z kazety udělá snapshot a obraz RAM. Potřebuje sources/tape/*.tap (mimo git,
# viz sources/tape/README.md) a SkoolKit v app/svision/sources/skoolkit (R-008).
#
# Na rozdíl od Sabre Wulfa tu není žádné šifrování ani Speedlock: kazeta je
# standardní ROM rychlost a snapshot z tap2sna.py je rovnou ten správný obraz.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SK="$ROOT/app/svision/sources/skoolkit"
TAP="$ROOT/sources/tape/Jetpac (1983)(Ultimate).tap"
mkdir -p "$ROOT/build"
[ -f "$TAP" ] || { echo "chybi $TAP - viz sources/tape/README.md"; exit 1; }
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    --start 0x61E5 "$TAP" "$ROOT/build/jetpac.z80"
PYTHONPATH="$SK" python3 - "$ROOT" <<'PY'
import sys
sys.path.insert(0, sys.argv[1] + '/tools')
from skoolkit.snapshot import Snapshot
import jetpaclib as J
root = sys.argv[1]
ram = bytes(Snapshot.get(root + '/build/jetpac.z80').ram(-1))
open(root + '/build/jetpac.bin', 'wb').write(ram)
mine = J.memory_image()
code_ok = ram[0x2000:0x4000] == mine[0x2000:0x4000]
print('RAM $4000-$FFFF: %d B; kod $6000-$7FFF souhlasi s tools/jetpaclib.py: %s'
      % (len(ram), code_ok))
PY
