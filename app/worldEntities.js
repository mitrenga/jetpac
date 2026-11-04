// begin code

/**
 * The world: the rocket, the pieces that build it, the fuel, the treasures,
 * the laser shots and the explosions — a transcription of the original's own
 * handlers, one slot of the entity table at a time.
 *
 * As with jetmanPhysics.js nothing here is invented: every number is the
 * operand of an actual instruction and `tools/matchentities.js` replays runs
 * recorded off the running original pass by pass against this file.
 *
 * ★ **The slots are not interchangeable.** $5D30 is the rocket, $5D38 and
 * $5D40 are the two item slots — at the start of a level they hold the two
 * pieces the rocket is missing, and once it is built the game reuses the very
 * same two slots for the fuel ($6630 copies the template at $6030 into $5D38)
 * and for the treasure ($65DF copies $6038 into $5D40). $5D08 to $5D20 are the
 * four laser shots.
 *
 * ★ **An item is a state machine in its flags byte** ($651F): with no bits set
 * it lies still and is only drawn; bit 0 means it is falling and can be picked
 * up; bit 1 that Jetman is carrying it; bit 2 that it has been dropped over
 * the rocket and is settling onto it. The rocket grows by one piece
 * ($5D34) or one load of fuel ($5D35) when a piece reaches it.
 *
 * ★ **The laser is screen work, not a sprite** ($6FFC): the shot pokes $FF
 * into the video memory, keeps the positions of its three segments in its own
 * record (+3, +4, +5) and rubs them out again, and it stops when the byte
 * ahead of it is not empty — but **only above y = $80** ($7016 skips the read
 * below that). What it can hit is asked the other way round: an enemy looks
 * through the four shot slots itself ($6E52).
 */
