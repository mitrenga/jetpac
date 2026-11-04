#!/usr/bin/env python3
"""Změří rychlosti přímo ze **záznamu obrazovky** s běžícím originálem.

    ./tools/tracevideo.py [soubor.mov] [--fps 120]

★ **Proč vůbec.** Kadence světa se dá spočítat v simulátoru, ale jen tak
dobře, jak dobře simulátor napodobuje stroj — a bez **kontence** vyjde skoro
o polovinu vyšší (`disasm_notes.md` §3b). Video skutečné hry je nezávislý
svědek: v pixelech a sekundách, bez jakéhokoli modelu.

Měří se tři věci a každá je kontrolou těch ostatních:

- **blikání nápisu `1UP`** na začátku života. ULA překlápí bit `FLASH`
  po 16 snímcích, takže půlperioda je 0,32 s — **hodiny stroje**, na hře
  nezávislé. Z toho vyjde délka snímku.
- **chůze Jetmana**. Ten se hýbe v krátkém kole, tedy **jednou za snímek**,
  a ujde 1 px; jeho rychlost v px/s je tedy snímková frekvence.
- **let nepřítele**. Drifter jde **4 px za dlouhé kolo**, takže jeho rychlost
  dělená čtyřmi je kadence světa.

Obraz se z videa bere přes `ffmpeg`: ořízne se plocha Spectra (najde se podle
žluté podlahy, která je přes celou šířku), zmenší na 256×192 a dál se počítá
v pixelech Spectra.
"""
import argparse, collections, os, subprocess, sys, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 256, 192
FLOOR_Y = 184                  # podlaha ($6000: y = $B8)
PLAY = (40, 182)               # řádky hrací plochy bez panelu a podlahy
BAND = (150, 184)              # pruh u podlahy, kde chodí Jetman
LABEL = (24, 48)               # sloupce nápisu 1UP v pixelech
CREATURE = {                   # barvy, které plošiny ani panel nemají
    'červená':  lambda r, g, b: r > 110 and g < 80 and b < 80,
    'fialová':  lambda r, g, b: r > 110 and b > 110 and g < 90,
    'modrá':    lambda r, g, b: g > 110 and b > 110 and r < 90,
}


