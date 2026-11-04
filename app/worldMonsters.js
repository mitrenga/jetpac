// begin code

/**
 * The wildlife: six ways of moving, one per kind of creature, transcribed from
 * the original's handlers — $6DD3, $6CF5, $6C2F, $63DA, $6AEF and $6A6C — plus
 * the spawning that puts them on the screen ($6A00).
 *
 * ★ **Which creature a level gets is a table, not a rule**: `$6A64` holds
 * eight bytes, one per level in the cycle, and each is the type of the handler
 * that level's creature runs (3, $11, 6, 7, $0F, 5, 3, $0F). Its pictures come
 * from `$6945` the same way — see screenComposer.prepareLevel.
 *
 * ★ **Most of them move twice per pass.** The handlers keep a flag in $5DC9:
 * the first time through they set it and jump back to the top of their own
 * body, so the whole movement and all its tests happen **twice** for every
 * pass of the main loop. Only the simple mover (type 3) and the diver (type 7)
 * go once. That is why the game feels as if the creatures were faster than
 * anything else on the screen — they are.
 *
 * ★ **What a creature is worth is in its handler**, not in a table: 25 for the
 * simple mover, 40, 50, 55, 60 and 80 for the others — every one of them an
 * operand of `LD BC,nn` ahead of `$70F9`.
 *
 * Checked against runs recorded off the running original by
 * `tools/matchentities.js`, pass by pass, all seventeen slots at once.
 */
