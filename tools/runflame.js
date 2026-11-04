#!/usr/bin/env node
/**
 * Hlídá **oheň z trysek po celou dobu odletu a přistání**
 * (`ZADANI.md` §10/6, vědomá odchylka od `$6669`).
 *
 *   ./tools/runflame.js [--verbose]
 *
 * Originál plamen u země zhasíná (`$667B`: `CP $B8`), a nezhasíná ho kvůli
 * vzhledu — plume visí `$15` pod raketou, takže by se kreslil **do spodní
 * plošiny** a maska, která ho příště smaže, by z plošiny vykousala body.
 * Přesně to udělala koule na druhé planetě (`tools/runplanets.js`).
 *
 * Remake ho proto nechává hořet celou animaci, ale **ořízne ho o linii
 * podlahy** — a tenhle nástroj je doklad, že ten ořez drží. Prolétne se celý
 * vzlet (`$B7` → `$28`) i přistání, kolo po kole, tak jak to dělá
 * `ScreenComposer.stepSlot()`, a po každém kole se kontroluje:
 *
 * 1. **podlaha je nedotčená** — řádky plošiny bod po bodu proti tomu, co tam
 *    nakreslilo `drawPlatforms()`, a to i v barvě,
 * 2. **za plamenem nezůstává stopa** — celá bitmapa se porovná se snímkem
 *    složeným od nuly, takže se pozná jediný nesmazaný řádek,
 * 3. **plamen opravdu hoří** — je vidět v každém kole, ve kterém z něj aspoň
 *    řádek vyčnívá nad podlahu.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const FONT_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_£abcdefghijklmnopqrstuvwxyz{|}~©';
const ROCKET_X = 0xA8;          // kde raketa stojí ($60CD)
const GROUND = 0xB7;            // y rakety na zemi
const TOP = 0x28;               // $66D6: nad tímhle je kolo hotové

async function main() {
  const verbose = process.argv.includes('--verbose');
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

  const rocket = (y, type) => ({type: type, x: ROCKET_X, y: y, attr: 0x47,
                                flags: 3, raw: [type, ROCKET_X, y, 0x47, 0, 0, 0, 0]});

  /** podlaha tak, jak ji nakreslí drawPlatforms() — a nic jiného */
  const floor = new ZXVideoRAM();
  composer.clearScreen(floor);
  composer.drawPlatforms(floor);

  let checks = 0, floorDiffs = 0, trailDiffs = 0, missing = 0, flaming = 0;
  const report = (text) => { if (verbose) { console.log('   ' + text); } };

  const fly = (name, from, to, step, type) => {
    const videoRAM = new ZXVideoRAM();
    composer.clearScreen(videoRAM);
    composer.drawPlatforms(videoRAM);
    composer.drawRocket(videoRAM, rocket(from, type), 0, 0);
    let was = rocket(from, type), rounds = 0;
    for (let y = from+step; step < 0 ? y >= to : y <= to; y += step) {
      const is = rocket(y, type);
      const pass = (rounds*2) & 0xFF;            // $5DCC roste s oběma koly
      composer.blitRocket(videoRAM, was, 0, 'and');
      composer.drawFlame(videoRAM, was, is, pass);
      composer.drawRocket(videoRAM, is, 0, pass);
      rounds++;

      // 1. podlaha
      for (let row = ScreenComposer.FLAME_GROUND; row < 192; row++) {
        for (let column = 0; column < 32; column++) {
          const at = ZXVideoRAM.addressOf(column*8, row);
          checks++;
          if (videoRAM.peek(at.h, at.l) !== floor.peek(at.h, at.l)) {
            floorDiffs++;
            report(name+' y='+y+': podlaha rozbitá na ['+column+','+row+']');
          }
          // ★ a barva taky: $71CF klade celé buňky, takže neoříznuté
          // obarvení plamene by podlahu přebarvilo, i kdyby se jí body
          // nedotkly
          if ((row & 0x07) === 0) {
            checks++;
            if (videoRAM.peekAttribute(row >> 3, column)
                !== floor.peekAttribute(row >> 3, column)) {
              floorDiffs++;
              report(name+' y='+y+': barva podlahy na ['+column+','+(row>>3)+']');
            }
          }
        }
      }

      // 2. stopa: bitmapa proti snímku složenému od nuly
      const fresh = new ZXVideoRAM();
      composer.clearScreen(fresh);
      composer.drawPlatforms(fresh);
      composer.drawFlame(fresh, null, is, pass);
      composer.drawRocket(fresh, is, 0, pass);
      let lit = 0;
      for (let row = 0; row < 192; row++) {
        for (let column = 0; column < 32; column++) {
          const at = ZXVideoRAM.addressOf(column*8, row);
          const ours = videoRAM.peek(at.h, at.l), want = fresh.peek(at.h, at.l);
          checks++;
          if (ours !== want) {
            trailDiffs++;
            report(name+' y='+y+': stopa na ['+column+','+row+'] '+ours+' != '+want);
          }
          if (row < ScreenComposer.FLAME_GROUND && (column === (ROCKET_X>>3)
              || column === ((ROCKET_X>>3)+1)) && row > y) {
            lit |= want;                          // pod raketou = plamen
          }
        }
      }

      // 3. hoří tam, kde má
      const shouldBurn = ((y + 0x15) & 0xFF) - 14 < ScreenComposer.FLAME_GROUND;
      checks++;
      if (shouldBurn && !lit) {
        missing++;
        report(name+' y='+y+': plamen chybí, a přitom má vyčnívat nad podlahu');
      }
      if (lit) {
        flaming++;
      }
      was = is;
    }
    console.log('%s %s kol, hoří v %s z nich (od y=%d)',
                name.padEnd(9), String(rounds).padStart(4), String(flaming).padStart(4),
                from);
    flaming = 0;
  };

  fly('vzlet', GROUND, TOP, -1, 10);
  fly('přistání', TOP, GROUND, +1, 11);

  console.log('\npodlaha, stopa i hoření: %d kontrol, **%d rozdílů**',
              checks, floorDiffs + trailDiffs + missing);
  if (floorDiffs || trailDiffs || missing) {
    console.log('   podlaha %d, stopa %d, chybějící plamen %d',
                floorDiffs, trailDiffs, missing);
  }
  process.exit((floorDiffs + trailDiffs + missing) ? 1 : 0);
}

main();
