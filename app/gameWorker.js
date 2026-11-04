// begin code

/**
 * Jetpac game worker.
 *
 * It keeps the game state, the clock and the protocol (WORKER-PROTOCOL.md);
 * the model only sends it the controls and draws what comes back.
 *
 * ★ **The tick is 50 Hz and the world runs off an accumulator.** The original
 * is not tied to the frame at all and it has two rounds: the short one —
 * Jetman, his shots, the sound — once a frame, and the long one — the rocket,
 * the items, the creatures — **once every 55 ms**, which is what the original
 * does with creatures about (54.7 ms measured, 55.9 on a video of the real
 * machine). The remake holds that steady, while the original itself runs
 * anywhere between 28 ms (empty screen) and 57 ms (five creatures).
 * ZADANI chap. 10.
 *
 * ★ The state is the game's own: **seventeen entity records of eight bytes**
 * from $5D00 to $5D87, walked in slot order, each dispatched through a table
 * of eighteen handlers by `type & $3F` ($6374). The slots are not
 * interchangeable — $5D00 is Jetman, $5D08 to $5D20 are the four laser shots,
 * $5D28 is the sound, $5D30 the rocket, $5D38 and $5D40 the two pieces waiting
 * to be fetched and $5D48 upwards the enemies. The worker keeps exactly that
 * shape, so a port of a handler has the same bytes under it as the original.
 *
 * ★ **Two cadences, because the original has two.** Its main loop walks the
 * entities from $5D30 upwards over and over, but reaches $5D00-$5D28 —
 * Jetman, his four laser shots and the sound — only when `FRAMES` has changed
 * ($6351 compares it with $5DD4; $6965 rewrites the loop's own limit at $69B5
 * and returns through $699D). So:
 *
 * - **Jetman, the lasers and the sound step once per frame**, 50.08 Hz, and
 *   the remake's fixed tick is exactly right for them;
 * - **the rocket, the pieces and the creatures step once per long round**,
 *   and a long round is as long as the Z80 needs — measured at 54.7 ms with
 *   creatures about (tools/tracecadence.py); the remake steps the world
 *   **every 55 ms**, that is once every two and three quarter frames.
 *
 * Since M3 the worker **steps Jetman** with app/jetmanPhysics.js, and since
 * M4 and M5 the rest of the world with app/worldEntities.js and
 * app/worldMonsters.js — all three transcriptions of the original's own
 * handlers, checked against runs recorded off it: **26 350 checks of the
 * physics and 244 256 of the whole entity table** (tools/matchphysics.js,
 * tools/matchentities.js). Nothing in them is invented; every number is the
 * operand of an actual instruction.
 *
 * ★ **The one thing that cannot be copied is the randomness.** The original
 * stirs $5DCE after every entity ($69AB) and once a round mixes in the refresh
 * register and a byte of the Spectrum's own ROM ($69C7) — a remake has neither.
 * What stands in for it is a seeded generator, so a game can be played back:
 * the mixing is the original's, the entropy is ours (METHODOLOGY.md).
 */

var query = (typeof self !== 'undefined' && self.location) ? self.location.search : '';
importScripts('jetmanPhysics.js'+query);
importScripts('worldEntities.js'+query);
importScripts('worldMonsters.js'+query);

