const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
// begin code

/**
 * Builds the Jetpac screen — all 6912 bytes of it — out of what the original
 * draws with.
 *
 * What the machine is (the video memory, the ULA's interleaved addressing,
 * `poke`/`peek`, turning bytes plus attributes into pixels) is svision's
 * ZXVideoRAM (R-003). What is left here is the game's own drawing, ported
 * routine by routine out of `sources/asm/jetpac.asm`:
 *
 * - `$71B8`/`$71C6` clear the screen and set every attribute to $47, then
 *   `$6096` paints character row 1 in $46 — {@link clearScreen}
 * - `$766D` lays each platform out of three 8x8 tiles: a left cap, the middle
 *   repeated, a right cap — {@link drawPlatforms}
 * - `$773A` blits a sprite, and `$71CF` colours the cells it covers —
 *   {@link drawSprite}, {@link drawAttributes}
 * - `$7192`/`$711C`/`$70A4` print the panel with the **ZX Spectrum ROM font**
 *   — {@link drawPanel}
 *
 * ★ Three things about the original's drawing are measured, not assumed
 * (sources/docs/disasm_notes.md chap. 5):
 *
 * 1. **A sprite is stored bottom row first and drawn upwards.** `$72EE` does
 *    `DEC H`, so the byte at offset 0 lands on the entity's own y and every
 *    further row a pixel higher. Checked against the original's video memory
 *    with Jetman standing on the floor.
 * 2. **There is no separate mask.** The same silhouette is used twice: `AND`
 *    with its complement rubs the sprite out at the old position, `OR` draws
 *    it at the new one. So a sprite is a solid shape, and two of them
 *    overlapping simply merge.
 * 3. **Four pre-shifted copies per direction**, at 0, 2, 4 and 6 pixels
 *    (`$72C1` indexes with `x & 6`), which is why the game only ever draws on
 *    even x and why horizontal movement is in steps of two.
 *
 * ★ And one thing the remake does differently on purpose: the original draws
 * **incrementally** — it rubs each sprite out where it was and draws it where
 * it is now, and the platforms are laid down once when the level starts
 * ($60BA). This composer instead builds the whole picture from scratch every
 * pass. That is only allowed because nothing ever eats into the scenery:
 * everything that moves bounces off a platform before it can overlap one
 * (`$761D`), measured over 3000 frames of play — the lit pixels of all four
 * platforms stay at 276 / 276 / 182 / 1498 throughout. `tools/matchscreen.js`
 * compares the result with the original's video memory byte for byte.
 *
 * ★ And one thing that is **not** the original's drawing at all: the composer
 * sets ZXVideoRAM's ink **pen** before each of its writes, so the memory can
 * keep a byte-per-pixel note of who lit what and paint the picture without
 * attribute clash (`ZADANI.md` §10/5). It changes nothing here — not a branch,
 * not a byte — and with the plane switched off the pens are writes to a field
 * nobody reads. `tools/runink.js` is what says so: the whole incremental
 * flight of `matchtrail.js` with the plane on, 12 413 952 bytes, no difference.
 *
 * Free of DOM dependencies, so the offline tools render with this very code
 * (R-001).
 */
export class ScreenComposer {

  /** $71C6: bright white on black over the whole screen */
  static get ATTR_SCREEN() { return ScreenLayout.ATTR_SCREEN; }
  /** $6096: character row 1 — the scores — in bright yellow */
  static get ATTR_SCORE_ROW() { return ScreenLayout.ATTR_SCORE_ROW; }
  /** $669C: the exhaust is bright red, and its own colour, not the rocket's */
  static get ATTR_FLAME() { return 0x42; }
  /**
   * $667B: the top of the floor. In the original it is the row the exhaust
   * dies on — the rocket's y plus $15 reaches it $15 above the ground, and
   * from there down there is no flame at all. Here it is the line the flame
   * is **clipped** at ({@link FLAME_ALL_THE_WAY}).
   */
  static get FLAME_GROUND() { return 0xB8; }
  /**
   * ★ A deliberate deviation (`ZADANI.md` §10/6, 2026-09-18): the exhaust
   * burns through the **whole** of the launch and the landing, clipped at the
   * floor, instead of switching on and off $15 pixels above it the way
   * `$6669` does. False restores the original exactly.
   */
  static get FLAME_ALL_THE_WAY() { return true; }
  /** $5D30: the first slot of the long round — slots 0-5 are the short one */
  static get SHORT_ROUND() { return 6; }
  /**
   * $703F: the three slices a laser bolt fades away in. The trailing bytes
   * of the record rub their cell out with these, one each and always in this
   * order — which is why a bolt does not go out all at once but thins from
   * one end ($7096 takes them out of the alternate register file).
   */
  static get LASER_FADE() { return [0x03, 0x1C, 0xE0]; }

  /**
   * @param {Object} gfx - The parsed data/sprites.json: the sprite records,
   *        the shift table $76FA, the four platforms with their tiles and the
   *        panel layout.
   * @param {Object} [font] - {chars, data}: the character list and the hex
   *        glyph table of svision's ZXFonts8x8 — the ROM font the game prints
   *        with ($714C takes the glyph out of CHARS, $5C36). Without it the
   *        panel stays empty.
   */
  constructor(gfx, font) {
    if (!gfx || !gfx.sprites || !gfx.shiftTable) {
      throw new Error('graphics data missing or incomplete');
    }
    this.gfx = gfx;
    this.sprites = {};
    Object.keys(gfx.sprites).forEach((key) => {
      var sprite = gfx.sprites[key];
      this.sprites[sprite.addr] = {
        dx: sprite.dx,
        width: sprite.width,
        height: sprite.height,
        bytes: ZXVideoRAM.decode(sprite.bytes)
      };
    });
    this.tiles = {};
    Object.keys(gfx.platformTiles || {}).forEach((key) => {
      this.tiles[key] = ZXVideoRAM.decode(gfx.platformTiles[key]);
    });
    this.tileOrder = Object.keys(this.tiles).sort();   // left cap, middle, right cap
    this.enemySources = {};
    Object.keys(gfx.enemySources || {}).forEach((key) => {
      var source = gfx.enemySources[key];
      this.enemySources[source.addr] = {height: source.height,
                                        bytes: ZXVideoRAM.decode(source.bytes)};
    });
    this.itemSources = {};
    Object.keys(gfx.itemSources || {}).forEach((key) => {
      var source = gfx.itemSources[key];
      this.itemSources[source.addr] = {dx: source.dx, width: source.width,
                                       height: source.height,
                                       bytes: ZXVideoRAM.decode(source.bytes)};
    });
    // ★ Plamen z trysek: dvě fáze, v pořadí, ve kterém je vybírá $5DCC AND 4
    // — nenula $7F8C, nula $7FAF. Nejsou v žádné tabulce, obsluha $6669 si
    // obě adresy nese v instrukcích, a **obě se před kreslením mažou**.
    this.flameSprites = (gfx.flameSprites || [])
      .map((address) => this.itemSources[address])
      .filter((sprite) => !!sprite);
    this.built = {};
    // ★ Odchylka (ZADANI.md §10/9): hra i menu kreslí panel **bez 2UP**, jeho
    // skóre a životů — pravý horní roh je od 2026-09-18 vyhrazený pro logo
    // JETPAC. Výchozí je věrný panel, protože ho měří matchscreen, matchtrail
    // a runink proti videopaměti originálu; hra si příznak shodí sama.
    this.panelPlayer2 = true;
    this.lifeIcon = gfx.panel && gfx.panel.lifeIcon
                    ? ZXVideoRAM.decode(gfx.panel.lifeIcon) : null;
    this.font = {};
    if (font && font.chars && font.data) {
      for (var index = 0; index < font.chars.length; index++) {
        this.font[font.chars.charAt(index)] =
          ZXVideoRAM.hexToBytes(font.data.substr(index*16, 16));
      }
    }
  } // constructor

