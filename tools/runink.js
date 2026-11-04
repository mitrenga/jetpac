#!/usr/bin/env node
/**
 * Hlídá **barevnou rovinu** (`ZXVideoRAM.inkPlane`), kterou se kreslí od
 * 2026-09-18: barva po pixelech místo po buňkách 8×8 (`ZADANI.md` §10/5).
 *
 *   ./tools/runink.js [--scenario idle] [--verbose]
 *
 * Nástroj měří dvě věci, a ta první je ta důležitá:
 *
 * 1. ★ **Se zapnutou rovinou se nesmí změnit ani bajt.** Pouští se týž
 *    přírůstkový průlet jako `tools/matchtrail.js` — `stepInto()` průchod po
 *    průchodu proti videopaměti originálu, celých 6912 bajtů — jenom
 *    s `enableInkPlane(true)`. Když tohle hlásí nulu, je rovina opravdu jen
 *    **vedle** paměti a všechny ostatní `match*` platí dál.
 *
 * 2. Kolik pixelů ta rovina skutečně přebarvuje, tedy kolik jich v originálu
 *    padlo za oběť atributu sousedního objektu. To je míra toho, co je vidět;
 *    nula by znamenala, že se rovina neplní a přepínač nic nedělá.
 *
 * 3. ★ **Ukazatel paliva na raketě.** Ten průlety neprojde — ve všech
 *    scénářích `build/entities/` stojí raketa s `flags 1` a **prázdná**, takže
 *    ukazatel se v nich nikdy nenakreslí. Je to přesně ten druh díry, který
 *    `CLAUDE.md` popisuje: `match*` měří port na záznamech, které existují.
 *    Proto se skládá ručně (`checkGauge`): raketa se třemi díly a palivem, na
 *    jejíž buňky se pak pustí cizí barva — a ukazatel to musí přežít.
 *
 * Záznam dělá `tools/traceentities.py --screens`, stejně jako u matchtrail.
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

  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const gfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sprites.json'), 'utf8'));
  const fontData = fs.readFileSync(path.join(ROOT, 'app/svision/fonts/zx-rom.ch8.hex.txt'),
                                   'utf8').trim();
  const composer = new ScreenComposer(gfx, {chars: FONT_CHARS, data: fontData});

  if (!fs.existsSync(SCREENS)) {
    console.error('chybí build/screens — spusť tools/traceentities.py --screens');
    process.exit(2);
  }
  const names = only ? [only]
    : fs.readdirSync(SCREENS)
        .filter((name) => fs.existsSync(path.join(STATES, name+'.json'))).sort();

  let passes = 0, checks = 0, diffs = 0, painted = 0, recoloured = 0, worst = 0;
  names.forEach((name) => {
    const result = replay(name, composer, ZXVideoRAM, verbose);
    passes += result.passes;
    checks += result.checks;
    diffs += result.diffs;
    painted += result.painted;
    recoloured += result.recoloured;
    worst = Math.max(worst, result.worst);
    console.log('%s %s průchodů, %s kontrol, %s rozdílů,  přebarveno %s pixelů '
                + '(%s%% svítících), nejvíc %d v průchodu',
                name.padEnd(9), String(result.passes).padStart(4),
                String(result.checks).padStart(9), String(result.diffs).padStart(6),
                String(result.recoloured).padStart(8),
                (100*result.recoloured/Math.max(1, result.painted)).toFixed(1).padStart(5),
                result.worst);
  });

  console.log('\n%d scénářů, %d kontrol videopaměti, **%d rozdílů**',
              names.length, checks, diffs);
  console.log('barevná rovina přebarvila %d z %d svítících pixelů (%s %%)',
              recoloured, painted, (100*recoloured/Math.max(1, painted)).toFixed(2));

  const gauge = checkGauge(composer, ZXVideoRAM);
  console.log('\nukazatel paliva: %d kontrol, **%d rozdílů**%s',
              gauge.checks, gauge.diffs, gauge.diffs ? '' : '   (a bez roviny '
              + 'by jich bylo ' + gauge.clash + ' — to je ten clash, o který jde)');
  process.exit(diffs + gauge.diffs ? 1 : 0);
} // main

/** Skóre je v záznamu po bajtech BCD, stejně jako v $5DB4. */
function bcd(scores, which) {
  const bytes = (scores || [])[which];
  if (!bytes) {
    return 0;
  }
  return bytes.reduce((value, byte) => value*100 + (byte >> 4)*10 + (byte & 0x0F), 0);
} // bcd