// ★ **Rovných 20 ms, tedy 50,0 Hz.** Skutečné přerušení ULA chodí po
// 69888 T-stavech, což je 19,968 ms (50,08 Hz) — jenže `setTimeout` bere celé
// milisekundy, takže desetinné číslo se stejně zaokrouhlí a jen zbytečně
// rozchází to, co si worker počítá, s tím, co doopravdy naměří. Rozdíl je
// **0,16 %**, tedy 3 vteřiny za půl hodiny hry; vědomá odchylka od 2026-09-18
// (ZADANI.md §10/1). Fyzika je na tom nezávislá — počítá se na průchody, ne
// na čas, takže `matchphysics.js` z toho nemá ani bajt rozdílu.
var TICK_MS = 20;                     // 50 Hz; originál 19,968 (69888 T-stavů)
// ★ How often the **long** round runs — the round the rocket, the items and
// the creatures step on.
//
// **One number, on purpose.** The original has no such number: its main loop
// waits for nothing, so a round takes as long as it takes, and the world
// visibly stutters as the screen fills up — **28 ms** with nothing on it,
// **55 ms** with three creatures, **57 ms** with five (data/cadence.json).
// The remake steps the world **every fourth tick**, 80 ms — steady because a
// world that speeds up and slows down with the load is not what a remake
// wants, and four because the game plays better that way (2026-09-18,
// ZADANI.md §10/1). ★ **Four is a choice, not a measurement**: the original's
// own number is the 55 below, so the world is about a **third slower** than
// it. Jetman is not: he rides the short round and stays at 50 Hz.
//
// Three independent measurements say the same thing about playing the game:
// the contended simulator gives 54.7 ms on average with creatures about, 55.1
// with three of them (tools/tracecadence.py), and a video of the real machine
// gives 55.9 (tools/tracevideo.py).
//
// ★ **Two things once made this number wrong, and both are worth knowing.**
// The counter $5DCC goes up at the end of **both** rounds ($69C7), so
// "passes per frame" read off it is 1.45 — the sum of the two — and the world
// ran nearly three times too fast. And the simulator was run **without
// contention**, which for a game that lives entirely in the lower 16 KB is
// worth a third of its speed. Only a video of the real machine showed it up
// (tools/tracevideo.py, sources/media/video/README.md).
//
// ★ **A nesmí to být celý násobek tiku.** Hra si sama časá podle počítadla
// `$5DCC`, které se zvedá na konci **obou** kol, a ptá se ho na zbytky:
// palivo se zhmotní, jen když `pass & $0F` vyjde 15 ($664B), poklad při
// `& $7F` ($65F7). Když dlouhé kolo trvá přesně tři tiky, přibude mezi dvěma
// dlouhými koly vždycky přesně 4 — a čtyřka dělí šestnáctku, takže se na
// tři čtvrtiny fází **nepadne nikdy** a palivo přestane chodit úplně.
//
// ★ **Sudý počet tiků tím prochází, lichý ne.** Mezi dvěma dlouhými koly
// přibude počítadlu `ticks+1`, a liché číslo je s mocninou dvojky nesoudělné,
// takže padnou všechny fáze. Změřeno na workeru (12 000 tiků, pauza mezi
// palivy):
//
//     2 tiky  (40 ms)   16/16 fází,  128/128,  0,64 s
//     3 tiky  (60 ms)    4/16 fází,   32/128,  **palivo nikdy**
//     4 tiky  (80 ms)   16/16 fází,  128/128,  1,28 s   ← nastaveno
//     6 tiků (120 ms)   16/16 fází,  128/128,  1,92 s
//
// ★ **Je to počítadlo tiků, ne zlomek.** Jeden časovač na tik (50 Hz) a každý
// n-tý tik se navíc odbaví dlouhé kolo, jak říká vzor té planety — nic se
// nehromadí a nedá se to rozladit. Cena za tu jednoduchost je, že svět
// **nemůže běžet rychleji než obrazovka**: originál to na prázdné obrazovce umí (28 ms na
// kolo, tedy víc kol za tik), remake drží jednu pomalejší periodu tak jako
// tak (ZADANI.md §10/1), takže se to nikde neprojeví.
// ★ **Tabulka podle nepřítele**, protože rychlost světa je tu kvůli němu —
// jak se dá planeta hrát, rozhoduje to, co po Jetmanovi lítá, ne jaká je na
// ní raketa. Který nepřítel kde je, říká `$6A64`, a ten se opakuje **po
// osmi** planetách, takže tabulka má osm řádků a indexuje se `level & $07`.
// (Obrázky rakety a dílů se točí po šestnácti, $6741 a $6EFA — na rychlost
// ale nemají vliv, tak se tu neřeší.)
//
// ★ Řádky 0 a 6 dostávají **téhož** nepřítele (typ 3) a řádky 4 a 7 taky
// (typ $0F) — dvojice patří k sobě, jinak jde tentýž tvor jednou rychle
// a podruhé pomalu.
//
// Ladí se ručně, hraním; není to měřená hodnota a nikdy nebyla. **Položkou je
// vždycky vzor** — pole tiků, které se opakuje dokola —, i když má jediný
// prvek: jeden tvar znamená jedno zacházení a nikde se nemusí ptát, co to je.
// Samotné liché číslo hru rozbije, a právě proto tu vzory jsou; viz níž.
var LONG_ROUND_TICKS_BY_LEVEL = [
  [3, 3, 3, 3, 4],   // 0  typ $03  letec — 64 ms: rychlejší, jak se ukázalo
                     //              při hraní (2026-09-18). ★ Samotná `[3]`
                     //              **nejde**: změřeno na workeru, palivo by
                     //              nespadlo ani jednou ze 4000 kol a raketa
                     //              by se nedala natankovat. Přes tenhle vzor
                     //              přibude počítadlu 16+5 = **21**, liché.
  [4],               // 1  typ $11  chodec
  [4],               // 2  typ $06  uhýbavý
  [3, 3, 4],         // 3  typ $07  střemhlavý — 66,7 ms. ★ Číhání střemhlavého
                     //              je geometrické s krokem dlouhého kola
                     //              (1/32 na kolo, $6408), takže se s 80 ms
                     //              roztáhlo o 46 % proti změřenému originálu
                     //              (54,7 ms) a bylo to při hraní vidět. Tohle
                     //              je kompromis mezi tím a věrnou hodnotou
                     //              (2026-09-18). Přes vzor přibude počítadlu
                     //              4+4+5 = **13**, liché.
  [4],               // 4  typ $0F  naháněč
  [4],               // 5  typ $05  skákavý
  [3, 3, 3, 3, 4],   // 6  typ $03  letec — jako řádek 0, je to tentýž tvor
  [4]                // 7  typ $0F  naháněč — jako řádek 4
];
var LONG_ROUND_TICKS = [4];                          // co platí, když planeta v tabulce chybí
var LONG_ROUND_MS = LONG_ROUND_TICKS[0]*TICK_MS;     // odvozeno, ne opsané