  /**
   * Builds the sprites a level needs, the way `$6929` and `$6EF9` do before
   * the level starts: the enemy of this level and the piece being carried are
   * **pre-shifted into a buffer** ($5E00-$5FFF) rather than shifted while
   * drawing, because a Z80 cannot afford to shift a sprite per frame.
   *
   * ★ The enemy is made of **two source pictures**, not one shifted twice
   * ($6929 reads two words out of $6945 and gives the first shift 0 and the
   * second shift 4). Four levels out of eight have the same picture twice; in
   * the other four the creature therefore **animates as it moves sideways**,
   * because the shifted copy is also the other frame. That is a trick, not an
   * accident, and it is reproduced.
   *
   * @param {number} level - The level counter ($5DF0), counted from zero.
   * @param {number} [carried] - The byte offset into $67C3 of the piece being
   *        carried ($6EF9's parameter); without it the carried set is left.
   */
  prepareLevel(level, carried) {
    var group = (level & 0x07) * 2;
    var sources = this.gfx.levelGfx.slice(group, group + 2)
                      .map((address) => this.enemySources[address]);
    // $6F26: two copies, four pixels apart, straight; $6F4D: the same mirrored
    this.built = {
      0x5E00: ScreenComposer.shift(sources[0], 0, false),
      0x5E33: ScreenComposer.shift(sources[1], 4, false),
      0x5E66: ScreenComposer.shift(sources[0], 0, true),
      0x5E99: ScreenComposer.shift(sources[1], 4, true)
    };
    if (carried !== undefined) {
      this.prepareCarried(level, carried);
    }
  } // prepareLevel

  /**
   * The piece Jetman carries, pre-shifted the way `$6EF9` does it: **four
   * copies two pixels apart, all from the one source**, which is why a carried
   * piece moves smoothly while one lying on a platform is drawn straight out
   * of the table.
   * @param {number} level - The level counter ($5DF0).
   * @param {number} carried - The byte offset into $67C3 ($6EF9's parameter).
   */
  prepareCarried(level, carried) {
    var source = this.itemRecord(level, carried);
    this.built = this.built || {};
    [0x5ECC, 0x5EFF, 0x5F32, 0x5F65].forEach((address, index) => {
      this.built[address] = ScreenComposer.shift(source, index*2, false);
    });
  } // prepareCarried

  /**
   * Shifts a two byte wide source into a three byte wide sprite — the port of
   * `$6E9D` (straight: `SRL C / RR D / RR E`) and `$6EBE` (mirrored: every
   * byte bit-reversed, then `SLA E / RL D / RL C`).
   * @param {Object} source - {height, bytes} of the source picture.
   * @param {number} pixels - How far to shift, 0 to 7.
   * @param {boolean} mirrored - Mirror it first.
   * @returns {Object} A sprite record {dx, width, height, bytes}.
   */
  static shift(source, pixels, mirrored) {
    if (!source) {
      return null;
    }
    // $6F72: the height is capped at 16 rows, which is the size of a slot
    var height = Math.min(source.height, 0x10);
    var bytes = new Uint8Array(height*3);
    for (var row = 0; row < height; row++) {
      var high, middle, low;
      if (mirrored) {
        low = ScreenComposer.reverseBits(source.bytes[row*2]);
        middle = ScreenComposer.reverseBits(source.bytes[row*2 + 1]);
        high = 0;
        for (var left = 0; left < pixels; left++) {
          high = ((high << 1) | (middle >> 7)) & 0xFF;
          middle = ((middle << 1) | (low >> 7)) & 0xFF;
          low = (low << 1) & 0xFF;
        }
      } else {
        high = source.bytes[row*2];
        middle = source.bytes[row*2 + 1];
        low = 0;
        for (var right = 0; right < pixels; right++) {
          low = ((low >> 1) | ((middle & 1) << 7)) & 0xFF;
          middle = ((middle >> 1) | ((high & 1) << 7)) & 0xFF;
          high = (high >> 1) & 0xFF;
        }
      }
      bytes[row*3] = high;
      bytes[row*3 + 1] = middle;
      bytes[row*3 + 2] = low;
    }
    return {dx: 0, width: 3, height: height, bytes: bytes};
  } // shift

  /**
   * Reverses the bits of a byte — `$6EB3`, which is how a sprite is mirrored.
   * @param {number} value - The byte.
   * @returns {number} The byte with its bits the other way round.
   */
  static reverseBits(value) {
    var out = 0;
    for (var bit = 0; bit < 8; bit++) {
      out = (out << 1) | (value >> bit & 1);
    }
    return out;
  } // reverseBits

  /**
   * A record out of the item table $67C3, indexed the way the game indexes it:
   * **in bytes**, with the level's own group added — `(level >> 1) & 6` plus
   * the entity's own offset ($64E5, $654B).
   * @param {number} level - The level counter ($5DF0).
   * @param {number} offset - The entity's byte offset (its +6 byte).
   * @returns {Object|null} The sprite record.
   */
  itemRecord(level, offset) {
    var index = (((level >> 1) & 0x06) + offset) >> 1;
    return this.itemSources[this.gfx.itemTable.pointers[index]] || null;
  } // itemRecord

  /**
   * The picture of a treasure — the same table $67C3, but `$64E5` is reached
   * from `$64DB` with `A` nought, so **the level's group is not added**: a
   * treasure looks the same on every planet and only its colour changes
   * ($64CD).
   * @param {number} kind - Its `+6` byte, `$20` to `$28`.
   * @returns {Object|null} The sprite record.
   */
  treasureRecord(kind) {
    return this.itemSources[this.gfx.itemTable.pointers[(kind & 0xFF) >> 1]] || null;
  } // treasureRecord

  /**
   * The sprite of an entity, the way `$72C1` picks it: the table at $76FA is
   * indexed in bytes with `((type-1)*16) + (direction ? 8 : 0) + (x & 6)`.
   * @param {number} type - The entity type, $3F masked off by the caller.
   * @param {boolean} left - Facing left (bit 6 of the type byte).
   * @param {number} x - The entity's x; only bits 1 and 2 matter.
   * @returns {Object|null} {dx, width, height, bytes} or null when the table
   *          points at the runtime buffer ($5E00-$5FFF), which the rocket uses.
   */
  spriteFor(type, left, x) {
    var offset = ((type-1) << 4 & 0xF0) | (left ? 8 : 0) | (x & 6);
    var address = this.gfx.shiftTable.pointers[offset >> 1];
    return this.sprites[address] || (this.built && this.built[address]) || null;
  } // spriteFor