var WorldMonsters = {

  /** ceiling of the play area for a creature ($6B8A, $6D56: CP $28) */
  CEILING: 0x28,
  /** what each handler is worth ($6481, $6C22, $6D90, $6E0E, $6AE6) */
  SCORE: {3: 0x0025, 5: 0x0060, 6: 0x0040, 7: 0x0055, 15: 0x0050, 17: 0x0080},

  /**
   * One pass over one creature.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Which slot.
   * @returns {boolean} True when this file dealt with it.
   */
  step: function(world, slot) {
    var type = world.entities[slot][0] & 0x3F;
    switch (type) {
      case 3:  this.stepDrifter(world, slot); return true;
      case 5:  this.stepBouncer(world, slot); return true;
      case 6:  this.stepDodger(world, slot); return true;
      case 7:  this.stepDiver(world, slot); return true;
      case 15: this.stepChaser(world, slot); return true;
      case 17: this.stepWalker(world, slot); return true;
      default: return false;
    }
  }, // step

  /**
   * $6DD3: the simple one. It drifts in a straight line at the speed its own
   * record carries, and the first thing it touches — a platform, a laser or
   * Jetman — is the end of it.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepDrifter: function(world, slot) {
    var record = world.entities[slot];
    record[1] = (record[1] + ((record[4] & 0x40) ? -record[5] : record[5])) & 0xFF;
    record[2] = (record[2] + record[6]) & 0xFF;
    if (this.platformTouch(world, record) & 0x04) {
      this.kill(world, slot, 0);                    // $6E14: no points for this
      return;
    }
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[3]);
      return;
    }
    this.killsJetman(world, slot);
  }, // stepDrifter

  /**
   * $6A6C: the walker. Two pixels a move, twice a pass, turning round at
   * whatever it runs into.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepWalker: function(world, slot) {
    var record = world.entities[slot];
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[17]);
      return;
    }
    if (this.killsJetman(world, slot)) {
      return;
    }
    for (var half = 0; half < 2; half++) {
      this.bounceOffPlatform(world, record, false);
      record[1] = (record[1] + ((record[4] & 0x40) ? 2 : -2)) & 0xFF;
      var y = record[2];
      if (record[4] & 0x80) {
        y = (y + 2) & 0xFF;
      } else {
        y = (y - 2) & 0xFF;
        if (y < 0x24) {
          record[4] |= 0x80;
        }
      }
      record[2] = y;
    }
  }, // stepWalker

  /**
   * $6CF5: the bouncer. It falls and rises on a speed of its own that grows
   * and shrinks, and a platform underneath resets it ($6D9E takes the new
   * speed from the random state).
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepBouncer: function(world, slot) {
    var record = world.entities[slot];
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[5], 1);
      return;
    }
    if (this.killsJetman(world, slot)) {
      return;
    }
    for (var half = 0; half < 2; half++) {
      var touch = this.platformTouch(world, record);
      if (touch & 0x04) {
        if (touch & 0x80) {
          record[4] &= ~0x80 & 0xFF;
          record[6] = (world.randomState + 8) & 0xFF;   // $6D9E
        } else if (touch & 0x10) {
          record[4] |= 0x80;
        } else {
          record[4] = (record[4] & 0xBF) | (((touch & 0x40) ^ 0x40) & 0x40);
        }
      }
      record[1] = (record[1] + ((record[4] & 0x40) ? -2 : 2)) & 0xFF;
      // the vertical step is (+6)*2 in eighths, with the fraction in +5
      var step = record[6]*2;
      var position = (record[2] << 8) | record[5];
      position += (record[4] & 0x80) ? step : -step;
      record[5] = position & 0xFF;
      record[2] = (position >> 8) & 0xFF;
      if (record[2] < this.CEILING) {
        record[4] |= 0x80;
      }
      if (record[4] & 0x80) {
        record[6] = (record[6]+1) & 0xFF;
        if (!record[6]) {
          record[6] = 0xFF;                         // $6D6A
        }
      } else {
        record[6] = (record[6]-1) & 0xFF;
        if (!record[6]) {
          record[4] |= 0x80;                        // $6DB9
        }
      }
    }
  }, // stepBouncer

  /**
   * $6C2F: the dodger. It walks along and now and then — when the low nibble
   * of the random state comes up nought — it takes a run at a height of its
   * own for a while.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepDodger: function(world, slot) {
    var record = world.entities[slot];
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[6], 1);
      return;
    }
    if (this.killsJetman(world, slot)) {
      return;
    }
    for (var half = 0; half < 2; half++) {
      // ★ **$6C4B is done twice when a run starts**: $6C90 jumps back to the
      // platform test instead of falling through, so the creature tests the
      // platforms again and the run's first two pixels happen in the **same**
      // half-step. The half-step flag ($5DC9) is not touched by that jump, so
      // it is one half-step with two tests in it, not three half-steps.
      for (var again = 0; again < 2; again++) {
        // ★ **The side bounce is not inverted here.** $6C5A takes bit 6 of the
        // test straight over ($6C5B: `AND $40`, no `XOR`) — the creature turns
        // **away** from the platform it has run into. Only the chaser ($6B1C)
        // and the bouncer ($6D22) turn the other way; `EE 40` stands in the
        // whole game at four places and two of them are Jetman's. With the
        // invert here the ball walked **into** the island, and because the
        // platforms are drawn once when the level starts ($60C0 is the only
        // caller of $766D) and a sprite is rubbed out with its own complement,
        // it ate the floor it went through and left its own colour in the
        // cells. That was **level 2 only** — it is the only level $6A64 gives
        // a type 6 to.
        this.bounceOffPlatform(world, record, false);
        if (record[4] & 0x01) {
          break;                                    // $6C67: already running
        }
        // $6C6D: not running — and a nought in the random nibble starts one
        var random = world.randomState;
        if ((random & 0x0F) !== 0) {
          break;                                    // $6C73
        }
        record[4] |= 0x01;                          // $6C75
        record[6] = (world.pass & 0x1F) + 0x10;     // $6C79
        record[4] = (record[4] & 0x7F) | (random & 0x80);
      }
      if (record[4] & 0x01) {
        // $6C92: climbing, two pixels a move until the counter runs out
        var y = record[2];
        if (record[4] & 0x80) {
          y = (y + 2) & 0xFF;
        } else {
          y = (y - 2) & 0xFF;
          if (y < this.CEILING) {
            record[4] |= 0x80;
          }
        }
        record[2] = y;
        record[6] = (record[6]-1) & 0xFF;
        if (!record[6]) {
          record[4] &= ~0x01 & 0xFF;
        }
      }
      record[1] = (record[1] + ((record[4] & 0x40) ? 2 : -2)) & 0xFF;
    }
  }, // stepDodger

  /**
   * $63DA: the diver. It hangs about until the random state says now, then
   * drops on Jetman's line and dives; whatever it hits, including the ground,
   * is the end of it.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepDiver: function(world, slot) {
    var record = world.entities[slot];
    var dx = 0, dy = 0;
    if (!(record[4] & 0x02)) {
      // $63EB: waiting — either the random state or Jetman's own line starts it
      var start = (world.randomState & 0x1F) === 0;
      var jetmanY = (world.entities[0][2] - 0x0C) & 0xFF;
      if (start || jetmanY === record[2]) {
        record[4] |= 0x02;                          // $640E
        record[5] = ((world.pass + (world.randomState & 0x1F)) & 0x7F) | 0x20;
        record[3] = 0x47;
      }
      dy = (world.pass & 0x40) ? 2 : -2;            // $63F9: drifting up or down
    } else {
      record[5] = (record[5]-1) & 0xFF;
      if (!record[5]) {
        this.kill(world, slot, this.SCORE[7]);      // $6481: it burns out
        return;
      }
      dx = (record[0] & 0x40) ? -4 : 4;
      dy = (world.entities[0][2] < record[2]) ? -2 : 2;
    }
    record[0] = (record[0] & 0xC0) | 0x03;          // $643D: drawn as a type 3
    record[1] = (record[1] + dx) & 0xFF;
    record[2] = (record[2] + dy) & 0xFF;
    if (record[2] < this.CEILING) {
      this.kill(world, slot, this.SCORE[7]);
      return;
    }
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[7]);
      return;
    }
    if (this.platformTouch(world, record) & 0x04) {
      this.kill(world, slot, this.SCORE[7]);
      return;
    }
    if (!this.killsJetman(world, slot)) {
      record[0] = (record[0] & 0xC0) | 0x07;        // $6476: back to its own type
    }
  }, // stepDiver

  /**
   * $6AEF: the chaser, which is the one that makes a level hard. It steers
   * after Jetman in **eighths of a pixel**: the low nibble of +5 and +6 is the
   * speed, the high nibble the fraction, and the speed creeps up towards him
   * and down away from him, fifteen being as fast as it gets.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   */
  stepChaser: function(world, slot) {
    var record = world.entities[slot];
    if (this.laserHit(world, record)) {
      this.kill(world, slot, this.SCORE[15]);
      return;
    }
    if (this.killsJetman(world, slot)) {
      return;
    }
    var jetman = world.entities[0];
    for (var half = 0; half < 2; half++) {
      this.bounceOffPlatform(world, record, true);
      this.chase(record, 1, 5, jetman[1], 0x40, false);
      this.chase(record, 2, 6, jetman[2], 0x80, true);
      if (record[2] < this.CEILING) {
        record[4] |= 0x80;
      }
    }
  }, // stepChaser

  /**
   * One axis of the chase ($6B28 and $6B5D are the same sum twice over).
   *
   * ★ **Ty dva bity nemají tentýž smysl a je to čitelné z instrukcí.** Na `x`
   * je nastavená šestka `SBC HL,DE` (`$6B49`), tedy pohyb **doleva**, a nula
   * `ADD HL,DE` (`$6BBA`), doprava — stejně jako u přímočarého (`$6DDD`).
   * Na `y` je to **naopak**: nastavená sedmička je `ADD` (`$6BE5`), tedy
   * **dolů**, nula `SBC` (`$6B80`), nahoru. Jeden společný znak pro obojí
   * dává tvoru, který na `x` míří přesně opačně, než chce — a protože
   * naháněč ($0F) je jen na planetách 4 a 7 a všechny záznamy `trace*` jsou
   * z planety 1, žádný `match*` to vidět nemohl (2026-09-18).
   * @param {Array} record - The creature's eight bytes.
   * @param {number} axis - 1 for x, 2 for y.
   * @param {number} speedByte - 5 for x, 6 for y.
   * @param {number} target - Where Jetman is on that axis.
   * @param {number} flag - Which bit of +4 carries the direction.
   * @param {boolean} plusWhenSet - Whether the set bit means the coordinate
   *        grows: false for `x` ($6B49 is `SBC`), true for `y` ($6BE5 is `ADD`).
   */
  chase: function(record, axis, speedByte, target, flag, plusWhenSet) {
    var speed = record[speedByte] & 0x0F;
    var fraction = record[speedByte] & 0xF0;
    // $6B36 / $6B6B: `SUB` and `JP P` — the sign bit of the eight bit difference
    var targetIsPlus = ((target - record[axis]) & 0xFF) < 0x80;
    var movingPlus = (record[4] & flag) ? plusWhenSet : !plusWhenSet;
    if (targetIsPlus === movingPlus) {
      if (speed < 0x0F) {                           // $6BC5 etc: CP $0F, INC A
        speed++;
      }
    } else {
      // ★ $6BB1: `DEC A; JP NZ` — the turn happens on the pass where the speed
      // **becomes** nought, not on the one after it. Sloužit s `speed < 0`
      // znamená jeden průchod navíc na nule a o ten pozdější obrat.
      speed--;
      if (speed <= 0) {
        speed = 0;
        record[4] ^= flag;
        movingPlus = !movingPlus;                   // ($6C12 dá DE = 0, takže
      }                                             //  na tomhle kroku je to jedno)
    }
    // $6C12: the step is (speed << 5) — a sixteenth of a pixel per unit
    var step = (speed << 5) & 0xFFFF;
    var position = (record[axis] << 8) | fraction;
    position += movingPlus ? step : -step;
    record[axis] = (position >> 8) & 0xFF;
    record[speedByte] = (position & 0xF0) | speed;
  }, // chase

  // ------------------------------------------------------------- the small

  /**
   * The common "what did I run into" of the handlers that bounce: a platform
   * on top turns the creature down, one underneath turns it up, and its side
   * sends it the other way.
   * @param {Object} world - The worker's state.
   * @param {Array} record - The creature's eight bytes.
   * @param {boolean} invert - Whether the side test is inverted. ★ In the whole
   *        game `XOR $40` stands at four places and two of them are Jetman's
   *        ($74B9, $7553); of the creatures only the **chaser** ($6B1C) and the
   *        **bouncer** ($6D22) turn into the side they touched. The walker
   *        ($6A94) and the dodger ($6C5A) take the bit straight over.
   */
  bounceOffPlatform: function(world, record, invert) {
    var touch = this.platformTouch(world, record);
    if (!(touch & 0x04)) {
      return;
    }
    if (touch & 0x80) {
      record[4] &= ~0x80 & 0xFF;
      return;
    }
    if (touch & 0x10) {
      record[4] |= 0x80;
      return;
    }
    var side = touch & 0x40;
    if (invert) {
      side ^= 0x40;
    }
    record[4] = (record[4] & 0xBF) | side;
  }, // bounceOffPlatform

  /**
   * $6E52: has one of the four laser shots reached this creature?
   *
   * ★ The routine walks the shot's record in a way worth reading twice: it
   * takes the **x of the first trailing segment** (+3) to compare against,
   * the **y of the shot** (+1), and when it hits it clears the low bits of
   * **the head** (+2) — which is what stops the shot advancing, so one shot
   * kills one creature and then dies away.
   * @param {Object} world - The worker's state.
   * @param {Array} record - The creature's eight bytes.
   * @returns {boolean} True when it was hit.
   */
  laserHit: function(world, record) {
    for (var index = 0; index < WorldEntities.SLOT.lasers.length; index++) {
      var shot = world.entities[WorldEntities.SLOT.lasers[index]];
      if (!shot[0] || !(shot[3] & 0x04)) {
        continue;
      }
      var dx = ((shot[3] & 0xF8) - record[1]) & 0xFF;
      var limit = 0x20;
      if (dx & 0x80) {
        dx = (-dx) & 0xFF;
        limit = 0x08;
      }
      if (dx >= limit) {
        continue;
      }
      var dy = (-((shot[1] - record[2]) & 0xFF)) & 0xFF;
      if (dy & 0x80) {
        continue;
      }
      if (((dy + 0x0C) & 0xFF) >= record[7]) {
        continue;
      }
      shot[2] &= 0xF8;                              // $6E91: the head stops here
      return true;
    }
    return false;
  }, // laserHit

  /**
   * $6E20 and $648D: walking into Jetman kills them both — the creature
   * explodes and so does he.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The creature's slot.
   * @returns {boolean} True when it happened.
   */
  killsJetman: function(world, slot) {
    if (!WorldEntities.touchesJetman(world, world.entities[slot])) {
      return false;
    }
    WorldEntities.explode(world, slot);
    // $6490: the death sound. ★ Only the slot is set up here; the noise comes
    // out of it **round by round** (WorldEntities.stepSound), as in the
    // original — one burst per round, three of them, falling in pitch.
    WorldEntities.startSound(world, 1);
    // $6875: Jetman's own slot is emptied and the explosion goes in the last one
    var jetman = world.entities[0];
    var last = world.entities[world.entities.length-1];
    last[1] = jetman[1];
    last[2] = jetman[2];
    // ★ $68AB keeps the **whole** type byte in +6, bit 6 and all, where $6894
    // keeps only (type & $C0) | 3 — which is how $68FE can tell afterwards
    // that what exploded was Jetman and take a life off
    last[6] = jetman[0];
    last[5] = 1;
    last[0] = 0x08;
    last[4] = 0;
    jetman[0] = 0;
    return true;
  }, // killsJetman

  /**
   * The end of a creature: the points, if there are any, and the explosion.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Its slot.
   * @param {number} score - What it was worth, or 0.
   */
  kill: function(world, slot, score, sound) {
    if (score) {
      WorldEntities.addScore(world, score);
    }
    WorldEntities.explode(world, slot);
    // the sound is the slot's, and it sounds round by round (stepSound)
    WorldEntities.startSound(world, sound || 0);
  }, // kill

  /**
   * The platform test — jetmanPhysics.js's, because the original has one
   * routine and everything asks it ($761D).
   * @param {Object} world - The worker's state.
   * @param {Array} record - The creature's eight bytes.
   * @returns {number} The bits E carries.
   */
  platformTouch: function(world, record) {
    return JetmanPhysics.platformTest(record, world.platforms);
  }, // platformTouch

  /**
   * $6A00: a creature turns up in the first free slot of the six from $5D50,
   * with its place, colour and direction taken from the counters — the y from
   * the pass counter, the colour from the slot's own address ($6A3C), and the
   * kind from the level's table at $6A64.
   * @param {Object} world - The worker's state.
   */
  spawn: function(world) {
    // ★ **Six slots, not seven**: $6A03 loads `B` with 6 and walks $5D50,
    // $5D58 … $5D78. The seventeenth record ($5D80) is in the table and the
    // main loop goes through it ($69B4 stops at $5D88), but **nic ho nikdy
    // neobsadí zhmotňováním** — dosáhne na něj jen výbuch ($6894). Počítadlo
    // $5DCB pustí nejvýš šest živých, takže se to pozná málokdy; věrné to má
    // být tak jako tak.
    var slots = WorldEntities.SLOT.enemies.slice(1, 7);   // $5D50..$5D78
    var slot = slots.find((index) => !world.entities[index][0]);
    if (slot === undefined) {
      return;
    }
    var record = world.templates.enemy.slice(0, 8);
    var counter = world.pass & 0xFF;
    record[4] = counter & 0x40;
    record[0] = counter & 0x40;
    record[2] = (counter & 0x7F) + 0x28;
    // $6A3C: the colour comes out of the slot's own address, two to five
    var address = 0x5D00 + 8*slot;
    record[3] = ((address >> 3) & 0x03) + 2;
    record[6] = record[3] & 0x01;
    record[0] = (record[0] & 0xC0) | world.enemyByLevel[world.level & 0x07];
    world.entities[slot] = record;
  } // spawn

}; // WorldMonsters

if (typeof self !== 'undefined') { self.WorldMonsters = WorldMonsters; }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {WorldMonsters: WorldMonsters};
}