/**
 * Vzor dlouhého kola pro planetu — kopie, aby si ho stav mohl přepsat.
 * @param {number} level - Počítadlo planet ($5DF0).
 * @returns {Array} Kolik tiků nese který dlouhý běh, dokola.
 */
function longRoundPattern(level) {
  return (LONG_ROUND_TICKS_BY_LEVEL[level & 0x07] || LONG_ROUND_TICKS).slice();
}

/**
 * Nastaví vzor dlouhého kola pro planetu — z tabulky, nebo ten z `cadence`,
 * když ho někdo dosadil. Volá se na začátku hry a při každé nové planetě.
 * @param {number} level - Počítadlo planet ($5DF0).
 */
function useCadence(level) {
  var pattern = state.longRoundOverride || longRoundPattern(level);
  checkPattern(level, pattern);
  state.longRoundPattern = pattern;
  state.longRoundStep = 0;
  state.ticks = 0;
} // useCadence

/**
 * ★ Ohlásí vzor, který hru vyhladoví. Přes celý vzor přibude počítadlu
 * `$5DCC` součet `tiky+1`; hra se ho ptá na zbytky po šestnácti (palivo,
 * $664B) a po stodvaceti osmi (poklad, $65F7), a **sudý součet ty zbytky
 * neprojde celé** — dosáhne jen na čtvrtinu fází a na které, to záleží na
 * tom, kde se zrovna začalo. Naměřeno na vzoru `[3]`: podle výchozí fáze
 * buď **palivo nespadne nikdy**, nebo **poklad nespadne nikdy**, a ve dvou
 * ze čtyř případů ani jedno. Hlásí se to, protože tichá verze téhle chyby
 * stála v tomhle projektu už jednou půl dne.
 * @param {number} level - Která planeta.
 * @param {Array} pattern - Její vzor.
 */