  /**
   * Which picture an entity is drawn with. The rules are the original's, one
   * handler at a time (sources/docs/disasm_notes.md chap. 7):
   *
   * - **1, 2** Jetman — the shift table, by direction and `x & 6`
   * - **3, 5, 6, 7, $0F, $11** a creature — the shift table too, but pointing
   *   into the buffer this level's pictures were pre-shifted into. ★ **Every
   *   creature is drawn as a type 3**, whatever handler it runs: `$6D7A` keeps
   *   the two top bits of the type byte, puts 3 in it, draws ($726A, $71CF)
   *   and puts the real type back — which is why the shift table $76FA has
   *   rows for **four** types only. The table $6A64 gives the second planet
   *   a $11 and the third a 6, so without this rule everything from the
   *   second planet on is invisible
   * - **4** a piece: while it falls or is carried it comes from the pre-shifted
   *   buffer (bit 0 of its flags), lying still it is drawn straight out of the
   *   table $67C3 ($654B)
   * - **8** an explosion — the three pictures of `$690F`, picked by its counter
   * - **$0E** a treasure: straight out of $67C3 too, but **without the level's
   *   group** — `$64E5` is called with `A` nought, so its `+6` (the kind,
   *   `$20`..`$28`) is the whole index. It is drawn unshifted ($725E)
   *
   * @param {Object} entity - The entity record of the worker's frame.
   * @param {number} level - The level counter, for the tables that need it.
   * @returns {Object|null} The sprite record, or null when nothing is drawn.
   */
  spriteOf(entity, level) {
    switch (entity.type) {
      case 1:
      case 2:
        return this.spriteFor(entity.type, entity.left, entity.x);
      // $6D7A: whichever handler a creature runs, it is drawn as a type 3
      case 3:
      case 5:
      case 6:
      case 7:
      case 15:
      case 17:
        return this.spriteFor(3, entity.left, entity.x);
      case 14:
        return this.treasureRecord(entity.raw ? entity.raw[6] : 0);
      case 4:
        return (entity.flags & 0x01)
               ? this.spriteFor(4, entity.left, entity.x)
               : this.itemRecord(level, entity.raw ? entity.raw[6] : 0);
      case 8:
        var frame = entity.flags & 0x07;
        if (frame >= 3) {
          return null;          // $68EE: the last three passes rub it out again
        }
        return this.itemSources[this.gfx.explosionTable[frame]] || null;
      default:
        return null;
    }
  } // spriteOf

  /**
   * Clears the screen the way `$608A` does before a level: bitmap to zero,
   * every attribute to $47, then character row 1 to $46 for the scores.
   * @param {ZXVideoRAM} videoRAM - The memory to clear.
   */
  clearScreen(videoRAM) {
    videoRAM.clear(0x00, ScreenComposer.ATTR_SCREEN);
    for (var col = 0; col < ScreenLayout.COLS; col++) {
      videoRAM.pokeAttribute(1, col, ScreenComposer.ATTR_SCORE_ROW);
    }
  } // clearScreen

  /**
   * Lays the four platforms out of three 8x8 tiles each, exactly as `$766D`
   * does: the left edge sits at `x - (width & $FC) + 16`, the middle tile is
   * repeated `width/4 - 4` times, and the colour — which is the first byte of
   * the platform record, not a separate field — fills `width/4 - 2` cells.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   */
  drawPlatforms(videoRAM) {
    (this.gfx.platforms || []).forEach((platform) => {
      if (!platform.flag) {
        return;
      }
      var x = (platform.x - (platform.width & 0xFC) + 0x10) & 0xFF;
      var middles = (platform.width >> 2) - 4;
      var tiles = [this.tileOrder[0]];
      for (var index = 0; index < middles; index++) {
        tiles.push(this.tileOrder[1]);
      }
      tiles.push(this.tileOrder[2]);
      // the ink plane wants to know whose pixels these are; without one this
      // is a no-op and the colour comes from the attributes below, as ever
      videoRAM.setPen(platform.flag);
      tiles.forEach((tile, column) => {
        this.drawTile(videoRAM, this.tiles[tile], (x + column*8) & 0xFF, platform.y);
      });
      videoRAM.setPen(null);
      var cells = (platform.width >> 2) - 2;
      var row = platform.y >> 3;
      for (var cell = 0; cell < cells; cell++) {
        videoRAM.pokeAttribute(row, ((x >> 3) + cell) & 0x1F, platform.flag);
      }
    });
  } // drawPlatforms

  /**
   * One 8x8 tile, drawn **downwards** from y — the direction `$715E` goes
   * (`INC H`), which is the opposite of a sprite.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Uint8Array} tile - The eight bytes of the tile.
   * @param {number} x - Left edge, a multiple of 8.
   * @param {number} y - Top row.
   */
  drawTile(videoRAM, tile, x, y) {
    for (var line = 0; line < 8; line++) {
      var address = ZXVideoRAM.addressOf(x, y + line);
      videoRAM.poke(address.h, address.l, tile[line]);
    }
  } // drawTile

  /**
   * Draws one entity: the silhouette `OR`ed into the bitmap and the cells it
   * covers filled with its colour.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - {type, x, y, attr, left} of the worker's frame.
   * @param {Object} sprite - The sprite record.
   */
  drawSprite(videoRAM, entity, sprite) {
    if (!sprite) {
      return;
    }
    this.blit(videoRAM, entity, sprite, 'or');
    this.drawAttributes(videoRAM, entity, sprite);
  } // drawSprite

  /**
   * The bytes of a sprite into the memory, **from the bottom up**, either
   * `OR`ed in ($775F) or rubbed out ($7741, which does it with `CPL` and
   * `AND`). ★ The attributes are **not** touched when something is rubbed
   * out — the original leaves them where they are, and that is the colour
   * trail the screen slowly fills with.
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} entity - {x, y} of the entity.
   * @param {Object} sprite - The sprite record.
   * @param {string} operation - 'or' to draw, 'and' to rub out.
   * @param {number|null|Function} [ink] - What to mark the lit pixels with in
   *        the ink plane: the entity's own attribute by default, `null` to
   *        leave the pixels to the cell, or a function of the pixel line for
   *        something whose colour changes down its own height — which on this
   *        screen means the rocket, whose colour is its fuel gauge
   *        ({@link blitRocket}).
   */
  blit(videoRAM, entity, sprite, operation, ink) {
    if (!sprite) {
      return;
    }
    for (var row = 0; row < sprite.height; row++) {
      this.blitRow(videoRAM, entity, sprite, operation, row, ink);
    }
  } // blit

  /**
   * **One row** of a sprite, counted from its bottom — the unit the original
   * works in ($773A does a row at a time and steps the address with $72EE).
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} entity - {x, y} of the entity.
   * @param {Object} sprite - The sprite record.
   * @param {string} operation - 'or' to draw, 'and' to rub out.
   * @param {number} row - Which row, 0 being the bottom one.
   * @param {number|null|Function} [ink] - The ink plane pen; see {@link blit}.
   */
  blitRow(videoRAM, entity, sprite, operation, row, ink) {
    var y = entity.y - row;
    // ★ Only drawing owns pixels. Rubbing out takes the owner away, and that
    // the memory does by itself out of the bits that went dark ($7741 writes
    // the complement of the silhouette) — so there is nothing to say here.
    videoRAM.setPen(ink === undefined ? entity.attr
                    : (typeof ink === 'function' ? ink(y) : ink));
    if (y < 0 || y >= ScreenLayout.HEIGHT) {
      return;
    }
    var x = (entity.x + sprite.dx) & 0xFF;
    for (var byte = 0; byte < sprite.width; byte++) {
      var bits = sprite.bytes[row*sprite.width + byte];
      if (!bits) {
        continue;
      }
      // ★ the original does not stop at the right hand edge: the address is
      // stepped with INC L inside the page, so a sprite running off the
      // right comes back on the left. Reproduced, not clipped.
      var address = ZXVideoRAM.addressOf((x + byte*8) & 0xFF, y);
      videoRAM.poke(address.h, address.l,
                    operation === 'and' ? (~bits & 0xFF) : bits, operation);
    }
  } // blitRow