/**
 * Kolik pixelů se v tomhle snímku kreslí jinou barvou, než jakou by jim dala
 * ULA. Svítící pixel bez majitele bere barvu buňky — ten se nepočítá; svítící
 * pixel s majitelem se počítá jen tehdy, když se jeho inkoust od buňky liší,
 * protože jinak by na obrazovce nebyl rozdíl vidět.
 */
function measure(videoRAM, ZXVideoRAM) {
  const plane = videoRAM.inkPlane;
  const bytes = videoRAM.bytes;
  let lit = 0, changed = 0;
  for (let line = 0; line < ZXVideoRAM.HEIGHT; line++) {
    const bitmapAt = ZXVideoRAM.lineOffset(line);
    const attrAt = ZXVideoRAM.ATTRIBUTES_OFFSET+(line >> 3)*ZXVideoRAM.COLS;
    for (let col = 0; col < ZXVideoRAM.COLS; col++) {
      const bits = bytes[bitmapAt+col];
      if (!bits) {
        continue;
      }
      const attr = bytes[attrAt+col];
      const cell = (attr & 0x07) | ((attr & 0x40) ? 0x08 : 0);
      for (let bit = 0; bit < 8; bit++) {
        if (!((bits >> (7-bit)) & 1)) {
          continue;
        }
        lit++;
        const own = plane[line*ZXVideoRAM.WIDTH+col*8+bit];
        if (own && ((own & 0x0F) !== cell)) {
          changed++;
        }
      }
    }
  }
  return {lit: lit, changed: changed};
} // measure

/**
 * ★ **Ukazatel paliva musí přežít cizí barvu v buňce.**
 *
 * Raketa je jediná věc na obrazovce, jejíž barvu nenese její záznam: `$6768`
 * ji počítá ze svého stavu — modrá po hladinu paliva, bílá nad ní, a přes
 * `$5DCC` bliká. Dlouho to vypadalo, že se proto musí kreslit **bez
 * majitele**; jenže tím zůstala vydaná napospas každému, kdo jí přeletí přes
 * buňku. Správně je dát peru **tu barvu, kterou by buňka dostala**
 * (`rocketInkAt`), a ukazatel tím ztvrdne.
 *
 * Kontrola: raketa se třemi díly a palivem, pak se jí přes buňky pustí cizí
 * atribut (`$45`, jako by tudy proletěl nepřítel) — a každý svítící pixel
 * rakety musí pořád mít inkoust svého pásma ukazatele. Pro srovnání se totéž
 * počítá bez roviny; tam ukazatel zmizí a to je přesně to, co se opravuje.
 */