function checkPattern(level, pattern) {
  var step = pattern.reduce(function(sum, ticks) { return sum + ticks + 1; }, 0);
  if (step % 2 === 0) {
    console.error('gameWorker: planeta ' + level + ' má vzor dlouhého kola [' +
                  pattern.join(',') + '] se sudým krokem počítadla (' + step +
                  ') — palivo nebo poklad na ní nespadne vůbec. ' +
                  'Bezpečně „skoro totéž" je [3,3,4] nebo [3,4].');
  }
}

/** $5D00-$5D87: seventeen records of eight bytes */
var SLOTS = 17;
var RECORD = 8;
/** which slot is what ($5D00 + 8*slot) */
var SLOT = {jetman: 0, lasers: [1, 2, 3, 4], sound: 5, rocket: 6,
            pieces: [7, 8], enemies: [9, 10, 11, 12, 13, 14, 15, 16]};

var state = null;
var timer = 0;
var lastTime = false;
var accumulator = 0;

function reset() {
  clearTimeout(timer);
  timer = 0;
  lastTime = false;
  accumulator = 0;
  state = {
    running: false, paused: false, headless: false,
    pass: 0,
    players: 1, player: 1,
    lives: [4, 0],
    score: [0, 0],
    hiScore: 0,
    level: 0,
    // ★ $619A: the delay before a life starts is **$80 passes for one player
    // and $FF for two** (`LD A,$80` and `ADD A,$7F` when bit 0 of the options
    // is set). While it runs, Jetman is not drawn and the label of the player
    // whose turn it is flashes ($61BD).
    startDelay: 0x80,
    controls: {left: false, right: false, thrust: false, fire: false, brake: false},
    entities: [],
    seed: 0,
    ticks: 0,
    longRounds: 0,
    // vzor dlouhého kola té planety, na které se zrovna je (useCadence)
    longRoundPattern: LONG_ROUND_TICKS.slice(),
    longRoundStep: 0,
    longRoundOverride: false,
    // ★ the fractions of Jetman's coordinates, which the original keeps
    // **outside** the entity record ($5DC7 and $5DC8): the speed is in
    // sixteenths of a pixel, so without them a step cannot be repeated
    fracX: 0,
    fracY: 0,
    // ★ $5DCA is nought during play — $61FE sets it to 4 before the menu and
    // starting a game wipes $5CF4-$5FFF ($6333) — which makes the step of
    // acceleration 8 (jetmanPhysics.js)
    accel: 0,
    platforms: [],
    sounds: []
  };
} // reset

/**
 * Builds the entity table the way the original builds it when a life starts:
 * $619A copies eight bytes into $5D00 for Jetman and $60CD copies
 * twenty-four into $5D30 for the rocket and the two pieces waiting on the
 * platforms. Every other slot is empty.
 * @param {Object} global - The parsed data/global.json.
 */
function initEntities(global) {
  var templates = (global && global.templates) || {};
  state.entities = [];
  for (var slot = 0; slot < SLOTS; slot++) {
    state.entities.push([0, 0, 0, 0, 0, 0, 0, 0]);
  }
  if (templates.jetman) {
    state.entities[SLOT.jetman] = templates.jetman.slice(0, RECORD);
  }
  if (templates.levelEntities) {
    // three records in a row: the rocket at $5D30 and the two pieces after it
    [SLOT.rocket, SLOT.pieces[0], SLOT.pieces[1]].forEach((slot, index) => {
      state.entities[slot] = templates.levelEntities.slice(index*RECORD,
                                                           index*RECORD + RECORD);
    });
    // ★ The template carries $02 in its colour byte, but the rocket is drawn
    // white: $67A9 loads $47 into (IX+$03) every time it draws, and only the
    // fuelling branch above it puts anything else there. So the colour is the
    // handler's, not the template's — one line of M4 borrowed here, because
    // without it the very first screen of the game would be the wrong colour.
    state.entities[SLOT.rocket][3] = 0x47;
  }
} // initEntities