def geometry(path):
    """Kde na obraze je plocha Spectra — podle žluté podlahy přes celou šířku."""
    raw = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                          '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip().split(',')
    width, height = int(raw[0]), int(raw[1])
    frame = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', "select='eq(n\\,60)'",
                            '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo',
                            '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout

    def pixel(x, y):
        i = (y*width + x)*3
        return frame[i], frame[i+1], frame[i+2]

    def yellow(c):
        return c[0] > 150 and c[1] > 120 and c[2] < 100

    rows = [y for y in range(height)
            if sum(1 for x in range(0, width, 4) if yellow(pixel(x, y))) > width//40]
    if not rows:
        raise SystemExit('podlaha v obraze není — je to vůbec záznam hry?')
    row = rows[len(rows)//2]
    xs = [x for x in range(width) if yellow(pixel(x, row))]
    left, right = xs[0], xs[-1]
    scale = (right-left+1)/256.0
    top = row - scale*(FLOOR_Y + 3)          # střed podlahového pruhu
    return int(round(left)), int(round(top)), int(round(256*scale)), int(round(192*scale))


def frames(path, crop):
    size = W*H*3
    process = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-i', path, '-vf',
         'crop=%d:%d:%d:%d,scale=%d:%d:flags=area' % (crop[2], crop[3], crop[0], crop[1], W, H),
         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    while True:
        data = process.stdout.read(size)
        if len(data) < size:
            break
        yield data


def columns(frame, rows, test):
    """kolik pixelů dané barvy je v každém sloupci"""
    out = [0]*W
    for y in range(*rows):
        base = y*W*3
        for x in range(W):
            i = base + x*3
            r, g, b = frame[i], frame[i+1], frame[i+2]
            if r < 70 and g < 70 and b < 70:
                continue
            if test(r, g, b):
                out[x] += 1
    return out


def clusters(mass, threshold=2, gap=3, minimum=12):
    out, run, hole = [], [], 0
    for i, v in enumerate(mass):
        if v >= threshold:
            run.append((i, v))
            hole = 0
        elif run:
            hole += 1
            if hole > gap:
                out.append(run)
                run, hole = [], 0
    if run:
        out.append(run)
    found = []
    for run in out:
        weight = sum(v for _, v in run)
        if weight >= minimum:
            found.append(sum(i*v for i, v in run)/weight)
    return found


def tracks(series, tolerance=10, shortest=40):
    """spojí shluky mezi snímky do drah"""
    live, done = [], []
    for index, found in enumerate(series):
        used = set()
        for track in live:
            best = None
            for j, x in enumerate(found):
                if j in used:
                    continue
                d = abs(x - track['x'][-1])
                if d <= tolerance and (best is None or d < best[0]):
                    best = (d, j, x)
            if best:
                _, j, x = best
                used.add(j)
                track['x'].append(x)
                track['n'].append(index)
                track['miss'] = 0
            else:
                track['miss'] += 1
        for track in [t for t in live if t['miss'] > 2]:
            live.remove(track)
            done.append(track)
        for j, x in enumerate(found):
            if j not in used:
                live.append({'x': [x], 'n': [index], 'miss': 0})
    return [t for t in done+live if len(t['x']) >= shortest]


def slope(ns, xs):
    m = len(ns)
    sx, sy = sum(ns), sum(xs)
    sxx = sum(n*n for n in ns)
    sxy = sum(n*x for n, x in zip(ns, xs))
    denom = m*sxx - sx*sx
    if not denom:
        return 0.0
    return (m*sxy - sx*sy)/denom


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video', nargs='?')
    ap.add_argument('--fps', type=float, default=120.0,
                    help='kolik snímků za sekundu ffmpeg vydá (výchozí 120)')
    args = ap.parse_args()

    path = args.video
    if path is None:
        folder = os.path.join(HERE, '..', 'sources', 'media', 'video')
        files = [os.path.join(folder, name) for name in sorted(os.listdir(folder))
                 if name.lower().endswith(('.mov', '.mp4')) and name[0] not in 'I']
        if not files:
            print('v sources/media/video není žádný záznam obrazovky')
            return 2
        path = files[0]
    print('záznam: %s' % os.path.basename(path))
    crop = geometry(path)
    print('plocha Spectra v obraze: %dx%d na %d,%d  (%.2f pixelu videa na pixel Spectra)'
          % (crop[2], crop[3], crop[0], crop[1], crop[2]/256.0))

    label, creatures, jetman = [], {name: [] for name in CREATURE}, []
    for index, frame in enumerate(frames(path, crop)):
        value = 0
        for y in range(0, 8):
            base = y*W*3
            for x in range(*LABEL):
                i = base + x*3
                value += frame[i] + frame[i+1] + frame[i+2]
        label.append(value/(8*(LABEL[1]-LABEL[0])*3))
        for name, test in CREATURE.items():
            creatures[name].append(clusters(columns(frame, PLAY, test)))
        jetman.append(clusters(columns(frame, BAND,
                                       lambda r, g, b: r > 140 and g > 140 and b > 140),
                               minimum=20))
        if index % 100 == 0:
            sys.stderr.write('.')
            sys.stderr.flush()
    sys.stderr.write('\n')

    # 1) blikání 1UP — hodiny stroje
    middle = (min(label)+max(label))/2
    state = [v > middle for v in label]
    changes = [i for i in range(1, len(state)) if state[i] != state[i-1]]
    halves = [(changes[i+1]-changes[i])/args.fps for i in range(len(changes)-1)]
    halves = [h for h in halves if h > 0.1]
    frame_ms = None
    if halves:
        half = statistics.median(halves)
        frame_ms = half/16*1000
        print('\nblikání 1UP: půlperioda %.4f s  =>  snímek %.3f ms  =>  %.2f Hz'
              % (half, frame_ms, 1000/frame_ms))

    # 2) Jetman — krátké kolo, 1 px za snímek
    walk = []
    for track in tracks(jetman):
        speed = slope(track['n'], track['x'])*args.fps
        if abs(speed) > 20:
            walk.append(speed)
            print('chůze Jetmana: %+.1f px/s  (%d snímků)' % (speed, len(track['n'])))
    if walk:
        fastest = max(walk, key=abs)
        print('   => snímek %.3f ms  =>  %.2f Hz   (Jetman jde 1 px za snímek)'
              % (1000/abs(fastest), abs(fastest)))

    # 3) nepřátelé — dlouhé kolo, 4 px za kolo
    speeds = []
    for name in CREATURE:
        for track in tracks(creatures[name]):
            speed = slope(track['n'], track['x'])*args.fps
            if abs(speed) < 20:
                continue
            speeds.append((abs(speed), name, len(track['n'])))
            print('%s: %+.1f px/s  (%d snímků, %.2f s)'
                  % (name, speed, len(track['n']),
                     (track['n'][-1]-track['n'][0])/args.fps))
    if speeds and frame_ms:
        # ★ bere se **nejdelší** dráha, ne nejrychlejší: krátký úsek může být
        # dva slepení tvorové nebo shluk, který se cestou rozpadl
        best, name, count = max(speeds, key=lambda item: item[2])
        rounds = best/4.0
        print('\n★ nejdelší dráha (%s, %d snímků): %.1f px/s = %.2f dlouhého kola '
              'za sekundu' % (name, count, best, rounds))
        print('★ kadence světa: **%.3f dlouhého kola na snímek**'
              % (rounds*frame_ms/1000))
        others = sorted(item[0] for item in speeds)
        print('   (všechny dráhy: %s px/s, medián %.1f => %.3f kola na snímek)'
              % (', '.join('%.0f' % v for v in others), statistics.median(others),
                 statistics.median(others)/4.0*frame_ms/1000))
    return 0


if __name__ == '__main__':
    sys.exit(main())
