#!/usr/bin/env node
/**
 * Kolik kol originál stihne za snímek — spočítané ze záznamů v `build/entities`.
 *
 *   ./tools/cadence.js
 *
 * ★ Hra má **dvě kola** a je potřeba je rozlišovat, protože běží každé jinak
 * často (`sources/docs/disasm_notes.md` §3b):
 *
 * - **krátké kolo** (`$5D00`–`$5D28`: Jetman, čtyři střely, zvuk) proběhne
 *   vždycky, když se změní `FRAMES` — tedy **jednou za snímek**,
 * - **dlouhé kolo** (`$5D30` a výš: raketa, předměty, nepřátelé) proběhne,
 *   kdykoli Z80 stihne další obrátku hlavní smyčky.
 *
 * A **počítadlo `$5DCC` se zvedne na konci obojího** (`$69C7`), takže
 * „průchodů za snímek" podle počítadla je součet obou a **není to kadence
 * světa**. Tenhle nástroj to počítá odděleně, každé zvlášť, a jeho číslo je
 * to, co `app/gameWorker.js` dosazuje do `LONG_ROUNDS_PER_FRAME`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TRACES = path.join(__dirname, '..', 'build/entities');

function main() {
  if (!fs.existsSync(TRACES)) {
    console.error('chybí záznamy v build/entities — spusť tools/traceentities.py');
    process.exit(2);
  }
  const files = fs.readdirSync(TRACES).filter((name) => name.endsWith('.json')).sort();
  let frames = 0, longRounds = 0, shortRounds = 0, counter = 0;

  console.log('scénář     snímků  dlouhých  krátkých  počítadlo   dlouhých/snímek');
  files.forEach((name) => {
    const trace = JSON.parse(fs.readFileSync(path.join(TRACES, name), 'utf8')).trace;
    const first = trace[0], last = trace[trace.length-1];
    const f = last.frames-first.frames;
    const long = trace.length-1;
    const short = trace.reduce((sum, item) => sum+(item.roundsAt ? item.roundsAt.length : 0), 0);
    const count = last.pass-first.pass;
    frames += f; longRounds += long; shortRounds += short; counter += count;
    console.log(name.replace('.json', '').padEnd(10)
                + String(f).padStart(6) + String(long).padStart(10)
                + String(short).padStart(10) + String(count).padStart(11)
                + (long/f).toFixed(3).padStart(18));
  });

  console.log('\ncelkem     ' + String(frames).padStart(5) + String(longRounds).padStart(10)
              + String(shortRounds).padStart(10) + String(counter).padStart(11)
              + (longRounds/frames).toFixed(3).padStart(18));
  console.log('\nkrátkých kol na snímek:  %s   (mělo by být 1 — je to definice)',
              (shortRounds/frames).toFixed(3));
  console.log('dlouhých kol na snímek:  %s   <- tohle patří do LONG_ROUNDS_PER_FRAME',
              (longRounds/frames).toFixed(3));
  console.log('počítadlo $5DCC/snímek:  %s   (součet obou, kadence světa to NENÍ)',
              (counter/frames).toFixed(3));
}

main();
