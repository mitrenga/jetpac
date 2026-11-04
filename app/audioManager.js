const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioWorkletHandler } = await import('./svision/js/audio/audioWorkletHandler.js?ver='+window.srcVersion);
const { AudioScriptProcessorHandler } = await import('./svision/js/audio/audioScriptProcessorHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXMachineSounds } = await import('./svision/js/platform/canvas2D/zx/zxMachineSounds.js?ver='+window.srcVersion);
const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
const { Beeper } = await import('./beeper.js?ver='+window.srcVersion);
// begin code

/**
 * Audio manager. The original has a one-bit beeper on bit 4 of port $FE and no
 * sound chip, so every sound is a stream of pulse lengths played by the svision
 * pulse handlers — the same way the machine makes sound, not sampled.
 *
 * There is **one bus**, `sounds`, and ★ **Jetpac has no music at all**: the
 * whole of its sound is beeper loops in place ($680D, $681E, $685F) with no
 * note table and no envelope (disasm_notes.md chap. 10).
 *
 * ★ None of it is invented: every sound is one of the original's routines run
 * instruction by instruction in app/beeper.js (data/sounds.json), and
 * tools/matchsound.js checks the pulses it produces against what the original
 * writes to port $FE — seven sounds, 569 checks, zero differences. The model
 * asks for them one event at a time (GameModel.playEvents). The same bus
 * carries the sounds of the **machine**: the tape loading show and the ROM's
 * key click (svision ZXMachineSounds).
 */
export class AudioManager extends AbstractAudioManager {

  /** ★ 69 888 T states per frame on a 3.5 MHz Z80 (hw_notes.md) */
  static get FRAME_TSTATES() { return 69888; }

  /** ★ $6F94: a shot gets out on every fourth frame, and no oftener */
  static get SAMPLE_SHOT_FRAMES() { return 4; }

  /** how many shots the SOUNDS panel plays */
  static get SAMPLE_SHOTS() { return 3; }

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 5)))));
    this.beeper = null;
  } // constructor

  /**
   * Builds the beeper out of the data files, once they have arrived.
   * @returns {Beeper|null} The beeper, or null while there is no data.
   */
  getBeeper() {
    if (this.beeper === null) {
      // ★ no music file, because the game has no music: the whole of its
      // sound is the loop at $680D and the sweep at $681E
      // (sources/docs/disasm_notes.md chap. 10)
      // not kept while there is none: the next model may have it from the
      // server (R-062)
      var sounds = this.loadDataFile('sounds');
      this.beeper = sounds ? new Beeper(sounds) : null;
    }
    return this.beeper;
  } // getBeeper

  /**
   * Reads a data file delivered with appData; see {@link Tool.loadDataFile}.
   * @param {string} key - The data file name without its extension.
   * @returns {Object|null} The parsed content, or null.
   */
  loadDataFile(key) {
    // through the model: a file its loadDataFiles() had to get from the
    // server is there, not in localStorage (R-062)
    var model = this.app.model;
    return model && model.loadDataFile ? model.loadDataFile(key) : Tool.loadDataFile(key);
  } // loadDataFile

  /**
   * The tape block that carries the loading screen — the real 6912 bytes of
   * it (data/loading.json), bit by bit in the pulse format of the tape, with
   * an event after every byte and one more when the block ends.
   *
   * TapeLoadingModel writes each of those bytes into the video memory as it
   * arrives, so the picture is not an animation of a load: it **is** the load,
   * and it takes exactly as long as the sound does.
   *
   * The pulses are the ROM's own lengths, so the block takes as long as
   * 6912 bytes really take — some thirty-seven seconds. Nothing is sped up:
   * a picture that loads faster than the tape can carry it would be an
   * animation again, which is the one thing this is not.
   *
   * @param {number} sampleRate - The audio context sample rate.
   * @param {number} level - Bus volume level.
   * @returns {Object|boolean} svision pulse data, or false with no data file.
   */
  tapeScreenDataSound(sampleRate, level) {
    var loading = this.loadDataFile('loading');
    if (!loading) {
      return false;
    }
    return ZXMachineSounds.tapeData(sampleRate, level,
      ZXVideoRAM.decode(loading.videoRAM),
      {byteEvent: 'tapeByte', endEvent: 'tapeBlockEnd'});
  } // tapeScreenDataSound

  createAudioHandler(bus, options) {
    var audioHandler = false;

    var volume = 0.0;
    switch (bus) {
      case 'sounds':
      case 'extra':
        volume = this.volumeLevel(this.volume.sounds);
        break;
    }

    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }

    if (this.unsupportedAudioBus == false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }

    switch (this.unsupportedAudioBus) {
      case false:
        audioHandler = new AudioWorkletHandler(this.app);
        break;
      case 'AudioWorkletHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioWorkletHandler');
        audioHandler = new AudioScriptProcessorHandler(this.app);
        break;
      case 'AudioScriptProcessorHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioScriptProcessorHandler');
        audioHandler = new AudioSilentHandler(this.app);
        break;
    }

    if (bus in this.restartSounds) {
      this.app.model.sendEvent(1, {id: 'playSound', bus: bus, sound: this.restartSounds[bus].sound, options: this.restartSounds[bus].options});
    }

    return audioHandler;
  } // createAudioHandler

  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }

    var sampleRate = this.getSampleRate();
    var level = this.volumeLevel(this.volume.sounds);
    switch (sound) {
      case 'tapePilotToneSound': return ZXMachineSounds.tapePilotTone(sampleRate, level);
      case 'tapeRndDataSound': return ZXMachineSounds.tapeRndData(sampleRate, level);
      case 'tapeScreenDataSound': return this.tapeScreenDataSound(sampleRate, level);
      case 'keyboardSound': return ZXMachineSounds.keyClick(sampleRate, level);
    }
    var beeper = this.getBeeper();
    if (!beeper) {
      return false;
    }
    if (sound === 'volumeSample') {
      return this.volumeSample(beeper, sampleRate, level);
    }
    // ★ one of the game's own five routines, clocked in T states
    // (app/beeper.js); tools/matchsound.js checks the pulses against the
    // original's, and there are no others — 569 checks, zero differences
    var run = beeper.effect(sound, options || {});
    var pulses = run ? Beeper.pulses(run) : [];
    return pulses.length ? Beeper.audioData(pulses, sampleRate, level) : false;
  } // audioData

  /**
   * The sample the SOUNDS panel plays: **three laser shots in a row**.
   *
   * ★ Jetpac has no music, so there is no tune to preview with; the laser
   * ($681E, C sweeping from $08 to $38) is the sound the game makes most and
   * the only one that sweeps, so a level set against it is set against
   * everything. Three of them, because one is twelve milliseconds and gone.
   *
   * ★ The spacing is the original's own rate limit: `$6F94` lets a shot out
   * only on every fourth frame (`worldEntities.fire`), so the shots of a held
   * trigger are **four frames apart** — 4 x 69 888 T states, 79.9 ms. The gap
   * goes in as one long half-wave, which is what silence is on a one-bit
   * speaker: the level stays where the sweep left it (off) until the next
   * shot's first edge moves it.
   * @param {Beeper} beeper - The beeper.
   * @param {number} sampleRate - The audio context sample rate.
   * @param {number} level - Bus volume.
   * @returns {Object|boolean} svision pulse data, or false when nothing sounds.
   */
  volumeSample(beeper, sampleRate, level) {
    var period = AudioManager.SAMPLE_SHOT_FRAMES*AudioManager.FRAME_TSTATES;
    var lengths = [];
    for (var shot = 0; shot < AudioManager.SAMPLE_SHOTS; shot++) {
      var pulses = Beeper.pulses(beeper.effect('laser', {}));
      if (!pulses.length) {
        continue;
      }
      if (lengths.length) {
        var sounded = 0;
        for (var i = 0; i < pulses.length; i++) {
          sounded += pulses[i];
        }
        lengths.push(Math.max(1, period-sounded));
      }
      lengths = lengths.concat(pulses);
    }
    return lengths.length ? Beeper.audioData(lengths, sampleRate, level) : false;
  } // volumeSample

  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

} // AudioManager
