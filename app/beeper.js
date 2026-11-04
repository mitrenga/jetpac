// begin code

/**
 * The beeper of a ZX Spectrum, clocked in **T states**, running Jetpac's own
 * sound routines.
 *
 * ★ The whole of the game's sound is **one loop and one sweep**
 * (sources/docs/disasm_notes.md chap. 10): `$680D` makes a square wave whose
 * half-cycle is D `DJNZ` iterations and which repeats C times, and `$681E`
 * runs C from 8 up to $38 for the laser. There is no note table, no envelope
 * and **no music at all** — which is why the remake has one audio bus and one
 * volume.
 *
 * ★ And the four entry points **jump into the middle of the loop**, onto the
 * `DJNZ` at $6812, so the first half-cycle lasts however long whatever was
 * left in B lasts and the speaker only moves on the second. Reproduced rather
 * than tidied up: it is what gives each sound its little click at the front.
 *
 * ★ The game spends its sound **in place**: the loop holds the whole program
 * up while it runs, which is why a Jetpac explosion freezes everything for a
 * moment. The remake cannot stop the world — the sound goes out over the audio
 * bus and the game carries on — and that is written down in ZADANI chap. 10.
 *
 * What comes out of here is a list of pulse lengths, which is what svision's
 * audio wants; `tools/matchsound.js` checks those lengths against the ones the
 * original's own routines produce in a simulator, pulse by pulse.
 *
 * Free of DOM dependencies, so the tools run this very code (R-001).
 */

/** 3.5 MHz, the Spectrum's clock */
const CLOCK = 3500000;

/** T states of the instructions these routines are made of */
const T = {
  ld_r_n: 7,        // LD A,$10 / LD D,n / LD C,n
  ld_r_r: 4,        // LD B,D / LD A,C
  out_n_a: 11,      // OUT ($FE),A
  out_write: 4,     // ...and how far into it the write lands
  alu_r: 4,         // XOR A / DEC C / INC C
  cp_n: 7,          // CP $38
  jr_taken: 12,
  jr_skipped: 7,
  djnz_taken: 13,
  djnz_skipped: 8,
  ret: 10
};

/** how long `DJNZ` with B = n takes; 0 means 256, as on the Z80 */
function djnz(n) {
  const count = n || 256;
  return (count-1)*T.djnz_taken + T.djnz_skipped;
} // djnz

/**
 * One run of one of the original's routines: the clock, and every write to
 * port $FE it made on the way.
 */
class Run {

  constructor() {
    /** T states since the routine was entered */
    this.t = 0;
    /** every OUT ($FE),A: {t, value} */
    this.writes = [];
  } // constructor

  /** advance the clock without touching the speaker */
  wait(tstates) {
    this.t += tstates;
  } // wait

  /** `OUT ($FE),A` — the write lands part way into the instruction */
  out(value) {
    this.writes.push({t: this.t+T.out_write, value: value});
    this.t += T.out_n_a;
  } // out

} // class Run

export class Beeper {

  static get CLOCK() { return CLOCK; }

  /**
   * @param {Object} sounds - The parsed data/sounds.json (tools/dumpsound.py).
   */
  constructor(sounds) {
    this.sounds = sounds || {};
    this.routines = (this.sounds.routines) || {};
    this.speakerOn = this.sounds.machine ? this.sounds.machine.speakerOn : 0x10;
    this.speakerOff = this.sounds.machine ? this.sounds.machine.speakerOff : 0x00;
  } // constructor