  /**
   * Rubs the old picture out and draws the new one: the whole mask first, then
   * the whole picture, both from the bottom up.
   *
   * ★ The original does it in one loop that keeps **two addresses** and
   * alternates a row of the mask with a row of the picture ($773A), and
   * shortens whichever of the two would catch the other up — the rubbing out
   * by however far the sprite moved up ($727D), the drawing by however far it
   * moved down ($728C). Measured against it over 1796 rounds of four
   * scenarios (`tools/matchtrail.js`, 12.4 million bytes), that comes out
   * byte for byte the same as doing it in two goes, which is what this does.
   * When the sprite has not moved the two are the same thing anyway: the rows
   * are independent and each one is still rubbed out before it is drawn.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} was - Where it was.
   * @param {Object} erase - The picture to rub out (may be null).
   * @param {Object} is - Where it is.
   * @param {Object} draw - The picture to draw (may be null).
   */
  blitPair(videoRAM, was, erase, is, draw) {
    for (var out = 0; erase && out < erase.height; out++) {
      this.blitRow(videoRAM, was, erase, 'and', out);
    }
    for (var row = 0; draw && row < draw.height; row++) {
      this.blitRow(videoRAM, is, draw, 'or', row);
    }
  } // blitPair

  /**
   * The colour of an entity, the way `$71CF` writes it: starting at the cell
   * of the entity's own y and working **upwards** `(height/4 + 1)/2 + 1` rows,
   * each row `width` cells wide, and only inside $5800-$5AFF.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - {x, y, attr} of the worker's frame.
   * @param {Object} sprite - The sprite record being drawn.
   */
  drawAttributes(videoRAM, entity, sprite) {
    var rows = ((((sprite.height >> 2) + 1) >> 1) & 0x1F) + 1;
    var x = (entity.x + sprite.dx) & 0xFF;
    for (var row = 0; row < rows; row++) {
      var y = entity.y - row*8;
      if (y < 0 || y >= ScreenLayout.HEIGHT) {
        continue;
      }
      for (var cell = 0; cell < sprite.width; cell++) {
        videoRAM.pokeAttribute(y >> 3, ((x >> 3) + cell) & 0x1F, entity.attr);
      }
    }
  } // drawAttributes

  /**
   * The panel: 1UP, HI and 2UP on character row 0 with the lives and the
   * little Jetman beside them, three six-digit scores on row 1. Every position
   * comes out of the original ($7192, $711C, $70A4) rather than off a
   * screenshot, and the glyphs are the ROM font's.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} panel - {score, score2, hiScore, lives, lives2}.
   */
  drawPanel(videoRAM, panel) {
    var layout = this.gfx.panel;
    if (!layout) {
      return;
    }
    layout.labels.forEach((label) => {
      if (!this.panelPlayer2 && label.text === '2UP') {
        return;
      }
      // ★ While the delay at the start of a life runs ($5DD7), the label of
      // the player whose turn it is **flashes** — $61BD sets bit 7 of its
      // three attribute cells and $61D3 clears them again when the delay is
      // over. The same counter is why Jetman is not on the screen yet
      // (composeInto): $73B2 returns before his handler ever runs.
      var flashing = panel.labelFlash
                     && label.text === ((panel.player || 1) === 2 ? '2UP' : '1UP');
      this.printString(videoRAM, label.x, label.y, label.text,
                       flashing ? (label.attr | 0x80) : label.attr);
    });
    this.printScore(videoRAM, layout.scoreAt.player1, panel.score || 0, layout.digits);
    this.printScore(videoRAM, layout.scoreAt.hiScore, panel.hiScore || 0, layout.digits);
    this.printLives(videoRAM, layout.livesAt.player1, panel.lives);
    if (this.panelPlayer2) {
      this.printScore(videoRAM, layout.scoreAt.player2, panel.score2 || 0, layout.digits);
      this.printLives(videoRAM, layout.livesAt.player2, panel.lives2);
    }
  } // drawPanel

  /**
   * A string in the ROM font, one glyph per character cell, left to right.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {number} x - Left edge in pixels.
   * @param {number} y - Top row in pixels.
   * @param {string} text - The characters.
   * @param {number} [attr] - The attribute of the cells; left alone when absent.
   */
  printString(videoRAM, x, y, text, attr) {
    // a string printed without an attribute takes the colour of the row it
    // lands in ($7132 does not touch the cells), so it stays unowned
    videoRAM.setPen(attr === undefined ? null : attr);
    for (var index = 0; index < text.length; index++) {
      var glyph = this.font[text.charAt(index)];
      var column = (x >> 3) + index;
      if (glyph) {
        for (var line = 0; line < 8; line++) {
          var at = ZXVideoRAM.addressOf(column*8 & 0xFF, y + line);
          videoRAM.poke(at.h, at.l, glyph[line]);
        }
      }
      if (attr !== undefined) {
        videoRAM.pokeAttribute(y >> 3, column & 0x1F, attr);
      }
    }
    videoRAM.setPen(null);
  } // printString

  /**
   * Six digits at a fixed screen address, the way `$7132` prints them: the
   * score is **three bytes of BCD**, two digits per byte, and nothing is
   * suppressed — a score of nought is six noughts.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {number} address - The video address of the first cell ($4021 …).
   * @param {number} score - The score as an ordinary number.
   * @param {number} digits - How many digits (six).
   */
  printScore(videoRAM, address, score, digits) {
    var text = String(Math.max(0, Math.floor(score))).padStart(digits, '0').slice(-digits);
    var row = (address - ZXVideoRAM.BASE) >> 5 & 0x07;
    var third = (address - ZXVideoRAM.BASE) >> 11 & 0x03;
    var column = address & 0x1F;
    this.printString(videoRAM, column*8, (third*8 + row)*8, text);
  } // printScore

  /**
   * The number of lives and the little Jetman beside it ($70A4). The count is
   * one digit and the icon is the game's own eight bytes from $70DB.
   *
   * ★ **With no lives left the place is blanked, not left alone** ($70D1
   * prints two spaces). That is what makes a one player game look right: the
   * second player has no lives, so where the original would put `0` and a
   * figure there are two blanks — checked against the original's video memory
   * by tools/matchscreen.js.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {number} position - x in the low byte, y in the high one ($0040).
   * @param {number|null} lives - The count, or null to leave the place empty.
   */
  printLives(videoRAM, position, lives) {
    if (lives === null || lives === undefined) {
      return;
    }
    var x = position & 0xFF;
    var y = position >> 8 & 0xFF;
    if (!lives) {
      this.printString(videoRAM, x, y, '  ');
      return;
    }
    this.printString(videoRAM, x, y, String(lives % 10));
    if (this.lifeIcon) {
      for (var line = 0; line < 8; line++) {
        var iconAt = ZXVideoRAM.addressOf((x + 8) & 0xFF, y + line);
        videoRAM.poke(iconAt.h, iconAt.l, this.lifeIcon[line]);
      }
    }
  } // printLives

  /**
   * The rocket, which is not one sprite but a **stack of pieces** ($6733): as
   * many as its flags byte says, each 16 pixels above the last, each picked
   * out of $67C3 with `((level >> 2) & 3) + 4*piece`.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - The rocket entity (type 9, 10 or 11).
   * @param {number} level - The level counter.
   */
  drawRocket(videoRAM, entity, level, pass) {
    this.blitRocket(videoRAM, entity, level, 'or', pass);
    this.rocketAttributes(videoRAM, entity, pass);
  } // drawRocket

