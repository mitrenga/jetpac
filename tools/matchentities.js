#!/usr/bin/env node
/**
 * Porovná **celou tabulku entit** průchod po průchodu se záznamem z originálu.
 *
 *   ./tools/matchentities.js [--verbose] [--scenario jmeno] [--slots 6,7,8]
 *
 * Pouští `app/worldEntities.js` a `app/worldMonsters.js` — tedy kód, který jde
 * do prohlížeče — a proti nim staví záznamy z `build/entities/*.json`
 * (`tools/traceentities.py`).
 *
 * Porovnává se **osm bajtů každého ze sedmnácti slotů** na každý průchod,
 * a k tomu skóre a životy. Stav se po každém průchodu **dosadí zpátky
 * z originálu**, takže se počítá, kolik rozdílů doopravdy je, a ne kolik
 * jich jedna odchylka nadělá dál.
 *
 * ★ **Náhoda se sype zpátky.** Originál míchá do `$5DCE` obnovovací registr
 * a bajt z ROM Spectra (`$69C7`), což remake reprodukovat nemůže; do světa se
 * proto pro každý průchod dosadí ta hodnota, kterou měl originál. Co se
 * porovnává, je tedy **chování**, ne generátor.
 *
 * Akceptační kritérium M4 a M5: nula rozdílů v tom, co ten milník pokrývá.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRACES = path.join(ROOT, 'build/entities');
const SLOT_NAMES = ['Jetman', 'laser 1', 'laser 2', 'laser 3', 'laser 4', 'zvuk',
                    'raketa', 'předmět 1', 'předmět 2', 'nepřítel 1', 'nepřítel 2',
                    'nepřítel 3', 'nepřítel 4', 'nepřítel 5', 'nepřítel 6',
                    'nepřítel 7', 'nepřítel 8'];
const BYTE_NAMES = ['typ', 'x', 'y', 'barva', 'příznaky', '+5', '+6', 'výška'];

function main() {
  const verbose = process.argv.includes('--verbose');
  const only = process.argv.includes('--scenario')
    ? process.argv[process.argv.indexOf('--scenario')+1] : null;
  const slotFilter = process.argv.includes('--slots')
    ? process.argv[process.argv.indexOf('--slots')+1].split(',').map(Number) : null;

  const load = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
  global.JetmanPhysics = load(path.join(ROOT, 'app/jetmanPhysics.js')).JetmanPhysics;
  global.WorldEntities = load(path.join(ROOT, 'app/worldEntities.js')).WorldEntities;
  global.WorldMonsters = load(path.join(ROOT, 'app/worldMonsters.js')).WorldMonsters;

  const gfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sprites.json'), 'utf8'));
  const globalData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global.json'), 'utf8'));
  const platforms = gfx.platforms.filter((platform) => platform.flag);

  if (!fs.existsSync(TRACES)) {
    console.error('chybí záznamy v build/entities — spusť tools/traceentities.py');
    process.exit(2);
  }
  let files = fs.readdirSync(TRACES).filter((name) => name.endsWith('.json')).sort();
  if (only) {
    files = files.filter((name) => name === only+'.json');
  }

  let checks = 0, diffs = 0;
  const bySlot = {};
  files.forEach((name) => {
    const data = JSON.parse(fs.readFileSync(path.join(TRACES, name), 'utf8'));
    const trace = data.trace;
    let scenarioDiffs = 0, firstBad = -1;

    const world = {
      entities: trace[0].entities.map((record) => record.slice()),
      fracX: trace[0].fracX, fracY: trace[0].fracY,
      pass: trace[0].pass, frame: trace[0].frames,
      level: trace[0].level, startDelay: trace[0].delay,
      accel: 0, player: trace[0].player,
      lives: trace[0].lives.slice(), score: [0, 0],
      platforms: platforms,
      places: gfx.panel ? null : null,
      players: 1,
      templates: {
        jetman: globalData.templates.jetman,
        enemy: globalData.templates.enemy,
        fuel: globalData.templates.fuel,
        treasure: globalData.templates.treasure
      },
      enemyByLevel: globalData.enemyByLevel,
      randomState: trace[0].random,
      nextRandom: () => trace[0].random,
      controls: trace[0].controls,
      events: []
    };
    // místa, kde se věci zhmotňují ($6620) — vytažená z originálu
    world.places = gfx.spawnPlaces || [8, 32, 40, 48, 56, 64, 88, 96,
                                       120, 128, 136, 192, 224, 8, 88, 96];

    // ★ poslední zapsaná pozice krátkého kola může patřit **až dalšímu
    // průchodu**: záznam končí zastavením na slotu 6, a když se snímek
    // překlopil zrovna tam, je to už kolo toho dalšího. Pozná se to podle
    // toho, že číslo slotu klesne.
    let carry = [];
    for (let index = 1; index < trace.length; index++) {
      const before = trace[index-1], after = trace[index];
      world.controls = after.controls;
      world.randomState = before.random;
      // ★ $69C7 posune stav náhody **až po smyčce entit**, takže to, co se
      // dosazuje, je hodnota z následujícího záznamu
      world.nextRandom = () => after.random;
      world.pass = before.pass;
      world.frame = before.frames;
      world.level = before.level;
      world.startDelay = before.delay;
      world.player = before.player;
      world.lives = before.lives.slice();

      // ★ kolik krátkých kol v tom průchodu proběhlo, se pozná na počítadle:
      // každé kolo (krátké i dlouhé) ho zvedne o jedna ($69C7)
      const listed = carry.concat(after.roundsAt || []);
      const here = [];
      carry = [];
      listed.forEach((round) => {
        if (carry.length || (here.length && round.slot < here[here.length-1].slot)) {
          carry.push(round);
        } else {
          here.push(round);
        }
      });
      // ★ kolik krátkých kol proběhlo, říká seznam jejich pozic — je to
      // přímé měření, ne odvození z počítadla
      WorldEntities.pass(world, here.length, here.slice());

      for (let slot = 0; slot < 17; slot++) {
        if (slotFilter && slotFilter.indexOf(slot) === -1) {
          continue;
        }
        for (let byte = 0; byte < 8; byte++) {
          checks++;
          if (world.entities[slot][byte] !== after.entities[slot][byte]) {
            diffs++; scenarioDiffs++;
            bySlot[slot] = (bySlot[slot] || 0) + 1;
            if (firstBad < 0) { firstBad = index; }
            if (verbose && scenarioDiffs < 25) {
              console.log('   průchod %d, %s (slot %d) %s: náš %d, originál %d',
                          index, SLOT_NAMES[slot], slot, BYTE_NAMES[byte],
                          world.entities[slot][byte], after.entities[slot][byte]);
            }
          }
        }
      }
      // ★ dosadit stav originálu a jet dál
      world.entities = after.entities.map((record) => record.slice());
      world.fracX = after.fracX;
      world.fracY = after.fracY;
    }
    console.log((data.scenario+'  ').padEnd(14)
                + String(trace.length-1).padStart(4) + ' průchodů   '
                + String(scenarioDiffs).padStart(6) + ' rozdílů'
                + (firstBad >= 0 ? '   (první v průchodu '+firstBad+')' : ''));
  });

  if (Object.keys(bySlot).length) {
    console.log('\nrozdíly po slotech:');
    Object.keys(bySlot).sort((a, b) => bySlot[b]-bySlot[a]).forEach((slot) => {
      console.log('   ' + (SLOT_NAMES[slot]+'  ').padEnd(12) + String(bySlot[slot]).padStart(6));
    });
  }
  console.log('\n' + files.length + ' scénářů, ' + checks + ' kontrol, **' + diffs + ' rozdílů**');
  process.exit(diffs ? 1 : 0);
}

main();
