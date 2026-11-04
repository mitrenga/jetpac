#!/usr/bin/env node
/**
 * Porovná beeper remaku s originálem **pulz po pulzu**.
 *
 *   ./tools/matchsound.js [--verbose]
 *
 * Pouští `app/beeper.js`, tedy kód, který jde do prohlížeče, a proti němu
 * staví záznamy z `build/sounds/*.json` (`tools/tracesound.py` zavolá zvukové
 * rutiny přímo v simulátoru a vyčte, kdy se hnul bit 4 portu `$FE`).
 *
 * Porovnává se **délka každého pulzu v T-stavech**, ne zvuk „na poslech":
 * kdyby se remake spletl o jednu iteraci `DJNZ`, byl by to jiný tón, a tohle
 * to ukáže.
 *
 * Akceptační kritérium M6: nula rozdílů.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const TRACES = path.join(ROOT, 'build/sounds');

async function main() {
  const verbose = process.argv.includes('--verbose');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { Beeper } = await import(url.pathToFileURL(path.join(ROOT, 'app/beeper.js')).href);

  const sounds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sounds.json'), 'utf8'));
  const beeper = new Beeper(sounds);

  if (!fs.existsSync(TRACES)) {
    console.error('chybí záznamy v build/sounds — spusť tools/tracesound.py');
    process.exit(2);
  }
  const files = fs.readdirSync(TRACES).filter((name) => name.endsWith('.json')).sort();

  let checks = 0, diffs = 0;
  files.forEach((name) => {
    const data = JSON.parse(fs.readFileSync(path.join(TRACES, name), 'utf8'));
    const run = beeper.effect(data.sound,
                              {b: data.b, y: data.rocketY, c: data.c});
    const ours = Beeper.pulses(run, data.speaker);
    const theirs = data.pulses;
    let bad = 0;
    const count = Math.max(ours.length, theirs.length);
    for (let index = 0; index < count; index++) {
      checks++;
      if (ours[index] !== theirs[index]) {
        bad++;
        if (verbose && bad < 8) {
          console.log('   %s pulz %d: náš %s, originál %s', data.sound, index,
                      ours[index], theirs[index]);
        }
      }
    }
    diffs += bad;
    console.log((data.sound+'  ').padEnd(14)
                + String(theirs.length).padStart(4) + ' pulzů originálu, '
                + String(ours.length).padStart(4) + ' našich, '
                + String(bad).padStart(4) + ' rozdílů');
  });

  console.log('\n' + files.length + ' zvuků, ' + checks + ' kontrol, **' + diffs + ' rozdílů**');
  process.exit(diffs ? 1 : 0);
}

main();
