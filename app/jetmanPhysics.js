// begin code

/**
 * Jetman's physics — a transcription of the original's own two handlers,
 * `$73B2` (in the air) and `$7571` (on a platform), together with the platform
 * test `$761D` they both ask.
 *
 * Nothing here is invented. Every number is the operand of an actual
 * instruction, and `tools/matchphysics.js` replays runs recorded off the
 * running original (`tools/tracephysics.py`) step by step against this file:
 * the eight bytes of the entity record plus both coordinate fractions have to
 * come out the same, or the milestone is not done.
 *
 * ★ **One step is one frame**, not one pass of the entity loop. The original's
 * main loop walks the entities from $5D30 upwards over and over, but it only
 * reaches $5D00-$5D28 — Jetman, his four laser shots and the sound — when
 * `FRAMES` has changed: `$6351` compares it with $5DD4 and `$6965` rewrites
 * the loop's own limit ($69B5, self-modifying code) to make the short round.
 * So Jetman steps at 50.08 Hz while everything else steps as fast as the Z80
 * manages, which is the one place where the remake's fixed 50 Hz is exactly
 * right (ZADANI chap. 10).
 *
 * ★ **The arithmetic is 8.8.** A speed is a byte, the displacement per step is
 * `speed * 8` in 1/256 of a pixel, and the fraction lives outside the entity
 * record — in $5DC7 for x and $5DC8 for y. Acceleration is **8 per step**
 * (`$73F8`: `A = 8 - ($5DCA) + speed`, and ★ $5DCA is **nought** during play:
 * $61FE sets it to 4 before the menu, and starting a game wipes $5CF4-$5FFF
 * clean, $6333). The ceiling is $40 sideways and $3F vertically, so the fastest
 * Jetman flies is 2 pixels a frame.
 *
 * ★ **Bit 3 of the platform test is "at the edge"**, not "on the platform":
 * `$7631` only sets it when `|dx| + 18 >= width`. That is why a Jetman
 * standing in the middle of a platform with nothing held stays put, while one
 * standing at the very edge shuffles off it a pixel at a time ($75AA).
 */
