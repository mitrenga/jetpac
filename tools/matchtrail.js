#!/usr/bin/env node
/**
 * Porovná **přírůstkové kreslení** s originálem: obrazovku po obrazovce,
 * průchod po průchodu, celých 6912 bajtů.
 *
 *   ./tools/matchtrail.js [--scenario idle] [--verbose] [--dump N]
 *
 * `tools/matchscreen.js` skládá obrázek celý znovu z jednoho stavu — to sedí
 * na obrazovce začátku života, ale ne uprostřed hry, protože ★ **originál
 * atributy nikdy nemaže**: obrazovku vyčistí jednou za kolo (`$608A`) a barvy,
 * kterými si entity obarvují buňky, na ní **zůstanou** jako stopa toho, kudy
 * kdo letěl.
 *
 * Tenhle nástroj proto pouští `ScreenComposer.stepInto()`, tedy to, co dělá
 * originál: každou entitu **smaže tam, kde byla, a nakreslí tam, kde je**
 * (`$726A`). Začne se videopamětí originálu z prvního průchodu a dál se
 * počítá jen naším kódem; po každém kroku se porovná celá videopaměť.
 *
 * Záznam dělá `tools/traceentities.py --screens`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const STATES = path.join(ROOT, 'build/entities');
const SCREENS = path.join(ROOT, 'build/screens');
const FONT_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_£abcdefghijklmnopqrstuvwxyz{|}~©';

async function main() {
  const verbose = process.argv.includes('--verbose');
  const only = process.argv.includes('--scenario')
    ? process.argv[process.argv.indexOf('--scenario')+1] : null;
  const dumpAt = process.argv.includes('--dump')
    ? parseInt(process.argv[process.argv.indexOf('--dump')+1], 10) : -1;

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const gfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sprites.json'), 'utf8'));
  const fontData = fs.readFileSync(path.join(ROOT, 'app/svision/fonts/zx-rom.ch8.hex.txt'),
                                   'utf8').trim();

  if (!fs.existsSync(SCREENS)) {
    console.error('chybí obrazovky v build/screens — spusť tools/traceentities.py --screens');
    process.exit(2);
  }
  const names = only ? [only]
    : fs.readdirSync(SCREENS).filter((name) => fs.existsSync(path.join(STATES, name+'.json'))).sort();

  let checks = 0, diffs = 0;
  names.forEach((name) => {
    const result = replay(name, new ScreenComposer(gfx, {chars: FONT_CHARS, data: fontData}),
                          ZXVideoRAM, verbose, dumpAt);
    checks += result.checks;
    diffs += result.diffs;
    console.log(name.padEnd(8) + String(result.passes).padStart(5) + ' průchodů, '
                + String(result.checks).padStart(8) + ' kontrol, '
                + String(result.diffs).padStart(6) + ' rozdílů'
                + (result.firstBad >= 0
                   ? '   (první v průchodu '+result.firstBad+', nejhorší snímek '+result.worst+' B)'
                   : ''));
  });

  console.log('\n' + names.length + ' scénářů, ' + checks + ' kontrol, **' + diffs + ' rozdílů**');
  process.exit(diffs ? 1 : 0);
} // main

/**
 * Přehraje jeden scénář: začne videopamětí originálu z prvního průchodu
 * a dál kreslí jen `ScreenComposer.stepInto()`.
 * @param {string} name - Jméno scénáře.
 * @param {ScreenComposer} composer - Skládač obrazovky.
 * @param {Function} ZXVideoRAM - Třída videopaměti.
 * @param {boolean} verbose - Vypisovat jednotlivé rozdíly.
 * @param {number} dumpAt - Uložit náš obraz po tomhle průchodu.
 * @returns {Object} {passes, checks, diffs, worst, firstBad}
 */
/**
 * Skóre originálu je **BCD po třech bajtech** ($7107 sčítá s `DAA`).
 * @param {number[][]} scores - Trojice záznamů ze stopy.
 * @param {number} which - 0 hráč, 1 druhý hráč, 2 nejvyšší.
 * @returns {number} Číslo, jak ho čeká panel.
 */
