#!/usr/bin/env node
/**
 * Porovná **šourání po kraji plošiny** se záznamem z běžícího originálu.
 *
 *   ./tools/matchwalk.js [--verbose]
 *
 * Záznam dělá `tools/tracewalk.py`: Jetmanovi se předepíše záznam na každé
 * souřadnici napříč každou plošinou, pro oba směry pohledu, **bez držené
 * klávesy**, a nechá se proběhnout šest obsluh. Tady se totéž pustí portem
 * (`app/jetmanPhysics.js`, tedy kód, který jde do prohlížeče) a porovná se
 * celý osmibajtový záznam po každém kroku.
 *
 * ★ Co se tím hlídá: `$7597`. Na **kraji** plošiny (bit 3 z `$761D`, tedy
 * `|dx| + $12 >= šířka`) a jen tam jde Jetman sám dál tím směrem, kterým
 * kouká — a proto po puštění směrovky nezastaví, ale sejde z plošiny.
 * Uprostřed plošiny stojí. Hlásilo se to jako „neuvolní se klávesa";
 * je to originál a tenhle nástroj je ten doklad.
 *
 * Kritérium: **nula rozdílů**.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRACE = path.join(ROOT, 'build/walk.json');
const FIELDS = ['typ', 'x', 'y', 'attr', 'flags', '+5', '+6', 'výška'];
const NONE = {left: false, right: false, thrust: false, fire: false, brake: false};

function main() {
  const verbose = process.argv.includes('--verbose');

  const loadClassicScript = require(path.join(ROOT, 'app/svision/tools/classicScript.cjs'));
  const { JetmanPhysics } = loadClassicScript(path.join(ROOT, 'app/jetmanPhysics.js'));

  if (!fs.existsSync(TRACE)) {
    console.error('chybí build/walk.json — spusť tools/tracewalk.py');
    process.exit(2);
  }
  const trace = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
  const platforms = trace.platforms.filter((platform) => platform.flag);

  let checks = 0, diffs = 0, creeping = 0, standing = 0, fell = 0;
  trace.probes.forEach((probe) => {
    const record = [probe.faceLeft ? 0xC2 : 0x82, probe.x, probe.y, trace.attr,
                    probe.faceLeft ? 0x40 : 0x00, 0, 0, trace.height];
    const state = {record: record, fracX: 0, fracY: 0, accel: 0, frames: 0};
    probe.steps.forEach((expected, step) => {
      // vstupy kroku, jak je měl originál (viz tools/tracewalk.py)
      state.accel = expected.accel;
      state.frames = expected.frames;
      JetmanPhysics.step(state, NONE, platforms, {});
      for (var byte = 0; byte < 8; byte++) {
        checks++;
        if (state.record[byte] !== expected.record[byte]) {
          diffs++;
          if (verbose) {
            console.log('plošina %d x=%d %s krok %d: %s %d != %d',
                        probe.platform, probe.x, probe.faceLeft ? 'doleva' : 'doprava',
                        step, FIELDS[byte], state.record[byte], expected.record[byte]);
          }
        }
      }
      checks += 2;
      if (state.fracX !== expected.fracX) {
        diffs++;
        if (verbose) {
          console.log('plošina %d x=%d %s krok %d: zlomek x %d != %d',
                      probe.platform, probe.x, probe.faceLeft ? 'doleva' : 'doprava',
                      step, state.fracX, expected.fracX);
        }
      }
      if (state.fracY !== expected.fracY) {
        diffs++;
        if (verbose) {
          console.log('plošina %d x=%d %s krok %d: zlomek y %d != %d',
                      probe.platform, probe.x, probe.faceLeft ? 'doleva' : 'doprava',
                      step, state.fracY, expected.fracY);
        }
      }
      // ★ pokračuje se ze stavu originálu, ať se jedna odchylka nerozlije
      // do všech dalších kroků (stejně jako tools/matchphysics.js)
      state.record = expected.record.slice();
      state.fracX = expected.fracX;
      state.fracY = expected.fracY;
    });
    const last = probe.steps[probe.steps.length-1].record;
    if ((last[0] & 0x3F) === 1) {
      fell++;
    } else if (last[1] !== probe.x) {
      creeping++;
    } else {
      standing++;
    }
  });

  console.log('%d sond: %d stojí, %d se šourá po kraji, %d sejde z plošiny',
              trace.probes.length, standing, creeping, fell);
  console.log('šourání po kraji plošiny: %d kontrol, **%d rozdílů**', checks, diffs);
  process.exit(diffs ? 1 : 0);
}

main();