var WorldEntities = {

  /** the slots, as the original lays them out ($5D00 + 8*slot) */
  SLOT: {jetman: 0, lasers: [1, 2, 3, 4], sound: 5, rocket: 6,
         items: [7, 8], enemies: [9, 10, 11, 12, 13, 14, 15, 16]},

  /** $655A / $64AE / $6FC5: what things are worth, in the BCD the game uses */
  SCORE_PIECE: 0x0100,        // a piece of the rocket or a load of fuel
  SCORE_TREASURE: 0x0250,     // a treasure

  /** $659C: the +6 byte of an item says what it is — $18 is fuel */
  FUEL: 0x18,
  /** $6710: the rocket leaves when it has six loads in it */
  FUEL_FULL: 6,
  /** $66D8 / $66FC: where a launch ends and a landing does */
  LAUNCH_TOP: 0x28,
  LANDING_BOTTOM: 0xB7,
  /** ★ odchylka: kolik tiků nese jeden bod letu rakety (viz flyingRocketTick) */
  ROCKET_TICKS: 3,

  /**
   * **One pass of the main loop**, in the order the original walks it
   * ($6345-$6A61):
   *
   * 1. when `FRAMES` has changed, the short round over $5D00-$5D28 — Jetman,
   *    his four shots and the sound ($6965 patches the loop's own limit to do
   *    it, $69B5)
   * 2. the long round over $5D30-$5D80 — the rocket, the two items and the
   *    creatures
   * 3. the counters and the random state ($69C7)
   * 4. and what turns up: a creature ($6A00), a load of fuel ($6630), a
   *    treasure ($65DF)
   *
   * ★ **The counter moves on once per round, not once per pass.** `$69C7`
   * sits at the end of the loop and both rounds go through it — the short one
   * as well, which then jumps out over the random update ($69D3 is patched to
   * a JP). So a pass in which a frame went by moves $5DCC on by two, and the
   * spawning that reads it lands somewhere else. Getting that wrong is worth
   * a pixel or two on every creature that turns up.
   *
   * @param {Object} world - The worker's state.
   * @param {number} rounds - How many short rounds happened in this pass —
   *        one per frame that went by, which at the remake's fixed 50 Hz is
   *        always one.
   * @param {Array} [roundsAt] - At which slot each of those short rounds cut
   *        in. The original asks $6351 before every entity, so a short round
   *        lands in the middle of the long one, and the random state — which
   *        moves on after every entity — depends on where. Without it they all
   *        happen at the start, which is what the remake itself does.
   */
  pass: function(world, rounds, roundsAt) {
    world.events = [];

    var pending = rounds;
    if (!roundsAt || !roundsAt.length) {
      for (var round = 0; round < rounds; round++) {
        this.shortRound(world);
      }
      pending = 0;
    }
    this.longRound(world, roundsAt, pending);
  }, // pass

  /**
   * One short round on its own — Jetman, his shots and the sound — with the
   * counter it moves on ($69C7 is at the end of both rounds).
   * @param {Object} world - The worker's state.
   */
  shortRound: function(world) {
    this.flyingRocketTick(world);
    this.frameRound(world);
    world.pass = (world.pass+1) & 0xFFFF;
  }, // shortRound

  /**
   * ★ **Vědomá odchylka** (2026-09-18, `ZADANI.md` §10/8): letící raketa visí
   * na **tiku**, ne na dlouhém kole.
   *
   * Originál ji posouvá o bod za dlouhé kolo (`$66CA`, `$66EE`) a cesta
   * z `$B7` na `$28` je 143 bodů, tedy 11,4 s při osmdesátimilisekundovém
   * kole. Zrychlit ji uvnitř dlouhého kola nejde čistě: druhá možná rychlost
   * jsou dva body za kolo, tedy dvojnásobek, a všechno mezi tím je vzorek,
   * ve kterém jeden krok ze čtyř skočí o dva body naráz — a **to je vidět
   * jako škubnutí**, protože ostatní kroky jsou po jednom.
   *
   * Tik je 20 ms a je to jediný časovač, který hra má, takže rychlosti
   * s krokem jednoho bodu jsou 40, 60, 80 ms a nic mezi. **60 ms**, tedy
   * **jeden bod za tři tiky**, je jediná rozumná v okolí osmdesátky: pohyb
   * zůstane po jednom bodu a rovnoměrný, a vyjde z toho 8,58 s.
   *
   * Dlouhé kolo letící raketu přeskakuje, aby ji neposunulo dvakrát.
   * @param {Object} world - The worker's state.
   */
  flyingRocketTick: function(world) {
    var slot = this.SLOT.rocket;
    var type = world.entities[slot][0] & 0x3F;
    if (type !== 10 && type !== 11) {
      world.rocketTicks = 0;
      return;
    }
    world.rocketTicks = ((world.rocketTicks || 0) + 1) % this.ROCKET_TICKS;
    if (world.rocketTicks) {
      return;
    }
    this.step(world, slot);
  }, // flyingRocketTick

  /**
   * One long round on its own — the rocket, the items and the creatures,
   * then the counters and whatever turns up.
   * @param {Object} world - The worker's state.
   * @param {Array} [roundsAt] - Where short rounds cut in (the match tool
   *        knows; the worker does not).
   * @param {number} [pending] - How many of those are still to come.
   */
  longRound: function(world, roundsAt, pending) {
    world.liveCount = 0;
    pending = pending || 0;
    for (var index = this.SLOT.rocket; index < world.entities.length; index++) {
      while (pending > 0 && roundsAt && roundsAt.length
             && roundsAt[0].slot <= index && roundsAt[0].slot >= this.SLOT.rocket) {
        world.frame = roundsAt.shift().frame;
        pending--;
        this.shortRound(world);
      }
      var type = world.entities[index][0] & 0x3F;
      if (type) {
        if (type === 8 || (type >= 3 && type !== 4 && type !== 14
                           && !(type >= 9 && type <= 13) && type !== 16)) {
          world.liveCount++;                        // $5DCB: what the spawner counts
        }
        // ★ letící raketu obsluhuje flyingRocketTick po tiku — viz tam
        if (index === this.SLOT.rocket && (type === 10 || type === 11)) {
          this.stirRandom(world);
          continue;
        }
        if (!this.step(world, index)) {
          WorldMonsters.step(world, index);
        }
      }
      this.stirRandom(world);
    }
    while (pending > 0) {
      if (roundsAt && roundsAt.length) {
        world.frame = roundsAt.shift().frame;
      }
      this.shortRound(world);
      pending--;
    }

    // ★ $69C7 comes **after** the entity loop and **before** anything turns
    // up: the counter and the random state are moved on first, so the spawning
    // below already works with the new ones. Getting that order wrong is worth
    // a whole pass of difference.
    world.pass = (world.pass+1) & 0xFFFF;
    world.randomState = world.nextRandom();
    this.spawnCreature(world);
    this.spawnFuel(world);
    this.spawnTreasure(world);
  }, // longRound

  /**
   * ★ $69AB: **the random state moves on after every entity**, empty slots
   * included — the return address every handler comes back to is $69A8, and
   * the first thing there is `INC (HL)` with HL pointing at $5DCE. It is not
   * a generator, it is a counter that gets stirred: once a round the end of
   * the loop mixes in a byte of the Spectrum's ROM and the refresh register
   * ($69C7), and in between it simply counts entities.
   *
   * That is why two explosions in one round flicker in different colours,
   * and why a remake that only stirred it once a round would get every one
   * of those colours wrong.
   * @param {Object} world - The worker's state.
   */
  stirRandom: function(world) {
    world.randomState = (world.randomState+1) & 0xFF;
  }, // stirRandom

  /**
   * $6965: the short round — Jetman, his four shots and the sound. It is the
   * one the game patches its own loop limit for, and it happens once per
   * frame however fast the rest is going.
   * @param {Object} world - The worker's state.
   */
  frameRound: function(world) {
    // ★ FRAMES is what the laser's rate limit counts ($6F94). Measured on the
    // original: the round that fires runs with the **boundary value** of both
    // FRAMES and the pass counter, so both are moved on at the end of the
    // round, not at its start.
    // the dispatch is the dispatch: a slot whose type is nought goes to
    // $691B, which does nothing at all. Without this a dead Jetman would be
    // stepped by the physics and land on his feet again.
    var type = world.entities[this.SLOT.jetman][0] & 0x3F;
    if (type !== 1 && type !== 2) {
      this.stirRandom(world);
      this.frameRoundRest(world);
      world.frame = (world.frame+1) & 0xFFFF;
      return;
    }
    var state = {record: world.entities[this.SLOT.jetman], fracX: world.fracX,
                 fracY: world.fracY, delay: world.startDelay,
                 frames: world.pass, accel: world.accel};
    var events = JetmanPhysics.step(state, world.controls, world.platforms);
    world.fracX = state.fracX;
    world.fracY = state.fracY;
    world.startDelay = state.delay;
    this.applyJetman(world, events);
    this.stirRandom(world);
    this.frameRoundRest(world);
    world.frame = (world.frame+1) & 0xFFFF;
  }, // frameRound

  /**
   * The rest of the short round: the four shots and the sound, each of them
   * only when its slot holds what it should ($6374 again).
   * @param {Object} world - The worker's state.
   */
  frameRoundRest: function(world) {
    for (var laser = 0; laser < this.SLOT.lasers.length; laser++) {
      var slot = this.SLOT.lasers[laser];
      if ((world.entities[slot][0] & 0x3F) === 0x10) {
        this.stepLaser(world, slot);
      }
      this.stirRandom(world);
    }
    var sound = world.entities[this.SLOT.sound][0] & 0x3F;
    if (sound === 12 || sound === 13) {
      this.stepSound(world, this.SLOT.sound);
    }
    this.stirRandom(world);
  }, // frameRoundRest

  /**
   * What Jetman's step asks of the rest of the world: the laser and, since
   * the physics knows nothing of slots, keeping the fractions where the
   * worker holds them.
   * @param {Object} world - The worker's state.
   * @param {Object} events - What JetmanPhysics.step returned.
   */
  applyJetman: function(world, events) {
    if (events.fired) {
      this.fire(world);
    }
    if (events.tookOff) {
      // ★ $75B4: leaving a platform leaves a **puff** behind — the first
      // creature slot ($5D48) gets Jetman's own position and is exploded on
      // the spot, which is why the slot is reserved and the creatures proper
      // start one slot further up ($5D50, $6A00).
      var puff = world.entities[this.SLOT.enemies[0]];
      if (!puff[0]) {
        puff[0] = 0x03;
        puff[1] = events.tookOff.x;
        puff[2] = events.tookOff.y;
        this.explode(world, this.SLOT.enemies[0]);
      }
      world.events.push({id: 'takeOff'});
    }
  }, // applyJetman

  /**
   * $69DB-$6A00: whether a creature turns up this pass. Two ways in — while
   * there are fewer than three of them one turns up every pass, and up to six
   * one turns up when the random state's low five bits come out nought — and
   * neither happens while the start delay runs or Jetman is not alive.
   * @param {Object} world - The worker's state.
   */
  spawnCreature: function(world) {
    var type = world.entities[this.SLOT.jetman][0] & 0x3F;
    if (world.startDelay || (type !== 1 && type !== 2)) {
      return;
    }
    if (world.liveCount >= 3) {
      if ((world.randomState & 0x1F) !== 0 || world.liveCount >= 6) {
        return;
      }
    }
    WorldMonsters.spawn(world);
  }, // spawnCreature

  /**
   * One pass over one entity — the dispatch of $6374, for everything that is
   * not Jetman and not an enemy.
   * @param {Object} world - The worker's state.
   * @param {number} slot - Which of the seventeen slots.
   * @returns {boolean} True when this file dealt with it.
   */
  step: function(world, slot) {
    var record = world.entities[slot];
    var type = record[0] & 0x3F;
    switch (type) {
      case 4:  this.stepItem(world, slot); return true;
      case 8:  this.stepExplosion(world, slot); return true;
      case 9:  this.stepRocketWaiting(world, slot); return true;
      case 10: this.stepRocketLaunching(world, slot); return true;
      case 11: this.stepRocketLanding(world, slot); return true;
      case 14: this.stepTreasure(world, slot); return true;
      case 16: this.stepLaser(world, slot); return true;
      case 12:
      case 13: this.stepSound(world, slot); return true;
      default: return false;
    }
  }, // step

  // ----------------------------------------------------------- the rocket

  /**
   * $6707: the rocket standing on the ground. It only does anything when
   * Jetman walks into it with the tank full — then he **gets into it**: his
   * own slot is emptied, a life goes back on the counter ($672F) and the
   * rocket starts climbing.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The rocket's slot.
   */
  stepRocketWaiting: function(world, slot) {
    var record = world.entities[slot];
    if (this.touchesJetman(world, record) && record[5] >= this.FUEL_FULL) {
      record[0]++;                                  // $6717: waiting -> launching
      world.entities[this.SLOT.jetman][0] = 0;      // $6726: Jetman is in it now
      world.lives[world.player-1]++;                // $672F
      world.events.push({id: 'boarded'});
    }
  }, // stepRocketWaiting

  /**
   * $66C7: climbing away. One pixel a pass, and when it is off the top the
   * level is over: the counter goes up, both item slots are emptied and the
   * next planet is set up.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The rocket's slot.
   */
  stepRocketLaunching: function(world, slot) {
    var record = world.entities[slot];
    record[2] = (record[2]-1) & 0xFF;
    // $66CD: the exhaust roars on every pass of the climb, and ★ its pitch is
    // the rocket's own y ($67ED), so the note falls as it goes up
    world.events.push({id: 'flame', y: record[2]});
    if (record[2] >= this.LAUNCH_TOP) {
      return;
    }
    world.level = (world.level+1) & 0xFF;           // $66DD
    this.clearItemsAndEnemies(world);               // $665B
    record[0]++;                                    // launching -> landing
    record[5] = 0;
    world.events.push({id: 'levelDone', level: world.level});
    this.newPlanet(world);                          // $66E8
  }, // stepRocketLaunching

  /**
   * $66EB: coming down on the next planet. When it is back on the ground the
   * rocket waits again and a life starts ($619A), delay and all.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The rocket's slot.
   */
  stepRocketLanding: function(world, slot) {
    var record = world.entities[slot];
    record[2] = (record[2]+1) & 0xFF;
    world.events.push({id: 'flame', y: record[2]});
    if (record[2] < this.LANDING_BOTTOM) {
      return;
    }
    record[0] = 9;                                  // $66FE: waiting again
    // ★ $6702: a life **starts** here, and that is not just the countdown —
    // $619A puts Jetman's record back (he has been inside the rocket since
    // $6726 emptied his slot) and takes one off the counter. The one he got
    // for boarding ($672F) pays for it, so a planet costs nothing; without
    // this, though, Jetman never comes back and the next planet cannot be
    // played at all.
    this.beginLife(world);
    world.events.push({id: 'landed'});
  }, // stepRocketLanding

  // ------------------------------------------------------------ the items

  /**
   * $651F: a piece of the rocket, or a load of fuel. Which it is, is its +6
   * byte: $18 is fuel, anything else a piece.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The item's slot.
   */
  stepItem: function(world, slot) {
    var record = world.entities[slot];
    var flags = record[4];

    if (flags & 0x04) {
      this.stepItemSettling(world, slot);
      return;
    }
    if (flags & 0x02) {
      this.stepItemCarried(world, slot);
      return;
    }
    if (!(flags & 0x01)) {
      return;                                       // $654B: lying still
    }
    // $6532: falling, and Jetman can pick it up
    if (this.touchesJetman(world, record)) {
      record[4] |= 0x02;                            // $655A: carried
      this.addScore(world, this.SCORE_PIECE);
      var jetman = world.entities[this.SLOT.jetman];
      record[1] = jetman[1];
      record[2] = jetman[2];
      world.events.push({id: 'pickUp'});
      return;
    }
    if (!(this.platformTouch(world, record) & 0x04)) {
      record[2] = (record[2]+2) & 0xFF;             // $653F: two pixels a pass
    }
  }, // stepItem

  /**
   * $6578: carried. It hangs on Jetman until he is within six pixels of the
   * rocket's own x, and then it is let go over it.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The item's slot.
   */
  stepItemCarried: function(world, slot) {
    var record = world.entities[slot];
    var jetman = world.entities[this.SLOT.jetman];
    record[1] = jetman[1];
    record[2] = jetman[2];
    var rocketX = world.entities[this.SLOT.rocket][1];
    var distance = (rocketX - record[1]) & 0xFF;
    if (distance & 0x80) {
      distance = (-distance) & 0xFF;
    }
    if (distance >= 0x06) {
      return;
    }
    record[4] |= 0x04;                              // $6590: over the rocket
    record[1] = rocketX;
  }, // stepItemCarried

  /**
   * $659C: let go over the rocket and settling onto it. A piece lands on top
   * of what is already there, a load of fuel goes in lower down.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The item's slot.
   */
  stepItemSettling: function(world, slot) {
    var record = world.entities[slot];
    var rocket = world.entities[this.SLOT.rocket];
    if (record[6] === this.FUEL) {
      // $65CE: fuel, which simply has to reach the ground
      if (record[2] < 0xB0) {
        record[2] = (record[2]+2) & 0xFF;
        return;
      }
      rocket[5] = (rocket[5]+1) & 0xFF;             // $65D9: one more load
      record[0] = 0;
      world.events.push({id: 'fuelled', fuel: rocket[5]});
      return;
    }
    // $65A3: a piece stops on top of the pieces already there
    if (((record[6]*2 + record[2]) & 0xFF) < 0xB7) {
      record[2] = (record[2]+2) & 0xFF;
      return;
    }
    world.entities[this.SLOT.items[0]][4] |= 0x01;  // $65AD
    rocket[4] = (rocket[4]+1) & 0xFF;               // $65B9: one more piece
    record[0] = 0;
    // ★ $65BC: and the **next** thing to be carried is pre-shifted into the
    // buffer, `+6` plus eight — so the first piece hands over to the second
    // and the second to the fuel ($18). Nothing else ever puts a picture
    // there, which is why the buffer always holds the one thing that is in
    // the air. The worker has no graphics, so it only says which one it is
    // and `ScreenComposer.prepareCarried()` does the shifting.
    world.carried = (record[6] + 0x08) & 0xFF;
    world.events.push({id: 'built', pieces: rocket[4], carried: world.carried});
  }, // stepItemSettling

  /**
   * $6498: a treasure. It falls until it finds a platform, and Jetman gets
   * 250 for walking into it.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The treasure's slot.
   */
  stepTreasure: function(world, slot) {
    var record = world.entities[slot];
    if (!(this.platformTouch(world, record) & 0x04)) {
      record[2] = (record[2]+2) & 0xFF;
    }
    if (this.touchesJetman(world, record)) {
      record[0] = 0;
      this.addScore(world, this.SCORE_TREASURE);
      world.events.push({id: 'treasure'});
      return;
    }
    this.treasureColour(world, record);
  }, // stepTreasure

  /**
   * $64CD: a treasure has **five kinds and five colours**, and the kind — the
   * low nibble of its `+6` — picks which, through the jump table at $64CD.
   *
   * | kind | what it does |
   * |---|---|
   * | 0 | `$46` and nothing else ($64D7) |
   * | 2, 4 | **blinks**: black while `($5DCC) AND $1F` is below `$18`, `$45` above ($64F9) |
   * | 6 | `$44` ($64F3) |
   * | 8 | **cycles**: `($5DCC)` rotated twice right, `AND 7`, nought stepped to one, `OR $40` ($650E) |
   *
   * ★ Without this the colour stays at the nought its template carries and the
   * treasure is black on black — drawn, and invisible.
   * @param {Object} world - The worker's state.
   * @param {Array} record - The treasure's eight bytes.
   */
  treasureColour: function(world, record) {
    var counter = world.pass & 0xFF;
    switch (record[6] & 0x0F) {
      case 0x00: record[3] = 0x46; break;
      case 0x06: record[3] = 0x44; break;
      case 0x08:
        var ink = (counter >> 2) & 0x07;
        record[3] = (ink || 1) | 0x40;
        break;
      default:
        record[3] = (counter & 0x1F) < 0x18 ? 0x00 : 0x45;
    }
  }, // treasureColour

  // ------------------------------------------------------- what turns up

  /**
   * $6630: a load of fuel turns up once the rocket is built, every sixteenth
   * pass, and only while there are fewer than six loads in it. Its place comes
   * out of the table at $6620, picked with the random state.
   * @param {Object} world - The worker's state.
   */
  spawnFuel: function(world) {
    var type = world.entities[this.SLOT.jetman][0] & 0x3F;
    if (!type || type >= 3) {
      return;                                       // $6635: only while he is alive
    }
    var slot = this.SLOT.items[0];
    if (world.entities[slot][0]) {
      return;
    }
    if (world.entities[this.SLOT.rocket][5] >= this.FUEL_FULL) {
      return;                                       // $6645
    }
    if ((~world.pass & 0x0F) !== 0) {
      return;                                       // $664B: every sixteenth pass
    }
    world.entities[slot] = world.templates.treasure.slice(0, 8);
    world.entities[slot][1] = this.placeFromTable(world);
  }, // spawnFuel

  /**
   * $65DF: a treasure turns up every $80 passes, in a place out of the same
   * table and with a colour taken from the refresh register ($6602).
   * @param {Object} world - The worker's state.
   */
  spawnTreasure: function(world) {
    // ★ $6602 bere druh z obnovovacího registru; tady stojí seedovaný zdroj
    var type = world.entities[this.SLOT.jetman][0] & 0x3F;
    if (!type || type >= 3) {
      return;
    }
    var slot = this.SLOT.items[1];
    if (world.entities[slot][0]) {
      return;
    }
    if ((world.pass & 0x7F) !== 0) {
      return;
    }
    world.entities[slot] = world.templates.fuel.slice(0, 8);
    world.entities[slot][1] = this.placeFromTable(world);
    // ★ $6602 takes the kind out of the **refresh register**, which a remake
    // has not got: the seeded source stands in for it, the mixing is the
    // original's ($6604: AND $0E, then bit 3 decides, then OR $20)
    var kind = world.randomState & 0x0E;
    if (kind & 0x08) {
      kind &= 0x08;
    }
    world.entities[slot][6] = kind | 0x20;
  }, // spawnTreasure

  /**
   * $6612: where something turns up — sixteen places at $6620, picked by the
   * low nibble of the random state.
   * @param {Object} world - The worker's state.
   * @returns {number} The x it lands on.
   */
  placeFromTable: function(world) {
    var table = world.places || [];
    return table[world.randomState & 0x0F] || 0;
  }, // placeFromTable

  /**
   * $665B: both item slots and all the enemies go, which is what happens when
   * a level ends.
   * @param {Object} world - The worker's state.
   */
  clearItemsAndEnemies: function(world) {
    for (var slot = this.SLOT.items[0]; slot < world.entities.length; slot++) {
      world.entities[slot][0] = 0;
    }
  }, // clearItemsAndEnemies

  // ------------------------------------------------- explosions and sound

  /**
   * $68B1: an explosion. Three pictures out of $690F while its counter is
   * below three, then the same three to rub itself out, and the slot is free.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The explosion's slot.
   */
  stepExplosion: function(world, slot) {
    var record = world.entities[slot];
    // ★ $68B5 reads the counter **before** $68C1 puts it up, and it is the old
    // value everything below tests. One pass of difference lives right here.
    var phase = record[4];
    if ((world.pass & record[5]) === 0) {
      record[4] = (record[4]+1) & 0xFF;             // $68C1
    }
    if (phase < 3) {
      // $68E1: the colour flickers with the random state
      record[3] = (world.randomState & 0x07) | 0x42;
      return;
    }
    if (phase >= 6) {
      // $68EE: it is over — the slot goes back to being empty, and when what
      // exploded was Jetman ($68FE: the old type is below 3) a life is lost
      var wasType = record[6] & 0x3F;
      record[0] = 0;
      if (wasType < 3) {
        this.startNewLife(world);
      }
    }
  }, // stepExplosion

  /**
   * $60DD: what happens once Jetman's own explosion has burnt out — the
   * creatures are all cleared away ($6660 walks ten slots from $5D48),
   * whatever was being carried is let go (bit 1 of both item slots), and
   * $619A puts a fresh Jetman on the screen, starts the delay and takes the
   * life.
   * @param {Object} world - The worker's state.
   */
  startNewLife: function(world) {
    for (var slot = this.SLOT.enemies[0]; slot < world.entities.length; slot++) {
      world.entities[slot][0] = 0;
    }
    world.entities[this.SLOT.items[0]][4] &= ~0x02 & 0xFF;
    world.entities[this.SLOT.items[1]][4] &= ~0x02 & 0xFF;
    // ★ $60F6 asks **before** it hands out the life: with the counter already
    // at nought the game is over ($6155), and only otherwise does $619A put a
    // new Jetman on the screen and take one off.
    if (!world.lives[world.player-1]) {
      world.events.push({id: 'gameOver'});
      return;
    }
    this.beginLife(world);
    world.events.push({id: 'jetmanDied', lives: world.lives[world.player-1]});
  }, // startNewLife

  /**
   * $619A: a life starts. Jetman's record is copied back from the template,
   * the countdown is wound up ($80 passes for one player, $FF for two) and
   * **one is taken off the counter** — that is where a life is spent, not
   * where one is lost.
   * @param {Object} world - The worker's state.
   */
  beginLife: function(world) {
    world.entities[this.SLOT.jetman] = world.templates.jetman.slice(0, 8);
    world.startDelay = world.players === 2 ? 0xFF : 0x80;
    world.lives[world.player-1] = (world.lives[world.player-1]-1) & 0xFF;
  }, // beginLife

  /**
   * $60A9: arriving at the next planet.
   *
   * ★ **Every fourth one the rocket falls apart again** (`level & 3`): $60CD
   * copies the templates of the rocket and of the two missing pieces back
   * into $5D30, the carrying buffer goes back to $08 ($60DA) and the game
   * **hands out a life** ($60B6) before starting one ($619A) — so on those
   * planets the rocket does not land at all, it is simply standing there as
   * a base, and Jetman steps out of nowhere.
   *
   * On the other three the record stays as it is and the rocket comes down
   * with Jetman in it ($66EB).
   *
   * @param {Object} world - The worker's state.
   */
  newPlanet: function(world) {
    if (world.level & 0x03) {
      return;
    }
    var templates = world.templates.levelEntities || [];
    [this.SLOT.rocket, this.SLOT.items[0], this.SLOT.items[1]]
      .forEach((slot, index) => {
        if (templates.length >= (index+1)*8) {
          world.entities[slot] = templates.slice(index*8, index*8 + 8);
        }
      });
    // the rocket's colour is the handler's, not the template's ($67A9)
    world.entities[this.SLOT.rocket][3] = 0x47;
    world.carried = 0x08;                           // $60DA
    world.lives[world.player-1] = (world.lives[world.player-1]+1) & 0xFF;
    this.beginLife(world);                          // $60B7
    world.events.push({id: 'rocketRebuilt', level: world.level});
  }, // newPlanet

  /**
   * $684B / $6854: the sound slot. The original spends the sound **in place**,
   * in a loop that holds the whole game up, and counts its own +1 down; here
   * the counting is kept and the noise is the audio manager's business (M6).
   * @param {Object} world - The worker's state.
   * @param {number} slot - The sound slot.
   */
  stepSound: function(world, slot) {
    var record = world.entities[slot];
    record[1] = (record[1]-1) & 0xFF;
    if (!record[1]) {
      record[0] = 0;                                // $6870
      return;
    }
    // ★ Every round the slot is still alive makes **one** burst, and `C`
    // sets its pitch: $10 flat for the explosion ($6850), counter + $18 for
    // the death ($6859), which is why that one falls as it goes. The audio
    // manager gets the number, not a name for a whole sound.
    var kind = record[0] & 0x3F;
    world.events.push(kind === 13
                      ? {id: 'jetmanHit', c: (record[1] + 0x18) & 0xFF}
                      : {id: 'monsterDied', c: 0x10});
  }, // stepSound

  /**
   * $6834: the sound slot gets the record of one of the two sound handlers —
   * `$6847` holds `0C 04` and `0D 04`, a type and a length.
   * @param {Object} world - The worker's state.
   * @param {number} kind - 0 or 1.
   */
  startSound: function(world, kind) {
    var record = world.entities[this.SLOT.sound];
    record[0] = kind ? 0x0D : 0x0C;
    record[1] = 0x04;
  }, // startSound

  /**
   * $6894: what an entity does when it is killed — it turns into an explosion
   * and remembers what it was in +6, so that $68FE can tell afterwards whether
   * it was Jetman.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The slot.
   */
  explode: function(world, slot) {
    var record = world.entities[slot];
    record[6] = (record[0] & 0xC0) | 0x03;
    record[5] = 0;
    record[0] = 0x08;
    record[4] = 0;
  }, // explode

  // ------------------------------------------------------------ the laser

  /**
   * $6F91: pulling the trigger. A shot goes into the first free slot of the
   * four, **and only every fourth frame** ($6F94 tests FRAMES). Its y is
   * thirteen pixels above Jetman's and its x is rounded to a byte, which is
   * why the beam always starts on a character boundary.
   * @param {Object} world - The worker's state.
   */
  fire: function(world) {
    if ((world.frame & 0x03) !== 0) {
      return;                                       // $6F94
    }
    var slot = this.SLOT.lasers.find((index) => !world.entities[index][0]);
    if (slot === undefined) {
      return;
    }
    var jetman = world.entities[this.SLOT.jetman];
    var record = world.entities[slot];
    var x = (jetman[1] & 0xF8) | 0x05;
    if (jetman[0] & 0x40) {
      x = (x - 8) & 0xFF;                           // $6FBA: he is facing left
    } else {
      // $6FED: facing right, the beam starts on the other side of him
      x = ((((jetman[1] & 0x07) ? x + 8 : x) + 0x10) & 0xFE);
    }
    record[0] = 0x10;
    record[1] = (jetman[2] - 0x0D) & 0xFF;          // $6FBF: y, thirteen up
    record[2] = x;                                  // and x, with its flags in
    record[3] = x & 0xFB;
    record[4] = x & 0xFB;
    record[5] = x & 0xFB;
    record[6] = (world.randomState & 0x38) | 0x84;  // $6FD1: how long it lives
    record[7] = [0x47, 0x43, 0x43, 0x45][world.randomState & 0x03];  // $6FE9
    world.events.push({id: 'laser'});
  }, // fire

  /**
   * $6FFC: the shot itself. It moves eight pixels a pass in the direction bit
   * 0 of its x says, leaves three segments behind it and rubs them out again;
   * when its life runs out ($702E) it stops advancing and the tail catches up.
   * @param {Object} world - The worker's state.
   * @param {number} slot - The shot's slot.
   */
  stepLaser: function(world, slot) {
    var record = world.entities[slot];
    if (record[2] & 0x04) {
      var step = (record[2] & 0x01) ? -8 : 8;
      var next = (record[2] + step) & 0xFF;
      // ★ $7016: the byte ahead is only looked at **above y = $80**, so a shot
      // low down goes through anything. What is up there is the platforms.
      var blocked = record[1] < 0x80
                    && this.pixelsAt(world, next, record[1], slot);
      if (blocked) {
        record[2] &= ~0x04 & 0xFF;
      } else {
        record[2] = next;
        record[6] = (record[6] - 8) & 0xFF;
        if ((record[6] & 0xF8) === 0) {
          record[2] &= ~0x04 & 0xFF;                // $703A: out of life
        }
      }
    }

    // $704D: the three segments behind the head. Each one is either in the
    // same byte column as the head — then it has caught up — or it is still
    // trailing, and then it is either advanced ($7086) or, when it has gone
    // quiet, used to count the shot's life down ($706B).
    //
    // ★ The three branches do **not** end the same way, and that is the whole
    // of it: advancing and catching up **carry on** to the next segment, the
    // countdown **returns**, and the slot is freed only when the loop runs off
    // the end **through the catching-up branch** ($705E) — not when all three
    // have caught up, which is what a first reading suggests.
    for (var segment = 3; segment <= 5; segment++) {
      var last = (segment === 5);
      if (((record[segment] ^ record[2]) & 0xF8) === 0) {
        if (last) {
          record[0] = 0;                            // $705E: the slot is free
        }
        continue;
      }
      if (record[segment] & 0x04) {
        // $7086: it moves on and rubs out the byte it was on
        record[segment] = (record[segment]
                           + ((record[segment] & 0x01) ? -8 : 8)) & 0xFF;
        continue;                                   // $70A0: and on to the next
      }
      // $706B: the life, counted down one at a time, and when the low three
      // bits come round the segment is lit again with a fresh pair of bits
      record[6] = (record[6]-1) & 0xFF;
      if ((record[6] & 0x07) !== 0) {
        return;
      }
      record[6] = (world.randomState & 0x03) | 0x04 | record[6];
      record[segment] |= 0x04;
      return;
    }
  }, // stepLaser

  /**
   * Is there anything drawn at this byte? The original asks the video memory
   * ($701D) and stops the shot when the answer is not nought.
   *
   * ★ Two things are up there to run into, and **both matter**: the platforms,
   * which are worked out from their own table, and **the other laser shots** —
   * a beam really does stop on a beam, because all either of them is on the
   * screen is bytes of $FF. That second one is not a curiosity: it is what
   * makes rapid fire look ragged, and without it 59 of the 244 256 checks of
   * tools/matchentities.js were wrong.
   *
   * What is still not asked is the **sprites**: a creature in the top half of
   * the screen stops the original's beam and not ours. It is the one thing in
   * here the worker cannot see, because the pictures live with the composer
   * (ZADANI chap. 10).
   * @param {Object} world - The worker's state.
   * @param {number} x - The byte's x.
   * @param {number} y - Its pixel row.
   * @param {number} [shooter] - The shot doing the asking, so it does not
   *        find its own tail.
   * @returns {boolean} True when something is drawn there.
   */
  pixelsAt: function(world, x, y, shooter) {
    if (this.staticPixelsAt(world, x, y)) {
      return true;
    }
    for (var index = 0; index < this.SLOT.lasers.length; index++) {
      var slot = this.SLOT.lasers[index];
      if (slot === shooter) {
        continue;
      }
      var other = world.entities[slot];
      if ((other[0] & 0x3F) !== 0x10 || other[1] !== y) {
        continue;
      }
      // ★ What a shot has on the screen is not four bytes but the **run behind
      // its head**: the head writes a byte at every step and only the segments
      // rub them out again, so everything from the hindmost segment up to the
      // head is still lit. It has to be counted **in the direction of travel**
      // and modulo 256, because x is one byte and a beam wraps round the edge
      // like everything else in this game.
      var column = x & 0xF8;
      var head = other[2] & 0xF8;
      var back = (other[2] & 0x01) ? 8 : -8;        // away from where it goes
      var rear = 0;
      for (var part = 3; part <= 5; part++) {
        var behind = (((other[part] & 0xF8) - head)*(back > 0 ? 1 : -1)) & 0xFF;
        if (behind > rear && behind < 0x80) {
          rear = behind;
        }
      }
      var distance = ((column - head)*(back > 0 ? 1 : -1)) & 0xFF;
      if (distance < rear) {
        return true;
      }
    }
    return false;
  }, // pixelsAt

  /**
   * The platforms, worked out from their own table — the only thing on the
   * screen that stays where it is.
   * @param {Object} world - The worker's state.
   * @param {number} x - The byte's x.
   * @param {number} y - Its pixel row.
   * @returns {boolean} True when a platform covers it.
   */
  staticPixelsAt: function(world, x, y) {
    var platforms = world.platforms || [];
    for (var index = 0; index < platforms.length; index++) {
      var platform = platforms[index];
      if (y < platform.y || y >= platform.y+8) {
        continue;
      }
      var left = (platform.x - (platform.width & 0xFC) + 0x10) & 0xFF;
      var width = ((platform.width >> 2) - 2)*8;
      if (((x - left) & 0xFF) < width) {
        return true;
      }
    }
    return false;
  }, // staticPixelsAt

  // ------------------------------------------------------------ the small

  /**
   * $6E20: does this entity touch Jetman? Twelve pixels across, and down as
   * far as the entity's own height says — and ★ **only while Jetman is alive**
   * ($6E25: his type has to be 1 or 2).
   * @param {Object} world - The worker's state.
   * @param {Array} record - The entity's eight bytes.
   * @returns {boolean} True when they touch.
   */
  touchesJetman: function(world, record) {
    var jetman = world.entities[this.SLOT.jetman];
    var type = jetman[0] & 0x3F;
    if (type !== 1 && type !== 2) {
      return false;
    }
    var dx = (jetman[1] - record[1]) & 0xFF;
    if (dx & 0x80) {
      dx = (-dx) & 0xFF;
    }
    if (dx >= 0x0C) {
      return false;
    }
    var dy = (jetman[2] - record[2]) & 0xFF;
    var limit;
    if (dy & 0x80) {
      dy = ((-dy) + 0x0E) & 0xFF;
      limit = record[7];
    } else {
      limit = 0x15;
    }
    return dy < limit;
  }, // touchesJetman

  /**
   * The platform test, which is jetmanPhysics.js's — one routine, one reader.
   * @param {Object} world - The worker's state.
   * @param {Array} record - The entity's eight bytes.
   * @returns {number} The bits $761D returns in E.
   */
  platformTouch: function(world, record) {
    return JetmanPhysics.platformTest(record, world.platforms);
  }, // platformTouch

  /**
   * $70F9: the score, which the original keeps as **three bytes of BCD** and
   * adds to with DAA, so the operands in the code are decimal numbers as they
   * stand ($0100 really is a hundred).
   * @param {Object} world - The worker's state.
   * @param {number} amount - The operand, read as decimal.
   */
  addScore: function(world, amount) {
    var decimal = parseInt(amount.toString(16), 10);
    var index = world.player-1;
    world.score[index] = (world.score[index] + decimal) % 1000000;
  } // addScore

}; // WorldEntities

if (typeof self !== 'undefined') { self.WorldEntities = WorldEntities; }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {WorldEntities: WorldEntities};
}
