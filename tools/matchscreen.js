#!/usr/bin/env node
/**
 * Porovná obrazovku složenou **skutečným kódem, který jde do prohlížeče**,
 * se snímkem videopaměti běžícího originálu, bajt po bajtu.
 *
 *   ./tools/matchscreen.js [--verbose] [--png build/matchscreen.png]
 *
 * Pouští `app/screenComposer.js`, tedy to, co obrazovku doopravdy kreslí,
 * a proti němu staví referenční snímky z `build/ref/` (dělá je
 * `tools/traceframes.py`: videopaměť originálu + záznam entit z `$5D00`
 * v témž okamžiku).
 *
 * Kontroluje se **všech 6912 bajtů**: 6144 bitmapy a 768 atributů. Glyfy
 * panelu se berou z tabulky svision (`app/svision/fonts/zx-rom.ch8.hex.txt`),
 * protože ★ hra vlastní znakovou sadu nemá — tiskne ROM fontem ZX Spectra
 * (`$714C` bere glyf z `CHARS`, `$5C36`). Tohle porovnání je zároveň důkaz
 * toho tvrzení: s jiným fontem by panel neseděl.
 *
 * ## Co je v rozsahu M1 a co ne
 *
 * ★ Originál **nemaže atributy**. Obrazovku vyčistí jednou, na začátku kola
 * (`$608A`), a od té chvíle si každá entita obarví buňky, přes které leze —
 * a ty barvy tam **zůstanou**, i když odejde. Po pár vteřinách hry je tedy na
 * obrazovce barevná stopa toho, kudy kdo letěl.
 *
 * `ScreenComposer.composeInto()` skládá obrázek **celý znovu** z jednoho
 * snímku, a to je přesné na obrazovce **na začátku života** (ta je čerstvě
 * vyčištěná), ne uprostřed hry — tam by musel znát celou historii. Tenhle
 * nástroj to proto rozdělí:
 *
 * - **v rozsahu** jsou snímky s běžícím odpočtem startu (`startDelay > 0`)
 *   — tam se čeká **nula rozdílů** a podle toho je návratový kód,
 * - **mimo rozsah** jsou snímky z rozehrané hry; jejich rozdíly se vypíšou
 *   jako informace a **nejsou to chyby**: je to přesně ta barevná stopa,
 *   kterou z jednoho snímku složit nejde.
 *
 * ★ Rozehranou hru měří `tools/matchtrail.js`: pouští
 * `ScreenComposer.stepInto()` průchod po průchodu, jak to dělá originál, a
 * porovnává celou videopaměť po každém z nich — a ta stopa v něm sedí.
 * Hru samotnou kreslí `app/gameAreaEntity.js` právě tou přírůstkovou cestou,
 * `composeInto()` je v ní jen pro první snímek.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, 'build/ref');
// znaková sada svision začíná mezerou; ZXFonts8x8.fontsChars je tentýž seznam
const FONT_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_£abcdefghijklmnopqrstuvwxyz{|}~©';

async function main() {
  const verbose = process.argv.includes('--verbose');
  global.atob = (data) => Buffer.from(data, 'base64').toString('binary');
  await import(url.pathToFileURL(path.join(ROOT, 'app/svision/tools/nodeEnv.mjs')).href);
  const { ScreenComposer } = await import(url.pathToFileURL(path.join(ROOT, 'app/screenComposer.js')).href);
  const { ZXVideoRAM } = await import(url.pathToFileURL(
    path.join(ROOT, 'app/svision/js/platform/canvas2D/zx/zxVideoRAM.js')).href);

  const gfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sprites.json'), 'utf8'));
  const fontData = fs.readFileSync(path.join(ROOT, 'app/svision/fonts/zx-rom.ch8.hex.txt'),
                                   'utf8').trim();
  const composer = new ScreenComposer(gfx, {chars: FONT_CHARS, data: fontData});

  if (!fs.existsSync(REF)) {
    console.error('chybí referenční snímky v build/ref — spusť tools/traceframes.py');
    process.exit(2);
  }
  const frames = fs.readdirSync(REF).filter((name) => name.endsWith('.json')).sort();
  if (!frames.length) {
    console.error('build/ref je prázdný — spusť tools/traceframes.py');
    process.exit(2);
  }

  let checks = 0, diffs = 0, scopeChecks = 0, scopeDiffs = 0;
  frames.forEach((name) => {
    const state = JSON.parse(fs.readFileSync(path.join(REF, name), 'utf8'));
    // co si hra předsunula do $5E00 dřív, než začala kreslit: nepřítel kola
    // a nesený díl rakety ($6929, $6EF9)
    const carried = (state.entities || [])
      .filter((entity) => entity.type === 4 && (entity.flags & 0x01))
      .map((entity) => entity.raw[6])[0];
    composer.prepareLevel(state.level || 0, carried);
    const original = fs.readFileSync(path.join(REF, name.replace(/\.json$/, '.scr')));
    const videoRAM = new ZXVideoRAM();
    composer.composeInto(videoRAM, state);
    const ours = videoRAM.bytes;

    let bitmap = 0, attributes = 0;
    for (let index = 0; index < ZXVideoRAM.BYTES; index++) {
      if (ours[index] !== original[index]) {
        if (index < ZXVideoRAM.BITMAP_BYTES) {
          bitmap++;
        } else {
          attributes++;
        }
        if (verbose && bitmap + attributes < 20) {
          console.log('   $%s: náš $%s, originál $%s',
                      (0x4000+index).toString(16).toUpperCase(),
                      ours[index].toString(16).padStart(2, '0'),
                      original[index].toString(16).padStart(2, '0'));
        }
      }
    }
    checks += ZXVideoRAM.BYTES;
    diffs += bitmap + attributes;
    // obrazovka na začátku života je čerstvě vyčištěná, takže složit ji celou
    // znovu je přesné; rozehraná hra nese barevnou stopu a čeká na M3
    const inScope = !!state.startDelay;
    if (inScope) {
      scopeChecks += ZXVideoRAM.BYTES;
      scopeDiffs += bitmap + attributes;
    }
    const alive = (state.entities || []).filter((entity) => entity && entity.type).length;
    console.log((name.replace(/\.json$/, '')+'  ').padEnd(16)
                + String(alive).padStart(2) + ' entit   bitmapa '
                + String(bitmap).padStart(5) + ' rozdílů, atributy '
                + String(attributes).padStart(4) + ' rozdílů'
                + (inScope ? '   [v rozsahu]' : '   [stopa, viz hlavička]'));
    if (process.argv.includes('--dump')) {
      fs.writeFileSync(path.join(REF, name.replace(/\.json$/, '.ours.scr')), Buffer.from(ours));
    }
  });

  // ★ Předsunutá paměť neseného předmětu ($5ECC): **padající i nesený**
  // předmět se kreslí odtud ($726A jde přes tabulku $76FA), ležící z $67C3
  // ($654B). Musí to tedy být **tentýž obrázek** — a nebyl: palivo se neslo
  // jako díl rakety, protože do paměti se nikdy nedosadilo nic jiného než to,
  // co tam dal začátek kola ($60DA). Záznamy v build/ref do fáze tankování
  // nedojdou, takže se to kontroluje takhle, na jednom předmětu.
  var carriedChecks = 0, carriedDiffs = 0;
  [0x08, 0x10, 0x18].forEach((offset) => {
    composer.prepareCarried(0, offset);
    var still = composer.itemRecord(0, offset);
    var moving = composer.spriteOf({type: 4, flags: 0x01, left: false, x: 0x80,
                                    raw: [4, 0x80, 0x40, 0x43, 1, 0, offset, 0x18]}, 0);
    for (var row = 0; row < still.height; row++) {
      for (var byte = 0; byte < still.width; byte++) {
        carriedChecks++;
        if (still.bytes[row*still.width + byte] !== moving.bytes[row*moving.width + byte]) {
          carriedDiffs++;
        }
      }
    }
    if (still.height !== moving.height) {
      carriedDiffs++;
    }
  });
  console.log('nesený předmět ($5ECC) proti ležícímu ($67C3): '
              + carriedChecks + ' kontrol, **' + carriedDiffs + ' rozdílů**');
  scopeChecks += carriedChecks;
  scopeDiffs += carriedDiffs;

  console.log('\nsložení celé obrazovky: ' + scopeChecks + ' kontrol, **'
              + scopeDiffs + ' rozdílů**');
  console.log('se všemi snímky:        ' + checks + ' kontrol, ' + diffs + ' rozdílů'
              + '   (barevná stopa rozehrané hry, měří ji tools/matchtrail.js)');
  process.exit(scopeDiffs ? 1 : 0);
}

main();