/**
 * ★ The stand-in for $5DCE's own entropy: the mixing is the original's
 * ($69C7 adds the previous state, a byte it reads at HL — which with H = 0 is
 * the Spectrum's ROM — and the refresh register), the two things a browser has
 * not got are replaced by a seeded generator. That is what makes a run
 * repeatable, which is what a regression test needs (METHODOLOGY.md).
 * @returns {number} The next value of the state.
 */
function nextRandom() {
  // a plain 8 bit LCG in place of the ROM byte and the refresh register
  state.seed = (state.seed*77 + 113) & 0xFFFF;
  return (state.world.randomState + (state.seed >> 8) + (state.seed & 0xFF)) & 0xFF;
} // nextRandom

/**
 * The world the ported handlers work on — the game's own variables, in the
 * shape worldEntities.js expects them.
 * @returns {Object} The world.
 */
function buildWorld(initData) {
  var global = initData.global || {};
  return {
    entities: state.entities,
    fracX: 0, fracY: 0,
    accel: 0,
    pass: 0,
    frame: 0,
    level: state.level,
    startDelay: state.startDelay,
    players: state.players,
    player: state.player,
    lives: state.lives,
    score: state.score,
    platforms: (initData.platforms || []).filter(function(platform) {
      return platform.flag;
    }),
    places: initData.places || [],
    templates: global.templates || {},
    enemyByLevel: global.enemyByLevel || [3],
    randomState: (initData.seed || 0) & 0xFF,
    nextRandom: nextRandom,
    controls: state.controls,
    // ★ $60DA: what is pre-shifted into the carrying buffer at the start of a
    // level is `$08`, the piece that falls first. It moves on by eight every
    // time a piece is fitted ($65BC), so it is the fuel ($18) by the time the
    // rocket is built. The model needs it, because it is what a **falling or
    // carried** item is drawn with ($726A goes through the shift table, not
    // through $67C3).
    carried: 0x08,
    // ★ Vědomá odchylka (2026-09-18, ZADANI.md §10/8): originál dá letící
    // raketě **jeden bod za dlouhé kolo** ($66CA, $66EE), tady jeden bod za
    // tři tiky, tedy za 60 ms. Počítadlo je tady, a ne v záznamu entity,
    // protože záznam je obraz $5D30 a `matchentities.js` ho porovnává bajt
    // po bajtu.
    rocketTicks: 0,
    events: []
  };
} // buildWorld

/**
 * The frame the model draws: the entity records in the shape the composer
 * wants them, plus everything the panel says.
 * @returns {Object} The 'frame' message.
 */
function frame() {
  return {
    id: 'frame',
    pass: state.pass,
    level: state.level,
    startDelay: state.startDelay,
    entities: state.entities.map((record, slot) => ({
      slot: slot,
      type: record[0] & 0x3F,
      left: !!(record[0] & 0x40),
      x: record[1],
      y: record[2],
      attr: record[3],
      flags: record[4],
      raw: record
    })),
    events: state.events || [],
    carried: state.world ? state.world.carried : 0x08,
    // kolik dlouhých kol už svět odběhl — kadence se tím dá změřit zvenčí
    longRounds: state.longRounds,
    panel: {
      score: state.score[0],
      score2: state.score[1],
      hiScore: state.hiScore,
      lives: state.lives[0],
      lives2: state.lives[1],
      player: state.player
    },
    controls: state.controls,
    sounds: state.sounds.splice(0, state.sounds.length)
  };
} // frame

/**
 * One pass over the entities — one tick.
 *
 * Jetman is stepped by the port of the original's own handlers; the rocket,
 * the pieces and the enemies are M4 and M5, so their slots still stand still.
 */
