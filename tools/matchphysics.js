#!/usr/bin/env node
/**
 * Porovná Jetmanovu fyziku **krok po kroku** se záznamem z běžícího originálu.
 *
 *   ./tools/matchphysics.js [--verbose] [--scenario jmeno]
 *
 * Pouští `app/jetmanPhysics.js`, tedy kód, který jde do prohlížeče, a proti
 * němu staví záznamy z `build/physics/*.json` (dělá je `tools/tracephysics.py`
 * krokováním originálu po obsluhách Jetmana).
 *
 * Porovnává se **deset bajtů na krok**: osm bajtů záznamu entity (`$5D00`)
 * a oba zlomky souřadnic (`$5DC7`, `$5DC8`). Zlomky jsou v tom proto, že
 * rychlost je v šestnáctinách pixelu — bez nich by „sedí to na pixel" nic
 * neznamenalo.
 *
 * Akceptační kritérium M3: **nula rozdílů**.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRACES = path.join(ROOT, 'build/physics');
const FIELDS = ['typ', 'x', 'y', 'attr', 'flags', '+5', '+6', 'výška'];

function main() {
  const verbose = process.argv.includes('--verbose');
  const only = process.argv.includes('--scenario')
    ? process.argv[process.argv.indexOf('--scenario')+1] : null;

  // app/jetmanPhysics.js je **klasický skript workeru** (žádný import ani
  // export), takže se načítá stejně jako v prohlížeči – přes shim svision
  const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
  const { JetmanPhysics } = loadClassicScript(path.join(ROOT, 'app/jetmanPhysics.js'));
  const gfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sprites.json'), 'utf8'));
  const platforms = gfx.platforms.filter((platform) => platform.flag);

  if (!fs.existsSync(TRACES)) {
    console.error('chybí záznamy v build/physics — spusť tools/tracephysics.py');
    process.exit(2);
  }
  let files = fs.readdirSync(TRACES).filter((name) => name.endsWith('.json')).sort();
  if (only) {
    files = files.filter((name) => name === only+'.json');
  }

  let checks = 0, diffs = 0, scenarios = 0;
  files.forEach((name) => {
    const data = JSON.parse(fs.readFileSync(path.join(TRACES, name), 'utf8'));
    const trace = data.trace;
    if (trace.length < 2) {
      return;
    }
    scenarios++;
    // začne se stavem, který měl originál v prvním kroku, a dál se počítá
    // jen naším kódem — kdyby se rozešel, je to hned vidět
    const state = {
      record: trace[0].record.slice(),
      fracX: trace[0].fracX,
      fracY: trace[0].fracY,
      delay: trace[0].delay,
      frames: trace[0].frames,
      accel: trace[0].accel
    };
    let scenarioDiffs = 0, firstBad = -1;
    for (let step = 1; step < trace.length; step++) {
      const before = trace[step-1], after = trace[step];
      // ★ Ovládání se bere z **cílového** záznamu, ne z výchozího: `hold()`
      // v tracephysics.py nastaví klávesy a teprve pak nechá originál krok
      // udělat, takže `controls` u záznamu jsou ty, které ten krok řídily.
      // Počítadlo průchodů je naopak vstup, tedy hodnota před krokem.
      state.frames = before.frames;
      state.accel = before.accel;
      JetmanPhysics.step(state, after.controls, platforms);
      for (let byte = 0; byte < 8; byte++) {
        checks++;
        if (state.record[byte] !== after.record[byte]) {
          diffs++; scenarioDiffs++;
          if (firstBad < 0) { firstBad = step; }
          if (verbose && scenarioDiffs < 12) {
            console.log('   krok %d %s: náš %d, originál %d',
                        step, FIELDS[byte], state.record[byte], after.record[byte]);
          }
        }
      }
      checks += 2;
      if (state.fracX !== after.fracX) {
        diffs++; scenarioDiffs++;
        if (firstBad < 0) { firstBad = step; }
        if (verbose && scenarioDiffs < 12) {
          console.log('   krok %d zlomek x: náš %d, originál %d', step, state.fracX, after.fracX);
        }
      }
      if (state.fracY !== after.fracY) {
        diffs++; scenarioDiffs++;
        if (firstBad < 0) { firstBad = step; }
        if (verbose && scenarioDiffs < 12) {
          console.log('   krok %d zlomek y: náš %d, originál %d', step, state.fracY, after.fracY);
        }
      }
      // ★ pokračuje se ze **stavu originálu**, ne z našeho: jinak by se jedna
      // odchylka rozlila do všech dalších kroků a nešlo by spočítat, kolik
      // jich doopravdy je
      state.record = after.record.slice();
      state.fracX = after.fracX;
      state.fracY = after.fracY;
      state.delay = after.delay;
    }
    console.log((data.scenario+'  ').padEnd(22)
                + String(trace.length-1).padStart(4) + ' kroků   '
                + String(scenarioDiffs).padStart(5) + ' rozdílů'
                + (firstBad >= 0 ? '   (první v kroku '+firstBad+')' : ''));
  });

  console.log('\n' + scenarios + ' scénářů, ' + checks + ' kontrol, **' + diffs + ' rozdílů**');
  process.exit(diffs ? 1 : 0);
}

main();