  /**
   * ★ The exhaust ($6669), which only the climbing and the descending rocket
   * has ($66D0 and $66F4 call it; $6707, standing on the ground, does not).
   * It is not an entity and it is in no table: the routine borrows the
   * rocket's own record, adds **$15 to its y** so the picture lands under the
   * nozzle, draws, and takes the $15 off again.
   *
   * ★ Two pictures, and **both are rubbed out before either is drawn**
   * ($668B: the mask of $7F8C and the mask of $7FAF, and only then the one
   * that is due) — because which of them is on the screen depends on $5DCC,
   * and the routine does not remember. Bit 2 of the pass picks: set means
   * $7F8C ($66B3), clear $7FAF ($6688), so the flame flickers every four
   * rounds.
   *
   * ★ **And they are rubbed out where the picture is, not where the rocket
   * now is.** This is the general rule of the drawing, and the flame is in
   * it like everything else: $7327 puts the record's x, y and type into
   * $5DC0-$5DC2 **before** the handler moves anything, the mask ($7227) takes
   * its coordinates from there and the picture ($723F) from `IX+1`/`IX+2`.
   * That is why $6669 adds its $15 to **both** $5DC1 and `IX+2` ($6671) and
   * takes it off both again ($66AB) — the exhaust is rubbed out a pixel
   * behind where it is drawn, which is exactly the pixel the rocket has
   * moved. Erasing at the new place instead leaves one row of the old flame
   * standing every round, and the rocket drags a trail of them up the screen.
   *
   * ★ And in the original it stops at the ground: `CP $B8` on the **new**
   * shifted y, over it nothing happens at all ($66A3), on it the flame is
   * rubbed out and not drawn again ($66B8). The reason is not the picture but
   * the **floor**: the plume hangs $15 below the rocket, so near the ground it
   * would be drawn into the bottom platform, and the mask that rubs it out
   * again would eat the platform's pixels with it — the same way the dodger
   * ate the islands on the second planet (`tools/runplanets.js`).
   *
   * ★ **Here it burns the whole way instead** (`ZADANI.md` §10/6): the rows
   * of the plume that would fall on the floor are simply left out, both when
   * it is drawn and when it is rubbed out, so nothing ever reaches the
   * platform and there is nothing to mend. The flame therefore grows out of
   * the ground as the rocket lifts and sinks back into it as it lands, rather
   * than switching on $15 pixels up. `FLAME_ALL_THE_WAY` false gives the
   * original's cut-off back, byte for byte.
   *
   * ★ Its colour is $42 — bright red, and **the routine writes it into the
   * rocket's own +3 byte** ($669C) before $71CF lays the cells down. That
   * byte is the one thing of the rocket's that nothing reads: the rocket
   * colours itself from the fuel gauge ({@link rocketAttributes}), so the
   * remake keeps the attribute here rather than stepping on the record.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} was - The rocket as the round started — where the flame
   *        is on the screen ($5DC0/$5DC1). Left out when there is nothing on
   *        the screen to rub out, as on a frame composed from scratch.
   * @param {Object} is - The rocket as the round ended — where it is drawn.
   * @param {number} pass - $5DCC, which picks the picture.
   */
  drawFlame(videoRAM, was, is, pass) {
    var y = (is.y + 0x15) & 0xFF;
    if (!ScreenComposer.FLAME_ALL_THE_WAY && y > ScreenComposer.FLAME_GROUND) {
      return;                                 // $667F: not out of the nozzle yet
    }
    if (was) {
      var off = {x: was.x, y: (was.y + 0x15) & 0xFF};
      this.flameSprites.forEach((sprite) => this.blitFlame(videoRAM, off, sprite, 'and'));
    }
    if (y === ScreenComposer.FLAME_GROUND && !ScreenComposer.FLAME_ALL_THE_WAY) {
      return;                                 // $66B8: down, and out
    }
    var picture = this.flameSprites[((pass || 0) & 0x04) ? 0 : 1];
    if (!picture) {
      return;
    }
    var at = {x: is.x, y: y, attr: ScreenComposer.ATTR_FLAME};
    this.blitFlame(videoRAM, at, picture, 'or');
    // the colours, row of cells by row of cells, and **none of them on the
    // floor** — $71CF would lay whole cells down and repaint the platform
    var rows = ((((picture.height >> 2) + 1) >> 1) & 0x1F) + 1;
    for (var row = 0; row < rows; row++) {
      var cellY = at.y - row*8;
      if (cellY < 0 || cellY >= ScreenComposer.FLAME_GROUND) {
        continue;
      }
      for (var cell = 0; cell < picture.width; cell++) {
        videoRAM.pokeAttribute(cellY >> 3, ((at.x >> 3) + cell) & 0x1F, at.attr);
      }
    }
  } // drawFlame

  /**
   * One picture of the flame, drawn or rubbed out, **clipped at the floor**.
   *
   * ★ The clip is on the **absolute** pixel line, not on the row of the
   * sprite, and that is what makes it safe: a row is left out of the mask
   * exactly where it was left out of the picture, so what was drawn is what
   * is rubbed out and no half-erased flame is left behind.
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} at - {x, y} of the flame, and its attribute when drawing.
   * @param {Object} sprite - One of the two pictures.
   * @param {string} operation - 'or' to draw, 'and' to rub out.
   */
  blitFlame(videoRAM, at, sprite, operation) {
    for (var row = 0; row < sprite.height; row++) {
      if (at.y - row >= ScreenComposer.FLAME_GROUND) {
        continue;
      }
      this.blitRow(videoRAM, at, sprite, operation, row,
                   operation === 'and' ? null : ScreenComposer.ATTR_FLAME);
    }
  } // blitFlame

  /**
   * The rocket's pieces, drawn or rubbed out. ★ The rocket is **redrawn every
   * round**, standing still or not ($6707 draws before it tests anything), and
   * that is what repairs it when a creature has flown through it; rub it out
   * only when it has moved.
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} entity - The rocket (types 9-11).
   * @param {number} level - The level counter, which picks the pictures.
   * @param {string} operation - 'or' to draw, 'and' to rub out.
   * @param {boolean} colours - Whether to lay the colours down as well. ★ The
   *        round-by-round repair does **not**: the rocket puts its pixels back
   *        but leaves the cells in whatever colour the last creature to fly
   *        through it left behind, and that is what the original looks like.
   */
  blitRocket(videoRAM, entity, level, operation, pass) {
    var pieces = entity.flags || 0;
    // ★ **The gauge is the rocket's colour**, it is just not in its record.
    // Every other sprite carries an attribute in `+3` and paints its cells
    // with it; the rocket works the colour out from its own state instead
    // ($6768: magenta up to the fuel level, white above it, bright every other
    // round). That makes it no less the rocket's own colour — so the ink
    // plane is given that, row by row, rather than being told to keep out.
    // {@link rocketInkAt} is the same gauge {@link rocketAttributes} lays
    // down, asked a pixel line at a time.
    var ink = (operation === 'and') ? null
              : (y) => this.rocketInkAt(entity, pass, y);
    for (var piece = 0; piece < pieces; piece++) {
      var offset = (((level >> 2) & 0x03) | (piece*4)) * 2;
      var sprite = this.itemSources[this.gfx.itemTable.pointers[offset >> 1]];
      var at = {x: entity.x, y: (entity.y - piece*0x10) & 0xFF, attr: entity.attr};
      this.blit(videoRAM, at, sprite, operation, ink);
    }
  } // blitRocket