function checkGauge(composer, ZXVideoRAM) {
  const result = {checks: 0, diffs: 0, clash: 0};
  const x = 0x60, STRANGER = 0x45;                // jasná azurová přes buňky
  // ★ **A y, které nesedí na buňku.** Na zemi stojí raketa na `$B7`, tedy na
  // posledním řádku buňky, a ukazatel (`pieces*2` řádků buněk) ji přesně
  // pokryje. Jakmile se zvedne, přečnívá **špička** do buňky, kam ukazatel
  // nedosáhne — a to je ta špička, která se v originále obarvuje tím, co
  // po sobě nechal poslední, kdo tudy proletěl (`ZADANI.md` §10/7).
  const YS = [0xB8, 0xB7, 0xB6, 0xB3, 0xB0, 0x80];
  // tři díly, palivo 0..6 a obě fáze blikání
  [0, 1, 3, 5, 6].forEach((fuel) => {
    [0x00, 0x10].forEach((pass) => {
      YS.forEach((y) => {
      const entity = {type: 9, x: x, y: y, attr: 0x47, flags: 3,
                      raw: [9, x, y, 0x47, 3, fuel, 0, 0]};
      [true, false].forEach((withPlane) => {
        const vram = new ZXVideoRAM();
        vram.enableInkPlane(withPlane);
        composer.clearScreen(vram);
        composer.drawRocket(vram, entity, 0, pass);
        // a teď tudy někdo proletí a obarví si buňky po svém
        for (let row = 0; row < ZXVideoRAM.ROWS; row++) {
          for (let cell = 0; cell < 2; cell++) {
            vram.pokeAttribute(row, ((x >> 3) + cell) & 0x1F, STRANGER);
          }
        }
        const rgba = new Uint8ClampedArray(ZXVideoRAM.WIDTH*ZXVideoRAM.HEIGHT*4);
        vram.paint(rgba, false);
        const palette = ZXVideoRAM.PALETTE;
        for (let line = 0; line < ZXVideoRAM.HEIGHT; line++) {
          const bitmapAt = ZXVideoRAM.lineOffset(line);
          for (let col = (x >> 3); col < (x >> 3) + 2; col++) {
            const bits = vram.bytes[bitmapAt+col];
            for (let bit = 0; bit < 8; bit++) {
              if (!((bits >> (7-bit)) & 1)) {
                continue;
              }
              const want = composer.rocketInkAt(entity, pass, line);
              if (want === null) {
                // ★ Žádný bod rakety nesmí zůstat bez majitele — to je přesně
                // ta obarvená špička. Dřív se tu pokračovalo dál a kontrola
                // ji míjela.
                result.checks++;
                result.diffs++;
                if (result.diffs < 4) {
                  console.log('   palivo %d, pass $%s, y $%s, řádek %d: '
                              + 'bod rakety bez barvy (špička)',
                              fuel, pass.toString(16), y.toString(16), line);
                }
                continue;
              }
              const ink = palette[(want & 0x07) | ((want & 0x40) ? 8 : 0)];
              const at = (line*ZXVideoRAM.WIDTH+col*8+bit)*4;
              const same = rgba[at] === ink[0] && rgba[at+1] === ink[1]
                           && rgba[at+2] === ink[2];
              if (withPlane) {
                result.checks++;
                if (!same) {
                  result.diffs++;
                  if (result.diffs < 4) {
                    console.log('   palivo %d, pass $%s, řádek %d: '
                                + 'čekáno $%s, na obrazovce rgb(%d,%d,%d)',
                                fuel, pass.toString(16), line,
                                want.toString(16), rgba[at], rgba[at+1], rgba[at+2]);
                  }
                }
              } else if (!same) {
                result.clash++;
              }
            }
          }
        }
      });
      });
    });
  });
  return result;
} // checkGauge

function replay(name, composer, ZXVideoRAM, verbose) {
  const screens = path.join(SCREENS, name);
  const trace = JSON.parse(fs.readFileSync(path.join(STATES, name+'.json'), 'utf8')).trace;
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
  // ★ Tady je celý rozdíl proti matchtrail.js: paměť si drží barevnou rovinu.
  // Výchozí obrazovka je z originálu, takže v ní zatím žádný pixel majitele
  // nemá — plní se teprve tím, co composer nakreslí.
  const videoRAM = new ZXVideoRAM(fs.readFileSync(path.join(screens, '00000.scr')));
  videoRAM.enableInkPlane(true);

  const result = {passes: 0, checks: 0, diffs: 0, painted: 0, recoloured: 0, worst: 0};
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
    result.diffs += bad;
    const seen = measure(videoRAM, ZXVideoRAM);
    result.painted += seen.lit;
    result.recoloured += seen.changed;
    result.worst = Math.max(result.worst, seen.changed);
    result.passes++;
  }
  return result;
} // replay

main();