function pass() {
  state.pass++;
  var world = state.world;
  world.controls = state.controls;
  world.frame = state.pass;
  // ★ the events are **this tick's**, so the list starts empty. (Without this
  // the worker sent the whole history of the game over and over, and the
  // model played every sound again in every frame — WorldEntities.pass()
  // clears it, but the worker runs the two rounds itself.)
  world.events = [];
  // one short round a tick — Jetman's own cadence, 50 Hz — and the long round
  // every few of them, as this planet's pattern says
  WorldEntities.shortRound(world);
  state.ticks++;
  if (state.ticks >= state.longRoundPattern[state.longRoundStep]) {
    state.ticks = 0;
    state.longRoundStep = (state.longRoundStep+1) % state.longRoundPattern.length;
    WorldEntities.longRound(world);
    state.longRounds++;
  }
  state.startDelay = world.startDelay;
  state.events = world.events;
  // ★ nová planeta si bere svůj vzor z tabulky — je to jediné místo, kde se
  // kadence za běhu mění
  if (world.level !== state.level) {
    state.level = world.level;
    useCadence(state.level);
  }
  if (world.events.some(function(event) { return event.id === 'gameOver'; })) {
    state.running = false;
    postMessage({id: 'gameOver', score: state.score[state.player-1],
                 level: state.level});
  }
  postMessage(frame());
} // pass

function schedule() {
  if (!state.running || state.paused || state.headless) {
    return;
  }
  timer = setTimeout(() => {
    var now = Date.now();
    if (lastTime === false) {
      lastTime = now;
    }
    accumulator += now - lastTime;
    lastTime = now;
    // catch up rather than drift, but never run away with it after a stall
    var steps = Math.min(Math.floor(accumulator/TICK_MS), 4);
    accumulator -= steps*TICK_MS;
    for (var step = 0; step < steps; step++) {
      pass();
    }
    schedule();
  }, TICK_MS);
} // schedule

onmessage = function(event) {
  var message = event.data;
  switch (message.id) {

    case 'init':
      reset();
      var initData = message.initData || {};
      state.headless = !!initData.headless;
      state.players = initData.players || 1;
      state.lives = [initData.lives || 4, initData.players === 2 ? (initData.lives2 || 5) : 0];
      state.hiScore = initData.hiScore || 0;
      state.level = initData.level || 0;
      state.startDelay = initData.players === 2 ? 0xFF : 0x80;
      // ★ kadence je v tabulce po planetách; `data/cadence.json` ji může přebít
      // pro všechny naráz (`longRoundTicks`: číslo nebo vzor jako pole) —
      // **v ticích, ne v milisekundách**, protože zaokrouhlování milisekund
      // by tichem vyrobilo hladovění (55 ms vyjde na tři tiky, a to je ta
      // rozbitá hodnota).
      // vzor, ne číslo — stejný tvar jako v tabulce
      var override = initData.cadence && initData.cadence.longRoundTicks;
      state.longRoundOverride = override ? override.slice() : false;
      useCadence(state.level);
      // the four platform records ($6000) — the physics asks the very same
      // table the screen is drawn from ($761D and $766D read one list)
      initEntities(initData.global);
      state.seed = (initData.seed || 0) & 0xFFFF;
      state.world = buildWorld(initData);
      state.running = true;
      postMessage(frame());
      schedule();
      break;

    case 'controls':
      Object.keys(state.controls).forEach((key) => {
        if (key in message) {
          state.controls[key] = !!message[key];
        }
      });
      break;

    case 'pause':
      state.paused = true;
      clearTimeout(timer);
      lastTime = false;
      break;

    case 'continue':
      state.paused = false;
      lastTime = false;
      accumulator = 0;
      schedule();
      break;

    case 'tick':
      if (state.headless) {
        pass();
      }
      break;

    case 'reset':
      reset();
      break;

  } // switch
}; // onmessage

reset();