var JetmanPhysics = {

  /** the record is the game's own eight bytes ($5D00) */
  TYPE: 0, X: 1, Y: 2, ATTR: 3, FLAGS: 4, SPEED_X: 5, SPEED_Y: 6, HEIGHT: 7,

  /** flags: bit 6 = moving left, bit 7 = moving down */
  FLAG_LEFT: 0x40,
  FLAG_DOWN: 0x80,
  /** type byte: bit 6 = facing left, bit 7 = no thrust (the falling pose) */
  FACE_LEFT: 0x40,
  NO_THRUST: 0x80,

  /** $73F8 / $745A: the step of acceleration, and the two ceilings */
  MAX_SPEED_X: 0x40,
  MAX_SPEED_Y: 0x3F,
  /** $74A4 / $749F: the top of the play area and the bottom of the screen */
  CEILING: 0x2A,
  BOTTOM: 0xC0,
  /** $75E2 / $75AA: the walk counter a direction press sets */
  WALK_HOLD: 0x20,

  /** what the platform test returns in E ($761D) */
  TOUCH: 0x04, EDGE: 0x08, FROM_BELOW: 0x10, RIGHT_OF: 0x40, ON_TOP: 0x80,

  /**
   * One step of Jetman.
   * @param {Object} state - {record, fracX, fracY, delay, frames, accel}, the
   *        game's own bytes; changed in place.
   * @param {Object} controls - {left, right, thrust, fire}.
   * @param {Array} platforms - The four platform records of data/sprites.json.
   * @returns {Object} What happened that is somebody else's business:
   *          {flash, landed, tookOff, fired}.
   */
  step: function(state, controls, platforms) {
    var record = state.record;
    var events = {flash: false, landed: false, tookOff: false, fired: false};

    // $73B2: the delay at the start of a life. While it runs, Jetman is not
    // drawn at all and the label of the player whose turn it is flashes.
    if (state.delay) {
      state.delay = (state.delay-1) & 0xFF;
      if (state.delay) {
        events.flash = true;
        return events;
      }
    }

    if ((record[this.TYPE] & 0x3F) === 2) {
      return this.stepOnPlatform(state, controls, platforms, events);
    }
    return this.stepInAir(state, controls, platforms, events);
  }, // step

  /**
   * $73D3: in the air.
   * @param {Object} state - The state, changed in place.
   * @param {Object} controls - {left, right, thrust, fire}.
   * @param {Array} platforms - The platform records.
   * @param {Object} events - Filled in as things happen.
   * @returns {Object} The events.
   */
  stepInAir: function(state, controls, platforms, events) {
    var record = state.record;

    // ---- sideways ($73ED / $7536 / $7562)
    if (controls.right) {
      record[this.TYPE] &= ~this.FACE_LEFT & 0xFF;
      if (record[this.FLAGS] & this.FLAG_LEFT) {
        this.slowDownX(state);
      } else {
        this.speedUpX(state);
      }
    } else if (controls.left) {
      record[this.TYPE] |= this.FACE_LEFT;
      if (record[this.FLAGS] & this.FLAG_LEFT) {
        this.speedUpX(state);
      } else {
        this.slowDownX(state);
      }
    } else if (state.frames & 1) {
      // ★ $73E3: with nothing held he only slows down on **every other pass**
      // — the parity of the pass counter $5DCC, not of the frame
      var braked = (record[this.SPEED_X] - 8) & 0xFF;
      record[this.SPEED_X] = (braked & 0x80) ? 0 : braked;
    }
    this.moveX(state);

    // ---- up and down ($742D onwards)
    // ★ $7435: the whole **number row** (and DOWN on a Kempston) kills the
    // vertical speed outright. It is not in any instructions; it is in the
    // code, and it is the only use the game has for those keys in flight.
    if (controls.brake) {
      record[this.SPEED_Y] = 0;
    } else if (controls.thrust) {
      record[this.TYPE] &= ~this.NO_THRUST & 0xFF;
      if (record[this.FLAGS] & this.FLAG_DOWN) {
        this.slowDownY(state);
      } else {
        this.speedUpY(state);
      }
    } else {
      record[this.TYPE] |= this.NO_THRUST;
      if (record[this.FLAGS] & this.FLAG_DOWN) {
        this.speedUpY(state);
      } else {
        this.slowDownY(state);
      }
    }
    this.moveY(state);

    // ---- where that left him ($749F)
    var y = record[this.Y];
    if (y >= this.BOTTOM) {
      // off the bottom of the screen: turn him round, he comes back up
      record[this.FLAGS] &= ~this.FLAG_DOWN & 0xFF;
    } else if (y < this.CEILING) {
      // ★ $74FA: the ceiling of the play area does not stop him, it turns him
      // round and **halves** what he had — and when the half is nought the
      // store is skipped, so the speed stays as it was
      record[this.FLAGS] |= this.FLAG_DOWN;
      var halved = record[this.SPEED_Y] >> 1;
      if (halved) {
        record[this.SPEED_Y] = halved;
      }
    }

    // ---- platforms ($74A8)
    var touch = this.platformTest(record, platforms);
    if (touch & this.TOUCH) {
      if (touch & this.ON_TOP) {
        // $74DC: standing on it — the type changes and both speeds go
        record[this.FLAGS] &= ~this.FLAG_DOWN & 0xFF;
        record[this.TYPE] = (record[this.TYPE] & 0xC0) | 0x02;
        record[this.SPEED_X] = 0;
        record[this.SPEED_Y] = 0;
        events.landed = true;
      } else if (touch & this.FROM_BELOW) {
        // $74D6: knocked his head on it, so he goes down
        record[this.FLAGS] |= this.FLAG_DOWN;
      } else {
        // $74B8: caught its side — he is pushed away from it
        record[this.FLAGS] = (record[this.FLAGS] & 0xBF)
                             | ((touch ^ this.FLAG_LEFT) & this.FLAG_LEFT);
      }
    }

    // $74CD: and the laser, which is read after everything else
    if (controls.fire) {
      events.fired = true;
    }
    return events;
  }, // stepInAir

  /**
   * $7571: standing on a platform.
   * @param {Object} state - The state, changed in place.
   * @param {Object} controls - {left, right, thrust, fire}.
   * @param {Array} platforms - The platform records.
   * @param {Object} events - Filled in as things happen.
   * @returns {Object} The events.
   */
  stepOnPlatform: function(state, controls, platforms, events) {
    var record = state.record;

    // $75E2 / $75F4: a pixel a frame while a direction is held
    if (controls.right) {
      record[this.X] = (record[this.X]+1) & 0xFF;
      record[this.TYPE] &= ~this.FACE_LEFT & 0xFF;
      record[this.FLAGS] &= ~this.FLAG_LEFT & 0xFF;
      record[this.SPEED_X] = this.WALK_HOLD;
    } else if (controls.left) {
      record[this.X] = (record[this.X]-1) & 0xFF;
      record[this.TYPE] |= this.FACE_LEFT;
      record[this.FLAGS] |= this.FLAG_LEFT;
      record[this.SPEED_X] = this.WALK_HOLD;
    } else {
      record[this.SPEED_X] = 0;
    }

    // $7584: the thrust, or the ground running out, puts him in the air
    var touch = this.platformTest(record, platforms);
    if (controls.thrust || !(touch & this.TOUCH)) {
      record[this.TYPE] = (record[this.TYPE] & 0xC0) | 0x01;
      // ★ $75B4 leaves the puff behind **where he was**, and only then lifts
      // him the two pixels — so the position goes with the event, not after it
      events.tookOff = {x: record[this.X], y: record[this.Y]};
      record[this.Y] = (record[this.Y]-2) & 0xFF;
      if (controls.fire) {
        events.fired = true;
      }
      return events;
    }

    // ★ $7592: only **at the edge** of a platform does he shuffle by himself
    // — bit 3 is set when |dx| + 18 >= width, which is what "edge" means here
    if ((touch & this.EDGE) && !record[this.SPEED_X]) {
      if (record[this.TYPE] & this.FACE_LEFT) {
        record[this.X] = (record[this.X]-1) & 0xFF;
      } else {
        record[this.X] = (record[this.X]+1) & 0xFF;
        record[this.SPEED_X] = this.WALK_HOLD;
      }
    }

    if (controls.fire) {
      events.fired = true;
    }
    return events;
  }, // stepOnPlatform

  // ------------------------------------------------------------- the sums

  /** $73F8: 8 per step, up to $40 */
  speedUpX: function(state) {
    var faster = (8 - state.accel + state.record[this.SPEED_X]) & 0xFF;
    state.record[this.SPEED_X] = (faster >= this.MAX_SPEED_X) ? this.MAX_SPEED_X : faster;
  }, // speedUpX

  /** $7541: 8 off, and when it goes below nought the direction turns round */
  slowDownX: function(state) {
    var slower = (state.record[this.SPEED_X] + state.accel - 8) & 0xFF;
    if (slower & 0x80) {
      state.record[this.SPEED_X] = 0;
      state.record[this.FLAGS] ^= this.FLAG_LEFT;
    } else {
      state.record[this.SPEED_X] = slower;
    }
  }, // slowDownX

  /** $745A: 8 per step, up to $3F */
  speedUpY: function(state) {
    var faster = (8 - state.accel + state.record[this.SPEED_Y]) & 0xFF;
    state.record[this.SPEED_Y] = (faster >= this.MAX_SPEED_Y) ? this.MAX_SPEED_Y : faster;
  }, // speedUpY

  /** $7515: 8 off, and when it goes below nought he starts going the other way */
  slowDownY: function(state) {
    var slower = (state.record[this.SPEED_Y] + state.accel - 8) & 0xFF;
    if (slower & 0x80) {
      state.record[this.SPEED_Y] = 0;
      state.record[this.FLAGS] ^= this.FLAG_DOWN;
    } else {
      state.record[this.SPEED_Y] = slower;
    }
  }, // slowDownY

  /** $740F: x and its fraction, as one 16 bit number */
  moveX: function(state) {
    var step = state.record[this.SPEED_X]*8;
    var position = (state.record[this.X] << 8) | state.fracX;
    position += (state.record[this.FLAGS] & this.FLAG_LEFT) ? -step : step;
    state.fracX = position & 0xFF;
    state.record[this.X] = (position >> 8) & 0xFF;
  }, // moveX

  /** $7481: the same for y, where bit 7 of the flags means downwards */
  moveY: function(state) {
    var step = state.record[this.SPEED_Y]*8;
    var position = (state.record[this.Y] << 8) | state.fracY;
    position += (state.record[this.FLAGS] & this.FLAG_DOWN) ? step : -step;
    state.fracY = position & 0xFF;
    state.record[this.Y] = (position >> 8) & 0xFF;
  }, // moveY

  /**
   * $761D: does this entity touch a platform, and how.
   *
   * The platforms are four records of `[colour, x, y, width]` at $6000, and
   * the test is on **boxes, not pixels**: the horizontal distance from the
   * platform's centre against its width, then the vertical distance against
   * the entity's own height (+7).
   * @param {Array} record - The entity's eight bytes.
   * @param {Array} platforms - The platform records of data/sprites.json.
   * @returns {number} The bits the original returns in E.
   */
  platformTest: function(record, platforms) {
    for (var index = 0; index < platforms.length; index++) {
      var platform = platforms[index];
      var result = 0;
      var distance = (platform.x - record[this.X]) & 0xFF;
      if (distance & 0x80) {
        // ★ to the right of the platform's middle, and that is the **only**
        // difference: $762D turns the distance round and goes straight on,
        // while the other side goes through $7606 first. So the nine pixels
        // an enemy is narrowed by are taken off **on one side only** — which
        // is why a creature drifting leftwards dies a few pixels later than
        // one drifting right.
        distance = (-distance) & 0xFF;
        result |= this.RIGHT_OF;
      } else if ((record[this.TYPE] & 0x3F) === 3) {
        // $7606: an enemy (type 3) counts as nine pixels narrower
        var narrower = (distance - 9) & 0xFF;
        if (!(narrower & 0x80)) {
          distance = narrower;
        }
      }
      if (distance >= platform.width) {
        continue;
      }
      if (((distance + 0x12) & 0xFF) >= platform.width) {
        result |= this.EDGE;
      }
      // how far below the platform's own line he is, plus two
      var below = ((record[this.Y] - platform.y) + 2) & 0xFF;
      if (below & 0x80) {
        continue;                      // above it altogether
      }
      if (below < 2) {
        return result | this.ON_TOP | this.TOUCH;
      }
      if (below < record[this.HEIGHT]) {
        return result | this.TOUCH;
      }
      if (((below - 2) & 0xFF) >= record[this.HEIGHT]) {
        continue;
      }
      return result | this.FROM_BELOW | this.TOUCH;
    }
    return 0;
  } // platformTest

}; // JetmanPhysics

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {JetmanPhysics: JetmanPhysics};
}
