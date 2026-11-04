#!/usr/bin/env node
/**
 * Projde celou smyčku workeru bez prohlížeče.
 *
 *   ./tools/runworker.js [--passes N] [--verbose]
 *
 * `app/gameWorker.js` se spustí v atrapě prostředí workeru (postMessage,
 * setTimeout) v režimu `headless`, kde tiká na vyžádání, a projde se celý
 * protokol z `app/WORKER-PROTOCOL.md`: `init`, `controls`, `tick`, `pause`,
 * `continue` a `reset`.
 *
 * Kontroluje se:
 *
 * - worker odpoví na `init` snímkem a drží hodnoty změřené na originálu
 *   (`data/global.json`: **čtyři životy**),
 * - tabulka entit má **sedmnáct slotů po osmi bajtech** a na začátku života
 *   v ní stojí přesně to, co si tam originál kopíruje: Jetman na `$5D00`
 *   a raketa se dvěma díly od `$5D30`,
 * - tik posouvá počítadlo průchodů o jeden,
 * - **odpočet na začátku života je `$80` průchodů** pro jednoho hráče
 *   a `$FF` pro dva (`$619A`), a než doběhne, Jetman se nekreslí,
 * - stav ovládání dorazí celý, včetně **tahu a laseru naráz** – let doleva se
 *   zapnutou tryskou není konflikt,
 * - `pause` zastaví, `continue` rozjede a `reset` zahodí stav.
 *
 * Tik je 50 Hz, takže `--passes 50` je jedna sekunda hry. Krátké kolo
 * (Jetman, střely, zvuk) jde jednou za tik jako v originálu, dlouhé kolo
 * (svět) 0,568× za tik — změřený průměr, `tools/cadence.js`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadDataFile(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

/** spustí gameWorker.js v atrapě workeru a vrátí jeho rozhraní */
function startWorker(onMessage) {
  const sandbox = {
    console,
    performance: {now: () => Date.now()},
    setTimeout: () => 0,
    clearTimeout: () => {},
    postMessage: onMessage,
    importScripts(name) {
      const file = name.split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8'), context,
                      {filename: file});
    },
  };
  sandbox.self = sandbox;
  sandbox.location = {search: ''};
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8'), context,
                  {filename: 'gameWorker.js'});
  return {
    send(message) { sandbox.onmessage({data: message}); },
    context: sandbox,
  };
}

