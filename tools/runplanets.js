#!/usr/bin/env node
/**
 * Projde **všech osm planet** workerem a composerem a hlídá, že hra
 * nerozbíjí, co má stát.
 *
 *   ./tools/runplanets.js [--passes N] [--seeds a,b,c] [--verbose]
 *
 * `app/gameWorker.js` běží v atrapě prostředí workeru jako v
 * `tools/runworker.js`, snímky jdou průchod po průchodu do
 * `ScreenComposer.stepInto()` — tedy přesně tou cestou, kterou hru kreslí
 * `app/gameAreaEntity.js` — a po doběhnutí se videopaměť porovná s čerstvě
 * nakreslenými plošinami.
 *
 * ★ **Plošiny se kreslí jednou za kolo a nikdy víc.** `$766D` má v celé hře
 * **jediného volajícího** (`$60C0`, příprava kola), takže co se z nich
 * odmaže, je pryč do konce kola. A odmazat se dá snadno: sprity se kreslí
 * `OR` a mažou `AND` svým doplňkem, takže entita, která plošinou proleze,
 * si z ní ukousne — a do buněk pod sebou nechá svoji barvu. Originál se
 * tomu vyhýbá tím, že **kolizní výška entity (`+7`) je větší než její
 * obrázek**: `$761D` ji od plošiny odrazí dřív, než se obrázky potkají.
 *
 * Kontroluje se tedy:
 *
 * - **žádný bod plošiny nechybí** (bitmapa čtyř plošin proti čerstvé kopii),
 * - **žádná buňka plošiny nemá jinou barvu**,
 * - na každé planetě se opravdu **objevil nepřítel toho typu**, který jí
 *   podle `$6A64` patří — jinak by nula rozdílů nic neznamenala.
 *
 * Proti `match*` nástrojům tohle **není porovnání s originálem**: záznamy
 * z běžícího originálu jsou z první planety, takže pět chování nepřátel
 * z šesti se jimi změřit nedá. Tohle je invariant té jedné věci, kterou
 * o nich bezpečně víme — a byl porušený: `stepDodger` obracel bok
 * (`$6C5A` žádné `XOR $40` nemá, mají ho jen `$6B1C` a `$6D22`), takže
 * koule na **druhé planetě** lezla do ostrůvku a užírala ho.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadDataFile(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name+'.json'), 'utf8'));
}

/** spustí gameWorker.js v atrapě workeru (totéž co tools/runworker.js) */
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
  return {send(message) { sandbox.onmessage({data: message}); }};
}

function popcount(value) {
  var bits = 0;
  while (value) {
    bits += value & 1;
    value >>= 1;
  }
  return bits;
}

/** jedna planeta, jeden seed */
function runPlanet(ScreenComposer, ZXVideoRAM, data, level, seed, passes) {
  const messages = [];
  const worker = startWorker((message) => messages.push(message));
  worker.send({id: 'init', initData: {
    headless: true, players: 1, lives: data.global.lives, hiScore: 0,
    level: level, global: data.global, platforms: data.gfx.platforms,
    cadence: data.cadence, places: data.global.spawnPlaces, seed: seed
  }});

  const render = new ScreenComposer(data.gfx);
  render.prepareLevel(level, 0x08);
  const videoRAM = new ZXVideoRAM();
  render.clearScreen(videoRAM);
  render.drawPlatforms(videoRAM);
  // čerstvé plošiny stranou, proti nim se to na konci porovná
  const clean = new ZXVideoRAM();
  clean.clear(0x00, 0x47);
  render.drawPlatforms(clean);

  const seen = {};
  let previous = false;
  for (let tick = 0; tick < passes; tick++) {
    messages.length = 0;
    worker.send({id: 'tick'});
    for (const message of messages) {
      if (message.id !== 'frame') {
        continue;
      }
      if (previous) {
        render.stepInto(videoRAM, message, previous);
      }
      previous = message;
      // typy v slotech nepřátel ($5D50 a výš), ať je jasné, že se hrálo
      for (let slot = 9; slot < message.entities.length; slot++) {
        const type = message.entities[slot].type;
        if (type) {
          seen[type] = (seen[type] || 0) + 1;
        }
      }
    }
  }

  let lost = 0, colours = 0;
  for (const platform of data.gfx.platforms) {
    for (let row = 0; row < 8; row++) {
      for (let x = 0; x < 256; x += 8) {
        const at = ZXVideoRAM.addressOf(x, platform.y + row);
        lost += popcount(clean.peek(at.h, at.l) & ~videoRAM.peek(at.h, at.l));
      }
    }
    const cell = platform.y >> 3;
    for (let column = 0; column < 32; column++) {
      const was = clean.peekAttribute(cell, column);
      if (was !== 0x47 && videoRAM.peekAttribute(cell, column) !== was) {
        colours++;
      }
    }
  }
  return {lost: lost, colours: colours, seen: seen};
}

async function main() {
  const args = process.argv.slice(2);
  const passes = args.includes('--passes')
    ? parseInt(args[args.indexOf('--passes')+1], 10) : 2000;
  const seeds = (args.includes('--seeds')
    ? args[args.indexOf('--seeds')+1].split(',') : ['1', '4919', '33333'])
    .map((seed) => parseInt(seed, 10) & 0xFFFF);
  const verbose = args.includes('--verbose');

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const data = {global: loadDataFile('global'), gfx: loadDataFile('sprites'),
                cadence: loadDataFile('cadence')};
  const problems = [];
  let checks = 0;

  for (let level = 0; level < 8; level++) {
    const wanted = data.global.enemyByLevel[level & 0x07];
    let lost = 0, colours = 0, enemyPasses = 0;
    for (const seed of seeds) {
      const result = runPlanet(ScreenComposer, ZXVideoRAM, data, level, seed, passes);
      lost += result.lost;
      colours += result.colours;
      enemyPasses += result.seen[wanted] || 0;
      // 6912 bajtů videopaměti není měřítko: měří se to, co se měřit dá —
      // plošiny (4 × 8 řádků × 32 sloupců bitmapy a 32 buněk barvy)
      checks += data.gfx.platforms.length * (8*32 + 32);
    }
    if (lost || colours) {
      problems.push('planeta '+level+' (nepřítel $'+wanted.toString(16)+
                    '): chybí '+lost+' bodů plošin, '+colours+' buněk má jinou barvu');
    }
    if (!enemyPasses) {
      problems.push('planeta '+level+': nepřítel $'+wanted.toString(16)+
                    ' se za celou dobu neobjevil — kontrola nic neměřila');
    }
    if (verbose || lost || colours) {
      console.log('planeta '+level+'  nepřítel $'+wanted.toString(16)+
                  '  průchodů '+enemyPasses+'  chybí '+lost+'  barev '+colours);
    }
  }

  console.log('');
  console.log('8 planet × '+seeds.length+' seedů × '+passes+' tiků, '+
              checks+' kontrol, **'+problems.length+' rozdílů**');
  problems.forEach((text) => console.log('  '+text));
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(2); });