  /**
   * ★ The rocket colours itself quite differently from every other sprite
   * ($6768-$67C2): it puts **height zero and width two** into $5DC3/$5DC4
   * first, so $71CF lays down **one row of two cells at a time**, and then
   * repeats that `pieces*2` times, walking up by eight. That is why the cell
   * above the rocket keeps whatever colour the last creature left in it \u2014
   * the rocket simply does not reach it.
   *
   * And it doubles as the **fuel gauge**: with all three pieces up and fuel in
   * it, the bottom `+5` rows go $43 (magenta — ink 3 — and bright every other round, which
   * is where the flashing comes from) and the rest $47.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - The rocket.
   * @param {number} pass - $5DCC, which makes the gauge flash.
   */
  rocketAttributes(videoRAM, entity, pass) {
    var y = entity.y;
    this.rocketGauge(entity, pass).forEach((band) => {
      for (var row = 0; row < band[0]; row++) {
        for (var cell = 0; cell < 2; cell++) {
          videoRAM.pokeAttribute((y & 0xFF) >> 3, ((entity.x >> 3) + cell) & 0x1F, band[1]);
        }
        y = (y - 8) & 0xFF;
      }
    });
  } // rocketAttributes

  /**
   * The gauge itself, as the bands `$6768` lays down from the rocket's own y
   * upwards: `[count, attribute]` each, `count` rows of two cells.
   *
   * ★ **With fuel in it and not full, it paints six rows and no more** — the
   * original's `paint(fuel, $43); paint(6-fuel, $47)` adds up to six whatever
   * `pieces*2` says. That is not a rounding of the port, it is the routine.
   * @param {Object} entity - The rocket.
   * @param {number} pass - $5DCC, which makes the gauge flash.
   * @returns {Array} The bands, bottom one first.
   */
  rocketGauge(entity, pass) {
    var rows = ((entity.flags || 0) << 1) & 0xFF;
    var fuel = (entity.raw || [])[5] || 0;
    var lit = (((pass || 0) >> 2) & 0x04) | 0x43;
    if (rows >= 6 && fuel) {
      return (fuel >= 6) ? [[rows, lit]] : [[fuel, 0x43], [6 - fuel, 0x47]];
    }
    return [[rows, 0x47]];
  } // rocketGauge

  /**
   * What colour the gauge gives one pixel line — the ink plane's pen for the
   * rocket, so that its picture keeps the gauge's colours even in a cell some
   * creature has just repainted with its own.
   *
   * ★ The band is picked by the **cell**, not by the distance in pixels: the
   * gauge walks in steps of eight from the rocket's own y, so the band of a
   * line is the difference of the two cell rows. `(entity.y - y) >> 3` looks
   * like the same thing and is not — a rocket whose y sits three pixels into
   * its cell would put the first line of the cell above into band 0.
   * @param {Object} entity - The rocket.
   * @param {number} pass - $5DCC.
   * @param {number} y - The pixel line being drawn.
   * @returns {number|null} The attribute, or null where the gauge does not
   *          reach — those pixels stay the cell's, as they are on the screen.
   */
  rocketInkAt(entity, pass, y) {
    var band = ((entity.y & 0xFF) >> 3) - ((y & 0xFF) >> 3);
    if (band < 0) {
      return null;
    }
    var bands = this.rocketGauge(entity, pass);
    for (var index = 0; index < bands.length; index++) {
      if (band < bands[index][0]) {
        return bands[index][1];
      }
      band -= bands[index][0];
    }
    // ★ **The tip** (`ZADANI.md` §10/7). The gauge lays down `pieces*2` rows
    // of cells from the rocket's own y upwards, which is exactly its height —
    // but only while y sits at the bottom of its cell, as it does on the
    // ground ($B7). One pixel into the climb the top of the rocket hangs over
    // into a cell row the gauge never reaches, and in the original that cell
    // keeps whatever the last creature left in it: the tip changes colour as
    // it lifts off. The video memory is the original's either way — the gauge
    // pokes the same cells — this only says **whose** those pixels are, so
    // the colour plane paints the tip like the rest of the rocket.
    return bands.length ? bands[bands.length-1][1] : null;
  } // rocketInkAt

  /**
   * ★ A laser shot is not a sprite: it is **bytes of $FF poked straight into
   * the video memory** ($7024), one for the head and one for each of the three
   * segments trailing it, all on the same pixel row and all in the colour its
   * own record carries (+7). That is also why it stops where it does — the
   * original asks the screen what is in front of it.
   * @param {ZXVideoRAM} videoRAM - The memory to draw into.
   * @param {Object} entity - The shot (type $10).
   */
  drawLaser(videoRAM, entity) {
    var raw = entity.raw || [];
    var y = raw[1];
    // the head is +2, the segments +3, +4, +5; bit 2 says it is still lit
    [raw[2], raw[3], raw[4], raw[5]].forEach((position) => {
      if (position === undefined || !(position & 0x04)) {
        return;
      }
      var at = ZXVideoRAM.addressOf(position & 0xF8, y);
      videoRAM.setPen(raw[7]);
      videoRAM.poke(at.h, at.l, 0xFF, 'or');
      videoRAM.setPen(null);
      videoRAM.pokeAttribute(y >> 3, ((position & 0xF8) >> 3) & 0x1F, raw[7]);
    });
  } // drawLaser

  /**
   * **One step of the original's own drawing**: for every slot, rub the entity
   * out where it was and draw it where it is now, in slot order.
   *
   * ★ This is how the game does it ($726A: the mask at the old position, the
   * picture at the new one) and it is the only way to get the **colour trail**
   * right. The original clears the screen once when a level starts ($608A) and
   * never again — an attribute an entity painted stays painted, so the screen
   * slowly fills with the colours of everything that has been anywhere. Build
   * the picture from scratch each frame and that trail is missing; that was
   * 270 differences in tools/matchscreen.js until this existed.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to work in; **kept between
   *        frames**, because the trail is its history.
   * @param {Object} state - The worker's frame.
   * @param {Object} previous - The frame before it.
   */
  stepInto(videoRAM, state, previous) {
    var level = (state && state.level) || 0;
    var now = (state && state.entities) || [];
    var before = (previous && previous.entities) || [];
    // ★ A new life and a new level are the **only** two moments the original
    // wipes the screen ($608A clears the bitmap, paints every cell $47 and
    // lays the platforms out again). The start of a life shows up as the
    // delay counter being wound up again ($619A); everything else — all the
    // colour that has piled up — stays exactly where it is.
    if (previous && ((state.startDelay || 0) > (previous.startDelay || 0)
                     || level !== ((previous.level) || 0))) {
      this.clearScreen(videoRAM);
      this.drawPlatforms(videoRAM);
      if (state.panel) {
        // ★ without the flash: $608A wipes every cell, and the bit that makes
        // the label blink is only put back by the **next** short round ($61BD)
        this.drawPanel(videoRAM, Object.assign({labelFlash: false}, state.panel));
      }
      return;                 // the handlers put the entities back themselves
    }
    // ★ The short round is **not** the first six slots of the long one:
    // `$6351` asks before every entity whether the frame has turned over, and
    // when it has it runs the short round (Jetman, his four shots, the sound)
    // right there ($6965). So Jetman is drawn **in the middle of the
    // creatures**, and since a sprite paints the cells it covers in its own
    // colour, whoever is drawn last is what is seen. `state.shortRounds` says
    // at which slots it cut in, and `state.shortStates` carries the frame as
    // it stood after each of those — there can be **two of them in one long
    // round**, and Jetman moves between them.
    //
    // The remake runs one short round per tick and sends neither, which is
    // the plain case: the short round first, then the rest.
    var cuts = (state && state.shortRounds) || [ScreenComposer.SHORT_ROUND];
    var states = (state && state.shortStates) || [];
    // ★ Kde se Jetman odlepil od plošiny: `$75B4` mu v té chvíli položí
    // **obláček** do slotu 9, a jestliže se to stalo v krátkém kole, které se
    // vklínilo **až za slotem 9**, smyčka už tudy prošla a obláček se letos
    // nekreslí. Tohle je to jediné místo, kde na tom záleží.
    var takeOff = -1;
    var earlier = previous;
    cuts.forEach((at, index) => {
      var target = states[index] || state;
      var before = ((earlier && earlier.entities) || [])[0];
      var now = ((target && target.entities) || [])[0];
      if (before && now && before.type === 2 && now.type === 1) {
        takeOff = at;
      }
      earlier = target;
    });
    var slot = ScreenComposer.SHORT_ROUND;
    var short = previous;
    cuts.forEach((at, index) => {
      var upto = Math.max(ScreenComposer.SHORT_ROUND, Math.min(now.length, at));
      for (; slot < upto; slot++) {
        this.stepSlot(videoRAM, slot, before[slot], now[slot], level, state, previous, takeOff);
      }
      var target = states[index] || state;
      this.stepShortRound(videoRAM, target, short, level, state);
      short = target;
    });
    for (; slot < now.length; slot++) {
      this.stepSlot(videoRAM, slot, before[slot], now[slot], level, state, previous, takeOff);
    }
    if (state && state.panel) {
      this.drawPanel(videoRAM, Object.assign({labelFlash: !!(state.startDelay)},
                                             state.panel));
    }
  } // stepInto