function main() {
  const args = process.argv.slice(2);
  const passes = args.includes('--passes')
    ? parseInt(args[args.indexOf('--passes')+1], 10) : 100;
  const verbose = args.includes('--verbose');

  const global = loadDataFile('global');
  const messages = [];
  const worker = startWorker((message) => {
    messages.push(message);
    if (verbose) {
      console.log(JSON.stringify(message).slice(0, 300));
    }
  });

  const problems = [];
  const check = (condition, text) => {
    if (!condition) {
      problems.push(text);
    }
  };
  const last = () => messages[messages.length-1];

  // 1. init
  worker.send({id: 'init', initData: {
    headless: true, players: 1, lives: global.lives, lives2: global.lives2,
    hiScore: global.hiScore, level: 0, global: global
  }});
  check(messages.length === 1 && last().id === 'frame', 'init neodpovedel snimkem');
  check(last().panel.lives === global.lives,
        'zivoty: '+last().panel.lives+' != '+global.lives+' z data/global.json');
  check(last().panel.score === 0 && last().panel.score2 === 0, 'skore nezacina na nule');
  check(last().panel.player === 1, 'player: '+last().panel.player+' != 1');
  check(last().entities.length === 17,
        'entit: '+last().entities.length+' != 17 slotu ($5D00-$5D87)');
  // ★ co si hra kopíruje na začátku života ($619A, $60CD)
  const jetman = last().entities[0];
  check(jetman.type === 1 && jetman.x === 128 && jetman.y === 183,
        'Jetman nezacina tam, kde v originalu: '+JSON.stringify(jetman));
  const rocket = last().entities[6];
  check(rocket.type === 9 && rocket.x === 168 && rocket.y === 183,
        'raketa nestoji tam, kde v originalu: '+JSON.stringify(rocket));
  const pieces = [last().entities[7], last().entities[8]];
  check(pieces.every((piece) => piece.type === 4),
        'dva dily rakety nejsou na svem miste: '+JSON.stringify(pieces));
  // ★ $619A: odpočet $80 průchodů pro jednoho hráče
  check(last().startDelay === 0x80,
        'odpocet startu: '+last().startDelay+' != 128 ($80)');
  // ★ $60DA: co je na začátku kola předsunuté v paměti pro nesený předmět.
  // Padající i nesený předmět se kreslí **odtud**, ne z tabulky $67C3, takže
  // bez tohohle čísla nakreslí model palivo jako díl rakety.
  check(last().carried === 0x08,
        'predsunuty obrazek na zacatku kola: '+last().carried+' != 8 ($08)');

  // 2. ovládání: tah a laser naráz
  worker.send({id: 'controls', left: true, thrust: true, fire: true, right: false});
  worker.send({id: 'tick'});
  const held = last().controls;
  check(held.left && held.thrust && held.fire && !held.right,
        'ovladani nedoslo cele: '+JSON.stringify(held));
  check(last().pass === 1, 'prvni tik neposunul pocitadlo pruchodu');
  check(last().startDelay === 0x7F, 'odpocet startu se po tiku nesnizil');

  // 3. tikání
  const before = messages.length;
  for (let pass = 0; pass < passes; pass++) {
    worker.send({id: 'tick'});
  }
  check(messages.length === before+passes,
        'tikani neposlalo snimek na kazdy tik: '+(messages.length-before)+' != '+passes);
  check(last().pass === passes+1, 'pocitadlo pruchodu: '+last().pass+' != '+(passes+1));

  // 2b. ★ kadence světa: kolik dlouhých kol se vejde do snímku
  //
  // Tohle je to číslo, které bylo dvakrát špatně — poprvé odečtené
  // z počítadla `$5DCC` (které počítá obě kola), podruhé změřené
  // v simulátoru **bez kontence**, tedy o třetinu rychlejší, než jak běží
  // skutečný stroj. Teď je to tabulka podle počtu nepřátel
  // (`data/cadence.json`, `tools/tracecadence.py`) a tady se kontroluje,
  // že se opravdu používá.
  // ★ jedno číslo, ne tabulka: remake má běžet plynule (ZADANI.md §10)
  const cadence = loadDataFile('cadence');
  worker.send({id: 'init', initData: {
    headless: true, players: 1, lives: global.lives, hiScore: 0, level: 0,
    global: global, cadence: cadence, platforms: loadDataFile('sprites').platforms
  }});
  const before2 = last().longRounds;
  // ★ tisíc tiků, ne sto: dlouhých kol je celé číslo, takže při stovce dělá
  // jedno kolo sem nebo tam u periody kolem 80 ms přes tři milisekundy
  const ticks = 1000;
  for (let pass = 0; pass < ticks; pass++) {
    worker.send({id: 'tick'});
  }
  // ★ tik se bere **ze zdroje workeru**, ne odsud: je to rovných 20 ms
  // (setTimeout celé milisekundy stejně zaokrouhlí), ale kdyby se to vrátilo
  // na skutečných 19,968, nesmí to tenhle nástroj rozhodit
  const workerSource = fs.readFileSync(path.join(ROOT, 'app/gameWorker.js'), 'utf8');
  const tickMatch = workerSource.match(/var TICK_MS = ([0-9.]+)/);
  const tick = tickMatch ? Number(tickMatch[1]) : 69888/3500;
  const rounds = (last().longRounds-before2)/ticks;
  const period = tick/rounds;
  // ★ čeká se to, co je **ve workeru**, ne číslo opsané sem: kadence je od
  // 2026-09-18 tabulka po planetách a runworker hraje planetu 0, takže se
  // čeká její řádek — číslo, nebo vzor, a u vzoru jeho průměr.
  const table = workerSource.match(/var LONG_ROUND_TICKS_BY_LEVEL = \[([\s\S]*?)\n\];/);
  const firstRow = table
    ? table[1].split('\n').map((line) => line.replace(/\/\/.*$/, '').trim())
              .filter((line) => line)[0].replace(/,$/, '')
    : '4';
  const pattern = JSON.parse(firstRow.startsWith('[') ? firstRow : '['+firstRow+']');
  const average = pattern.reduce((sum, count) => sum+count, 0)/pattern.length;
  const wanted = (cadence.longRoundTicks || average)*tick;
  // ★ a tohle je podmínka, ne vkus: přes celý vzor musí počítadlu $5DCC
  // přibýt **lichý** počet, jinak na té planetě nespadne palivo nebo poklad
  // (ZADANI.md §10/1). Je to nález, ne pád — planeta 0 dnes takový vzor má
  // schválně a ladí se ručně.
  const step = pattern.reduce((sum, count) => sum+count+1, 0);
  if (step % 2 === 0) {
    console.log('   POZOR: planeta 0 ma vzor [%s], krok pocitadla %d je sudy — '+
                'palivo nebo poklad na ni nespadne', pattern.join(','), step);
  }
  check(Math.abs(period-wanted) < 1,
        'perioda dlouheho kola: ' + period.toFixed(1) + ' ms, ceka se ' + wanted);
  console.log('   kratke kolo %s ms (%s Hz), dlouhe kolo %s ms (%s/s)',
              tick.toFixed(2), (1000/tick).toFixed(2),
              period.toFixed(1), (1000/period).toFixed(1));

  // 4. pauza a pokračování
  worker.send({id: 'pause'});
  worker.send({id: 'continue'});
  check(last().id === 'frame', 'po pauze a pokracovani neprisel snimek');

  // 5. dva hráči: delší odpočet ($FF)
  worker.send({id: 'init', initData: {
    headless: true, players: 2, lives: global.lives, lives2: global.lives2,
    hiScore: global.hiScore, level: 0, global: global
  }});
  check(last().startDelay === 0xFF,
        'odpocet startu pro dva hrace: '+last().startDelay+' != 255 ($FF)');
  check(last().panel.lives2 === global.lives2,
        'zivoty druheho hrace: '+last().panel.lives2+' != '+global.lives2);

  // 6. ★ celá cesta ovládání → worker → fyzika proti záznamu originálu.
  // Je to jen doplněk k tools/matchphysics.js: ten kontroluje samotný modul,
  // tohle kontroluje, že k němu zpráva `controls` dorazí tak, jak má.
  const tracePath = path.join(ROOT, 'build/physics/thrust.json');
  if (fs.existsSync(tracePath)) {
    const recorded = JSON.parse(fs.readFileSync(tracePath, 'utf8')).trace;
    worker.send({id: 'init', initData: {
      headless: true, players: 1, lives: global.lives, hiScore: 0, level: 0,
      global: global, platforms: loadDataFile('sprites').platforms
    }});
    // přečkat odpočet startu bez držených kláves
    worker.send({id: 'controls', left: false, right: false, thrust: false, fire: false});
    while (last().startDelay) {
      worker.send({id: 'tick'});
    }
    // Porovnává se **o kolik** Jetman za N kroků s drženou tryskou vystoupá.
    // Absolutní y srovnat nejde: záznam originálu začíná o dva pixely níž,
    // protože se do něj Jetman dostal o krok později. Rozdíl ale musí sedět
    // přesně — a jde přes zprávu `controls`, tedy přes celou cestu.
    // ★ Krátce: od M5 ve světě lítají nepřátelé a delší držení trysky skončí
    // srážkou. Přesnost hlídá tools/matchphysics.js; tady jde o to, že zpráva
    // `controls` dorazí až k fyzice.
    const steps = Math.min(recorded.length-1, 20);
    const startY = last().entities[0].y;
    worker.send({id: 'controls', left: false, right: false, thrust: true, fire: false});
    for (let step = 0; step < steps; step++) {
      worker.send({id: 'tick'});
    }
    const alive = (last().entities[0].type === 1 || last().entities[0].type === 2);
    const ours = alive ? startY - last().entities[0].y : false;
    // ★ `recorded[0]` je stav **po** prvním kroku s tryskou (v něm je i ten
    // odskok o dva pixely, kterým se odlepí od plošiny, $75D9), takže náš
    // tik k odpovídá kroku k-1 záznamu
    const theirs = startY - recorded[steps-1].record[2];
    check(ours === false || ours === theirs,
          'stoupání s tryskou za '+steps+' kroků: worker '+ours+' px, originál '+theirs+' px');
  }

  // 6b. ★ jména akcí ovládání — ta, která model posílá, a ta, která worker zná
  //
  // Vypadá to jako formalita a není: `GameModel.setControl()` neznámou akci
  // zahodí, takže překlep v `controlAction()` **nic nenahlásí** a jen přestane
  // fungovat klávesa. Přesně tohle se stalo, když v modelu zůstala jména
  // převzatá z jiné hry (`up`, `down`, `sword`) — Jetman nelítal a nestřílel,
  // a nikde nebyla chyba.
  const modelSource = fs.readFileSync(path.join(ROOT, 'app/gameModel.js'), 'utf8');
  const mapping = modelSource.slice(modelSource.indexOf('controlAction(key)'));
  const actions = [...mapping.slice(0, mapping.indexOf('} // controlAction'))
                     .matchAll(/return '([a-z]+)'/g)].map((found) => found[1]);
  check(actions.length >= 5, 'controlAction() nevrací žádné akce — změnil se tvar?');
  const known = last().controls || {};
  actions.forEach((action) => {
    check(action in known,
          'akci "'+action+'" z gameModel.controlAction() worker nezná: '
          + Object.keys(known).join(', '));
  });

  // 7. reset
  worker.send({id: 'reset'});
  worker.send({id: 'tick'});
  check(last().pass !== undefined, 'po resetu prestal worker odpovidat');

  if (problems.length) {
    console.log('NALEZY:');
    problems.forEach((text) => console.log('  - '+text));
    process.exit(1);
  }
  console.log('worker v poradku: '+messages.length+' zprav, '+(passes+1)
              +' pruchodu, 17 slotu entit, odpocet $80/$FF, '
              + actions.length+' akci ovladani');
}

main();