function bcd(scores, which) {
  const bytes = (scores || [])[which];
  if (!bytes) {
    return 0;
  }
  return bytes.reduce((value, byte) => value*100 + (byte >> 4)*10 + (byte & 0x0F), 0);
} // bcd

function replay(name, composer, ZXVideoRAM, verbose, dumpAt) {
  const screens = path.join(SCREENS, name);
  const trace = JSON.parse(fs.readFileSync(path.join(STATES, name+'.json'), 'utf8')).trace;
  // ★ Kde se do dlouhého kola vklínilo to krátké. `roundsAt` je zapsané tak,
  // jak to šlo číst ze simulátoru: poslední položka, která nejde dál než ta
  // před ní, je už **zaobalená do dalšího průchodu** — snímek se překlopil
  // přesně na hranici a krátké kolo poběží až po ní. Tady se přehodí tam,
  // kam patří, protože na pořadí kreslení závisí barvy.
  const shortRounds = [], shortStates = [];
  let carry = null;
  trace.forEach((item, index) => {
    const valid = [], states = [];
    let sofar = -1, trailing = null;
    (item.roundsAt || []).forEach((round) => {
      const position = round.slot - 6;
      if (position < 0 || position < sofar) {
        trailing = round;
        return;
      }
      sofar = position;
      valid.push(round.slot);
      states.push(round.entities);
    });
    shortRounds[index] = (carry ? [6] : []).concat(valid);
    shortStates[index] = (carry ? [carry.entities] : []).concat(states);
    carry = trailing;
  });
  const entity = (record, slot) => ({
    slot: slot, type: record[0] & 0x3F, left: !!(record[0] & 0x40),
    x: record[1], y: record[2], attr: record[3], flags: record[4], raw: record
  });
  const frame = (index) => ({
    entities: trace[index].entities.map(entity),
    level: trace[index].level,
    pass: trace[index].pass,
    shortRounds: shortRounds[index],
    // ★ záznam slotů 0–5 po každém krátkém kole — ve tvaru snímku, aby
    // se dal předat stejným cestou jako celý stav
    shortStates: (shortStates[index] || []).map((records) => records && {
      entities: records.map(entity),
      level: trace[index].level, pass: trace[index].pass,
      startDelay: trace[index].delay
    }),
    startDelay: trace[index].delay,
    panel: {score: bcd(trace[index].scores, 0), score2: bcd(trace[index].scores, 1),
            hiScore: bcd(trace[index].scores, 2),
            lives: trace[index].lives[0], lives2: trace[index].lives[1],
            player: trace[index].player}
  });

  composer.prepareLevel(trace[0].level || 0, 0x08);
  const videoRAM = new ZXVideoRAM(fs.readFileSync(path.join(screens, '00000.scr')));

  const result = {passes: 0, checks: 0, diffs: 0, worst: 0, firstBad: -1};
  for (let index = 1; index < trace.length; index++) {
    const file = path.join(screens, String(index).padStart(5, '0')+'.scr');
    if (!fs.existsSync(file)) {
      break;
    }
    composer.stepInto(videoRAM, frame(index), frame(index-1));
    const original = fs.readFileSync(file);
    let bad = 0;
    for (let byte = 0; byte < ZXVideoRAM.BYTES; byte++) {
      result.checks++;
      if (videoRAM.bytes[byte] !== original[byte]) {
        bad++;
        if (verbose && bad < 6) {
          console.log('   %s průchod %d $%s: náš $%s, originál $%s', name, index,
                      (0x4000+byte).toString(16).toUpperCase(),
                      videoRAM.bytes[byte].toString(16).padStart(2, '0'),
                      original[byte].toString(16).padStart(2, '0'));
        }
      }
    }
    if (bad && result.firstBad < 0) {
      result.firstBad = index;
    }
    result.worst = Math.max(result.worst, bad);
    result.diffs += bad;
    result.passes++;
    if (index === dumpAt) {
      fs.writeFileSync(path.join(screens, 'ours.scr'), Buffer.from(videoRAM.bytes));
      console.log('   uloženo build/screens/'+name+'/ours.scr (průchod '+index+')');
    }
  }
  return result;
} // replay

main();