  /**
   * $680D: the square wave everything except the laser is made of. D is the
   * half-cycle, C the number of cycles, and B is what the caller happened to
   * leave behind — the entry points jump straight onto the `DJNZ`.
   * @param {Run} run - The run being clocked.
   * @param {number} d - The half-cycle.
   * @param {number} c - How many cycles; 0 means 256.
   * @param {number} b - What was in B on the way in.
   */
  squareLoop(run, d, c, b, fallThrough) {
    const count = c || 256;
    if (fallThrough) {
      // ★ $6809 is the one entry that **falls through** into the loop rather
      // than jumping onto the DJNZ, so its sound starts with the speaker going
      // up. The other three ($67ED, $67FD, $6803) land on $6812 and start with
      // whatever was left in B.
      run.wait(T.ld_r_n);                           // $680D LD A,$10
      run.out(this.speakerOn);                      // $680F OUT ($FE),A
      run.wait(T.ld_r_r);                           // $6811 LD B,D
      run.wait(djnz(d));                            // $6812 DJNZ $6812
    } else {
      run.wait(djnz(b));                            // straight onto $6812
    }
    for (let cycle = 0; cycle < count; cycle++) {
      run.wait(T.alu_r);                            // $6814 XOR A
      run.out(this.speakerOff);                     // $6815 OUT ($FE),A
      run.wait(T.ld_r_r);                           // $6817 LD B,D
      run.wait(djnz(d));                            // $6818 DJNZ $6818
      run.wait(T.alu_r);                            // $681A DEC C
      if (cycle+1 >= count) {
        run.wait(T.jr_skipped);                     // $681B JR NZ,$680D
        break;
      }
      run.wait(T.jr_taken);
      run.wait(T.ld_r_n);                           // $680D LD A,$10
      run.out(this.speakerOn);                      // $680F OUT ($FE),A
      run.wait(T.ld_r_r);                           // $6811 LD B,D
      run.wait(djnz(d));                            // $6812 DJNZ $6812
    }
    run.wait(T.ret);                                // $681D RET
  } // squareLoop

  /**
   * $681E: the laser. C climbs from 8 to $38 and is both the half-cycle and
   * the counter, so the pitch falls as the sweep runs — one cycle per step.
   * @param {Run} run - The run being clocked.
   * @param {number} from - Where C starts ($08).
   * @param {number} to - Where it stops ($38).
   */
  sweep(run, from, to) {
    run.wait(T.ld_r_n);                             // $681E LD C,$08
    for (let c = from; c !== to; c = (c+1) & 0xFF) {
      run.wait(T.ld_r_r);                           // $6820 LD B,C
      run.wait(djnz(c));                            // $6821 DJNZ $6821
      run.wait(T.ld_r_n);                           // $6823 LD A,$10
      run.out(this.speakerOn);                      // $6825 OUT ($FE),A
      run.wait(T.ld_r_r);                           // $6827 LD B,C
      run.wait(djnz(c));                            // $6828 DJNZ $6828
      run.wait(T.alu_r);                            // $682A XOR A
      run.out(this.speakerOff);                     // $682B OUT ($FE),A
      run.wait(T.alu_r);                            // $682D INC C
      run.wait(T.ld_r_r);                           // $682E LD A,C
      run.wait(T.cp_n);                             // $682F CP $38
      run.wait(((c+1) & 0xFF) === to ? T.jr_skipped : T.jr_taken);
    }
    run.wait(T.ret);                                // $6833 RET
  } // sweep

  /**
   * Runs one of the game's sounds and returns what it wrote to the speaker.
   * @param {string} name - 'built', 'pickUp', 'treasure', 'rocketFlame',
   *        'laser', or one of the two the sound slot spends ('explosion',
   *        'death').
   * @param {Object} [params] - {b} what was in B on the way in (the entry
   *        points jump onto a DJNZ), and {y} for the rocket's flame, whose
   *        pitch is the rocket's own y ($67ED).
   * @returns {Object} {writes, tstates}.
   */
  effect(name, params) {
    const run = new Run();
    const values = params || {};
    const b = values.b === undefined ? 0 : values.b;
    switch (name) {
      case 'laser':
        this.sweep(run, this.sounds.sweep ? this.sounds.sweep.from : 0x08,
                   this.sounds.sweep ? this.sounds.sweep.to : 0x38);
        break;
      case 'rocketFlame': {
        // $67ED: the pitch is the rocket's y, rotated down four and forced
        // into the top half of the range
        const routine = this.routines.rocketFlame || {waves: 0x10};
        const d = ((((values.y || 0) >> 4) | ((values.y || 0) << 4)) & 0x7F) | 0x40;
        this.squareLoop(run, d, routine.waves, b);
        break;
      }
      case 'explosion':
      case 'death': {
        // $684B / $6854: the sound slot. ★ It is **one burst per round**, not
        // one sound: the slot lives three rounds ($6847 puts 4 in its counter)
        // and each of them sweeps `C` down to one. For the explosion C is $10
        // flat ($6850); for the death it is **counter + $18** ($6859), so the
        // death falls in pitch as the counter runs out. The worker says which
        // round this is (`worldEntities.stepSound`), so the three bursts come
        // out as three, twenty milliseconds apart, the way they do on the
        // machine — what the remake cannot do is **stop the world** while
        // they play (ZADANI chap. 10).
        const start = values.c || (name === 'death' ? 0x1B : 0x10);
        for (let c = start; c > 0; c--) {
          run.wait(T.ld_r_n);
          run.out(this.speakerOn);
          run.wait(T.ld_r_r);
          run.wait(djnz(c));
          run.wait(T.alu_r);
          run.out(this.speakerOff);
          run.wait(T.ld_r_r);
          run.wait(djnz(c));
          run.wait(T.alu_r);
          run.wait(c > 1 ? T.jr_taken : T.jr_skipped);
        }
        run.wait(T.ret);
        break;
      }
      default: {
        const routine = this.routines[name];
        if (!routine) {
          return {writes: [], tstates: 0};
        }
        this.squareLoop(run, routine.halfWave, routine.waves, b,
                        routine.addr === 0x6809);
        break;
      }
    }
    return {writes: run.writes, tstates: run.t};
  } // effect