  /**
   * One short round: Jetman, his four shots and the sound slot ($6965).
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} state - The frame as it stands after this short round.
   * @param {Object} previous - The frame as it stood after the one before.
   * @param {number} level - The level counter.
   * @param {Object} whole - The whole frame, for the delay and $5DCC.
   */
  stepShortRound(videoRAM, state, previous, level, whole) {
    var now = (state && state.entities) || [];
    var before = (previous && previous.entities) || [];
    for (var slot = 0; slot < ScreenComposer.SHORT_ROUND; slot++) {
      this.stepSlot(videoRAM, slot, before[slot], now[slot], level, whole, previous);
    }
  } // stepShortRound

  /**
   * One slot of one round: rub it out where it was, draw it where it is.
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {number} slot - Which slot.
   * @param {Object} was - Its record as the round started.
   * @param {Object} is - Its record as the round ended.
   * @param {number} level - The level counter.
   * @param {Object} state - The whole frame, for the start delay and $5DCC.
   * @param {Object} previous - The frame before it.
   */
  stepSlot(videoRAM, slot, was, is, level, state, previous, takeOff) {
    // ★ The rocket is its own drawing: several pictures stacked on one
    // another, and put back on the screen **every round** whether it has
    // moved or not — that is what mends it after a creature has flown
    // through it. It is rubbed out only when it is on its way up or down.
    if ((is && is.type >= 9 && is.type <= 11)
        || (was && was.type >= 9 && was.type <= 11)) {
      if (was && was.type >= 9 && was.type <= 11
          && (!is || !is.type || was.x !== is.x || was.y !== is.y
              || was.flags !== is.flags)) {
        this.blitRocket(videoRAM, was, level, 'and');
      }
      // ★ The round Jetman gets in, **the rocket rubs him out** ($6717 steps
      // its own type on, then points IX at $5D00, calls $7327 and $72A5 — the
      // mask at his own coordinates — and only then empties his slot). It is
      // the one place where a slot that goes out is rubbed out, and without it
      // he stays standing in the exhaust, bits of him showing round the rocket
      // as it redraws itself every round.
      //
      // ★ **And it is rubbed out where the picture is, not where the record
      // says.** In the original the short round of this very frame had already
      // drawn Jetman at his new place, so $72A5 at his own coordinates hits
      // his own picture. The worker empties his slot **before** it sends the
      // frame, so the composer's short round saw a type of nought, drew
      // nothing, and what is on the screen is still the picture of the frame
      // before — at the **old** place and with the **old** shift. Rubbing out
      // at the new coordinates therefore left most of him standing (52 pixels
      // of 90 in the test), which is exactly what the game showed. The end of
      // the frame is the same either way: the original draws him and rubs him
      // out again at the new place, the remake never draws him there.
      if (was && was.type === 9 && is && is.type === 10) {
        var before = (previous && previous.entities || [])[0];
        var jetman = (state && state.entities || [])[0];
        if (before && before.type) {
          var picture = this.spriteOf(before, level);
          this.blit(videoRAM, before, picture, 'and');
          // …and the colour he left on the cells he flew through stays, because
          // the original coloured them ($71CF) before the mask took the bits
          if (jetman) {
            this.drawAttributes(videoRAM, {x: jetman.x, y: jetman.y,
                                           attr: before.attr}, picture);
          }
        }
      }
      if (is && is.type >= 9 && is.type <= 11) {
        // $6669 goes **before** the rocket is drawn ($6733), and only for the
        // two moving types — the picture is below the nozzle, so the order
        // makes no difference to the pixels, but the original's does
        if (is.type === 10 || is.type === 11) {
          this.drawFlame(videoRAM, was, is, state && state.pass);
        }
        this.drawRocket(videoRAM, is, level, state && state.pass);
      }
      return;
    }
    // ★ **An item that goes out is rubbed out**, and it is the only kind that
    // is: a treasure Jetman walks into ($64AE: `$64E5` for its picture, then
    // `$72A0`, and only then the slot is emptied) and a piece or a load of
    // fuel that reaches the rocket ($65C4: `$72A5`, then the slot). Without it
    // the treasure stayed lying on the platform after it had been picked up.
    // It comes off where it is on the screen — the frame it goes out in never
    // drew it again, so that is where the frame before put it.
    if (was && (was.type === 4 || was.type === 14) && !(is && is.type)) {
      this.blit(videoRAM, was, this.spriteOf(was, level), 'and');
      return;
    }
    // ★ A laser bolt is not a sprite either ($6FFC): its own branch.
    if ((was && was.type === 0x10) || (is && is.type === 0x10)) {
      this.stepLaser(videoRAM, was, is);
      return;
    }
    // ★ An explosion is drawn quite unlike everything else ($68B1): it
    // has its own branch, because it piles its pictures up instead of
    // rubbing the one before out.
    if (was && was.type === 8) {
      this.stepExplosion(videoRAM, was, is, level);
      return;
    }
    // ★ An explosion that appears in an **empty** slot was put there by the
    // handler of whoever did the killing ($6894 looks for a free slot). Its
    // own handler runs in the same round **only if the loop has not passed
    // its slot yet** — and the record says which it was: the handler steps
    // the counter on ($68C1), so a counter still at nought means it has not
    // run and nothing is on the screen yet. That is the difference between
    // a creature killed by a shot (drawn at once) and the puff Jetman leaves
    // when he lifts off ($75B4), which is put in slot 9 by a short round that
    // cut in **after** slot 9 had been done.
    if (is && is.type === 8 && !(was && was.type)) {
      // … unless it is the puff of Jetman lifting off and the short round
      // that made it cut in **after** this slot (stepInto works out where)
      if (!(takeOff !== undefined && takeOff > slot)) {
        this.stepExplosion(videoRAM, Object.assign({}, is, {flags: 0}), is, level);
      }
      return;
    }
    // ★ **The picture belongs to the type the record had when the handler
    // started**, not to the one it ends with: `$6374` jumps by the type, and
    // a handler changes it as the last thing it does. So a creature that is
    // killed in this round is still drawn as a creature, at the place it has
    // just moved to, and becomes an explosion only in the next one — and a
    // creature that has just been spawned (which happens **after** the loop,
    // $69DC) is not drawn at all yet.
    // ★ A slot that **goes out** is not rubbed out: the round rubs the
    // picture out at the start of a handler that is going to draw it again
    // ($726A does both at once), so when something is simply killed
    // ($648D turns Jetman's slot off where he stands) it **stays on the
    // screen** and the explosion that is put in another slot grows over it.
    // What cleans it up is that explosion's last round, which rubs out the
    // picture of the type it kept in `+6` (stepExplosion).
    var jetman = was && (was.type === 1 || was.type === 2);
    var alive = was && was.type && is && is.type;
    var erase = alive ? this.spriteOf(was, level) : null;
    // ★ And his two types are **flying** and **standing on something**, which
    // the physics decides ($73B2, $7571) **before** it draws him — so he is
    // drawn as what he has just become, while a creature is drawn as what it
    // still was.
    var current = jetman && is.type <= 2;
    var draw = alive
               ? this.spriteOf(Object.assign({}, is, {
                   type: current ? is.type : was.type,
                   left: current ? is.left : was.left
                 }), level)
               : null;
    // $73B2 and $7571 return before they draw while the start delay runs, so
    // Jetman is simply not on the screen yet
    if (state && state.startDelay && is && (is.type === 1 || is.type === 2)) {
      draw = null;
    }
    if (previous && previous.startDelay && was && (was.type === 1 || was.type === 2)) {
      erase = null;
    }

    this.blitPair(videoRAM, was, erase, is, draw);
    if (draw) {
      this.drawAttributes(videoRAM, is, draw);
    }
  } // stepSlot

  /**
   * One round of an explosion — `$68B1`, which is **six rounds and then a
   * seventh**:
   *
   * | counter | what it does |
   * |---|---|
   * | 0, 1, 2 | **draws** the picture of `$690F`, only `OR`, nothing rubbed out |
   * | 3, 4, 5 | **rubs the same three out again**, in the same order |
   * | 6 | puts the creature's own type back (`+6`), **rubs the creature out** and clears the slot |
   *
   * ★ That is why an explosion grows: it never rubs out the picture before
   * it, so the three pictures pile up, creature included, and only then come
   * off again. And its colour is **re-rolled every round** (`$68E1`:
   * `($5DCE) & 7 | $42`), which the record already carries in `+3`.
   *
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} was - The record as the round started — its `+4` is the
   *        counter the handler reads ($68B5, before it is stepped on).
   * @param {Object} is - The record as the round ended, for the new colour.
   * @param {number} level - The level counter.
   */
  stepExplosion(videoRAM, was, is, level) {
    var phase = was.flags & 0x07;
    var at = (is && is.type) ? is : was;
    if (phase >= 6) {
      // $68EE: the type in +6 is the creature's own, and it is what the last
      // round rubs out — the pixels of the creature the explosion covered
      var raw = was.raw || [];
      var creature = raw[6] || 0;
      this.blit(videoRAM, was,
                this.spriteFor(creature & 0x3F, !!(creature & 0x40), was.x), 'and');
      return;
    }
    var sprite = this.itemSources[this.gfx.explosionTable[phase]] || null;
    if (!sprite) {
      return;
    }
    if (phase >= 3) {
      this.blit(videoRAM, was, sprite, 'and');
      return;
    }
    this.blit(videoRAM, at, sprite, 'or');
    this.drawAttributes(videoRAM, at, sprite);
  } // stepExplosion

  /**
   * One round of a laser bolt — `$6FFC`, which draws nothing like a sprite.
   *
   * ★ The bolt is **one cell of $FF at a time**, poked straight into the
   * memory at the place the head **was** ($7024 works out the address before
   * it steps the record on, so the record always runs one cell ahead of the
   * picture), in the colour the record carries in `+7`.
   *
   * ★ Behind it the three bytes `+3`, `+4` and `+5` walk the same way and
   * **rub their cell out a slice at a time** — first $03, then $1C, then
   * $E0 ({@link LASER_FADE}) — so a bolt thins out from its tail instead of
   * going out in one go. A byte that has caught up with the head is skipped,
   * and one that has gone out stops the round where it stands ($7073 returns).
   *
   * @param {ZXVideoRAM} videoRAM - The memory to work in.
   * @param {Object} was - The bolt as the round started.
   * @param {Object} is - The bolt as the round ended.
   */
  stepLaser(videoRAM, was, is) {
    var before = (was && was.type === 0x10 && was.raw) || null;
    var after = (is && is.raw) || null;
    if (!before) {
      // ★ fired in this very round: Jetman's slot comes before the bolts',
      // so its handler has already run and the record is one cell on. Step it
      // back to draw it where it was ($7009: bit 0 says which way it goes).
      if (!after || !(after[0] & 0x3F)) {
        return;
      }
      before = after.slice();
      before[2] = (after[2] + ((after[2] & 0x01) ? 8 : -8)) & 0xFF;
    }
    var y = before[1];
    var head = before[2];
    if ((head & 0x04) && after && ((after[2] ^ head) & 0xF8)) {
      var at = ZXVideoRAM.addressOf(head & 0xF8, y);
      videoRAM.setPen(before[7]);
      videoRAM.poke(at.h, at.l, 0xFF);
      videoRAM.setPen(null);
      videoRAM.pokeAttribute(y >> 3, ((head & 0xF8) >> 3) & 0x1F, before[7]);
    }
    for (var trail = 0; trail < 3; trail++) {
      var byte = before[3 + trail];
      if (!((byte ^ head) & 0xF8)) {
        continue;                       // $7053: it is at the head, nothing yet
      }
      if (!(byte & 0x04)) {
        return;                         // $7073: gone out, and so is the round
      }
      var cell = ZXVideoRAM.addressOf(byte & 0xF8, y);
      videoRAM.poke(cell.h, cell.l,
                    ~ScreenComposer.LASER_FADE[trail] & 0xFF, 'and');
    }
  } // stepLaser

  /**
   * Composes a whole frame: the empty screen, the platforms, the panel and
   * every entity that is alive, in slot order — the order the original's main
   * loop walks them in ($6351), so two sprites that overlap come out the same
   * way round.
   * @param {ZXVideoRAM} videoRAM - The memory to build into.
   * @param {Object} state - The worker's 'frame' message: {entities, panel}.
   */
  composeInto(videoRAM, state) {
    this.clearScreen(videoRAM);
    this.drawPlatforms(videoRAM);
    if (state && state.panel) {
      this.drawPanel(videoRAM, Object.assign({labelFlash: !!(state.startDelay)},
                                             state.panel));
    }
    var level = (state && state.level) || 0;
    ((state && state.entities) || []).forEach((entity) => {
      if (!entity || !entity.type) {
        return;
      }
      // $73B2 and $7571 return before they draw while the start delay runs,
      // so Jetman is simply not on the screen yet
      if (state.startDelay && (entity.type === 1 || entity.type === 2)) {
        return;
      }
      if (entity.type >= 9 && entity.type <= 11) {
        // nothing is on the screen to rub out — the frame starts empty
        if (entity.type === 10 || entity.type === 11) {
          this.drawFlame(videoRAM, null, entity, state.pass);
        }
        this.drawRocket(videoRAM, entity, level, state.pass);
        return;
      }
      if (entity.type === 0x10) {
        this.drawLaser(videoRAM, entity);
        return;
      }
      this.drawSprite(videoRAM, entity, this.spriteOf(entity, level));
    });
  } // composeInto

} // ScreenComposer