  /**
   * The pulse lengths svision's audio wants: how long the speaker stayed where
   * it was, in T states, from the first write onwards.
   * @param {Object} run - What {@link Beeper#effect} returned.
   * @param {number} [speaker] - What the speaker was doing before the routine
   *        started; the original leaves it wherever the last sound left it, so
   *        the first write is an edge only when it moves.
   * @returns {Array} The lengths, in T states.
   */
  static pulses(run, speaker) {
    // ★ The speaker starts **off**, so a routine that writes nought first has
    // not moved it and that write is not an edge. The machine counts the same
    // way (the tracer of a simulator logs a change, not a write), which is
    // what makes tools/matchsound.js a fair comparison.
    const lengths = [];
    let state = speaker === undefined ? 0 : (speaker & 0x10), lastT = false;
    (run.writes || []).forEach((write) => {
      const level = write.value & 0x10;
      if (level === state) {
        return;
      }
      state = level;
      if (lastT !== false) {
        lengths.push(write.t-lastT);
      }
      lastT = write.t;
    });
    return lengths;
  } // pulses

  /**
   * Turns pulse lengths into what svision's audio buses play.
   *
   * ★ That is **not** a buffer of samples: a bus takes `{fragments, pulses,
   * volume}`, where `fragments` are the distinct half-wave lengths **in
   * samples** and `pulses` indexes into them, and the handler flips the
   * speaker between them (`audioScriptProcessorHandler`,
   * `audioWorkletHandler`). It is the one-bit machine written down as it
   * really is — and a `Float32Array` handed to the same bus is silence,
   * because it has no `.fragments`.
   *
   * The T states are converted **cumulatively**, so rounding cannot drift:
   * each edge lands on the sample its own time says, not on the sum of
   * rounded pieces.
   *
   * @param {Array} lengths - Pulse lengths in T states ({@link pulses}).
   * @param {number} sampleRate - The audio context's rate.
   * @param {number} volume - How loud, 0 to 1.
   * @returns {Object|boolean} {fragments, pulses, volume}, or false when there
   *          is nothing to play.
   */
  static audioData(lengths, sampleRate, volume) {
    if (!lengths || !lengths.length) {
      return false;
    }
    const fragments = [];
    const index = new Map();
    const pulses = [];
    let tstates = 0, written = 0;
    for (let at = 0; at < lengths.length; at++) {
      tstates += lengths[at];
      const target = Math.round(tstates*sampleRate/CLOCK);
      const samples = Math.max(1, target-written);
      written += samples;
      if (!index.has(samples)) {
        index.set(samples, fragments.length);
        fragments.push(samples);
      }
      pulses.push(index.get(samples));
    }
    return {fragments: fragments, pulses: pulses, volume: volume};
  } // audioData

} // class Beeper

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {Beeper: Beeper};
}
