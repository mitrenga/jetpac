const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { JetpacLogoEntity } = await import('./jetpacLogoEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { PauseGameEntity } = await import('./pauseGameEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen — the one screen Jetpac has. No rooms, no scrolling, no map:
 * three platforms, the ground and whatever is standing on them
 * (sources/docs/screen_layout.md).
 *
 * The whole 256x192 picture is one {@link GameAreaEntity}, panel and all,
 * because that is how the game holds it: the panel is printed into the same
 * video memory with the same routines ($4021, $70A4). ScreenComposer builds
 * those 6912 bytes out of data the original was taken apart for, and
 * tools/matchscreen.js checks the result against the original's own video
 * memory byte for byte.
 *
 * The worker (gameWorker.js, WORKER-PROTOCOL.md) keeps the state and ticks;
 * this model routes the controls into it and draws what comes back. Since M3
 * Jetman flies, since M4 the rocket is built and fuelled, since M5 the
 * wildlife tries to stop it — all of them transcriptions of the original's own
 * handlers, checked against runs recorded off it.
 */
export class GameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.gameOver = false;
    // which picture is in the carrying buffer ($5ECC); false = not built yet
    this.carried = false;
    // ★ The controls the game reads ($733E, $7374, $7393): left and right off
    // the halves of the bottom row, the thrust off the whole top row and the
    // laser off the whole middle one. There is no "down" — Jetman falls on his
    // own — but there **is** a brake: $7435 reads the whole number row (and
    // DOWN on a Kempston) and kills the vertical speed outright.
    this.controlsState = {left: false, right: false, thrust: false, fire: false,
                          brake: false};
    this.worker = null;
    this.render = null;
    this.gameAreaEntity = null;
    this.fpsEntity = null;
    this.inputEntity = null;
    this.fps = {frames: 0, workerFrames: 0, ticks: 0, since: false, lastPass: false};
    // ★ The screen is drawn by whichever of the two clocks got there first.
    // A frame from the worker draws straight away (the picture then follows
    // the world as tightly as the messages come) and clears this flag; the
    // model loop draws only when the flag survived, so if the worker stops
    // ticking (pause, a modal, a stalled thread) the application goes on
    // drawing at its own rate. Same mechanism as manicminer's CaveModel.
    this.needDraw = true;
    // a touch that is shorter than one pass of the worker has to be held
    this.heldTaps = {};
    // the last control state sent to the worker (sendControls)
    this.sentControls = false;
  } // constructor

  /**
   * The game's own border: the X in its corner opens the pause menu, as in
   * Manic Miner, and on a touchscreen the two halves of the screen are the controls, so the
   * border carries them and their icons. Without this the model gets the
   * plain AbstractEntity of AbstractModel, and showTouchIcons() then dies on
   * `setGameControlIcons is not a function` — on phones only, which is why a
   * desktop never saw it.
   * @returns {BorderEntity}
   */
  newBorderEntity() {
    // the X sends keyPress Escape → pauseGame, for the mouse and the touchscreen
    return new BorderEntity(true, this.app.controls.touchscreen.supported);
  } // newBorderEntity

  init() {
    super.init();

    // ★ $608A does XOR A / OUT ($FE),A before every level, so the border is
    // black and the game never touches it again — there is nothing in the
    // program that writes to it a second time.
    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // ★ the FLASH clock of the ULA (16 frames, 330 ms as in the menu): the
    // label of the player on turn blinks during the delay at the start of a
    // life ($61BD), and without the clock the bit set there shows nothing
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds',
                       options: {muted: this.app.muted.sounds}});

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['global', 'sprites', 'cadence', 'sounds'], (files, error) => this.initData(files, error));
  } // init

  /**
   * The part of init() that needs the data files. Runs inside init() when
   * they are in localStorage, later when they had to come from the server.
   * @param {Object|null} files - The data files, or null.
   * @param {Error} [error] - Why they are missing.
   */
  initData(files, error) {
    if (this.app.model !== this) {
      return;
    }
    if (!files) {
      this.app.showErrorMessage(error ? error.message : 'Game data could not be loaded.', 'restart');
    }
    if (!this.initScreen()) {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'JETPAC', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/sprites.json, data/global.json). RUN tools/dumpsprites.py AND tools/mkglobal.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
      return;
    }

    if (this.app.devModeName !== false) {
      this.fpsEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 16*8, 2, 10*8, 4, '', ZXColor.brightGreen, false, {align: 'right'});
      this.desktopEntity.addEntity(this.fpsEntity);
      this.inputEntity = new TextEntity(this.desktopEntity, this.app.fonts.fonts3x3, 16*8, 8, 10*8, 4, '', ZXColor.brightCyan, false, {align: 'right'});
      this.desktopEntity.addEntity(this.inputEntity);
    }

    this.showTouchIcons();

    this.worker = this.app.worker;
    this.app.inputEventsManager.sendEventsActiveKeys('Press');
    this.sendWorkerMessage({
      id: 'init',
      initData: {
        headless: false,
        players: this.app.players,
        lives: this.app.lives,
        lives2: this.globalData ? this.globalData.lives2 : 5,
        hiScore: this.app.hiScore,
        level: this.app.level,
        // the entity records the game starts a life with, straight out of its
        // own templates ($6010, $6018) — tools/mkglobal.py
        global: this.globalData,
        // ★ the physics walks on the same four platform records the screen is
        // drawn from ($6000): one table, two readers ($761D and $766D)
        platforms: (this.gfxData && this.gfxData.platforms) || [],
        // ★ how many long rounds fit into a frame, by how busy the screen is
        // — the original slows down when there is a lot on it, and this is
        // that measured (data/cadence.json, tools/tracecadence.py)
        cadence: this.loadDataFile('cadence'),
        // $6620: the sixteen places things turn up in
        places: (this.globalData && this.globalData.spawnPlaces) || [],
        // ★ where the remake's pseudo-random source starts. The original takes
        // its entropy from the refresh register and from a byte of the
        // Spectrum's ROM ($69C7), neither of which a browser has; this is what
        // makes the next game different, and a fixed seed is what makes a run
        // repeatable.
        seed: (Date.now() & 0xFFFF)
      }
    });
    // the laser of a touchscreen fires from the start (autoFire)
    this.sendControls();
  } // initData

  shutdown() {
    super.shutdown();
    this.sendWorkerMessage({id: 'reset'});
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  /**
   * Builds the renderer and adds the screen.
   * @returns {boolean} True when the screen was created.
   */
  initScreen() {
    this.globalData = this.loadDataFile('global');
    var gfx = this.loadDataFile('sprites');
    if (!gfx) {
      return false;
    }
    this.gfxData = gfx;
    try {
      // the glyphs come out of svision's ZXFonts8x8, whose default table is
      // the ZX ROM font — and ★ that is the font the game prints with ($714C
      // takes the glyph out of CHARS, $5C36), so no font of our own is needed
      var fonts = this.app.fonts.zxFonts8x8Mono;
      this.render = new ScreenComposer(gfx, {chars: fonts.fontsChars,
                                             data: fonts.fontsData});
      this.render.panelPlayer2 = false;            // ZADANI.md §10/9: no 2UP
      this.render.prepareLevel(this.app.level || 0, 0x08);
    } catch (error) {
      console.error(error.message);
      return false;
    }
    this.gameAreaEntity = new GameAreaEntity(this.desktopEntity, 0, 0, this.render);
    this.desktopEntity.addEntity(this.gameAreaEntity);
    // the JETPAC logo where the original prints 2UP (ZADANI.md §10/9); over
    // the screen, so it is added after it
    this.desktopEntity.addEntity(new JetpacLogoEntity(this.desktopEntity));
    return true;
  } // initScreen

  sendWorkerMessage(event) {
    if (this.worker) {
      this.worker.postMessage(event);
    }
  } // sendWorkerMessage

  /**
   * Sets one control and sends the whole state over when it changed. The whole
   * state goes rather than the change, because left and thrust held together
   * are a diagonal climb, not a conflict.
   * @param {string} action - The control action.
   * @param {boolean} value - Pressed or released.
   */
  setControl(action, value) {
    if (!(action in this.controlsState)) {
      // ★ loudly, not silently: an action that nobody knows is a dead
      // control, and a dead control looks exactly like a broken game
      console.error('GameModel: neznámá akce ovládání "'+action+'"');
      return;
    }
    if (this.controlsState[action] === value) {
      return;
    }
    this.controlsState[action] = value;
    this.sendControls();
  } // setControl

  /**
   * ★ On a touchscreen the laser fires by itself, all the time: the two
   * halves of the screen are the stick and the thrust, and a third thumb
   * there is not. It is on as soon as the device is a touchscreen
   * (`controls.touchscreen.supported` — a coarse pointer, or the first touch).
   * @returns {boolean}
   */
  autoFire() {
    return !!this.app.controls.touchscreen.supported;
  } // autoFire

  /**
   * Sends the whole control state to the worker, the laser held by
   * {@link autoFire} on a touchscreen. Only when it changed since the last
   * message.
   */
  sendControls() {
    var state = Object.assign({}, this.controlsState);
    state.fire = state.fire || this.autoFire();
    var key = JSON.stringify(state);
    if (key === this.sentControls) {
      return;
    }
    this.sentControls = key;
    this.sendWorkerMessage(Object.assign({id: 'controls'}, state));
  } // sendControls

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'exitGame':
        this.app.setModel('MenuModel');
        return true;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'blurWindow':
        this.pauseGame();
        return true;

      case 'continueGame':
        this.sendWorkerMessage({id: 'continue'});
        this.sendEvent(0, {id: 'continueAllAudioBuses'});
        return true;

      case 'releaseTouchAction':
        if (this.heldTaps[event.action]) {
          this.heldTaps[event.action]--;
        }
        this.releaseTouchAction(event.action);
        return true;

      case 'keyPress':
        var key = event.key;
        if (key.length == 1) {
          key = key.toUpperCase();
        }
        switch (key) {
          // ★ The original pauses while CAPS SHIFT is **held** ($69BD spins in
          // place) and has no pause screen at all. The remake binds Escape to
          // a pause panel instead, as the sibling remakes do — a browser tab
          // that loses focus has to stop somewhere (ZADANI chap. 10).
          case 'Escape':
          case 'GamepadExit':
            this.pauseGame();
            return true;
          case 'Touch':
            if (this.borderEntity.leftControlEntity && this.borderEntity.leftControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.leftControlEntity;
              this.touchStart(event, 'left', this.borderEntity.leftControlEntity);
              return true;
            }
            if (this.borderEntity.rightControlEntity && this.borderEntity.rightControlEntity.pointOnEntity(event)) {
              this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity.rightControlEntity;
              this.touchStart(event, 'right', this.borderEntity.rightControlEntity);
              return true;
            }
            break;
          case 'RetryTouch':
            this.setControl(event.action, true);
            return true;
        }
        var action = this.controlAction(key);
        if (action !== false) {
          this.setControl(action, true);
          return true;
        }
        break;

      case 'keyRelease':
        var releasedKey = event.key;
        if (releasedKey.length == 1) {
          releasedKey = releasedKey.toUpperCase();
        }
        if (releasedKey == 'Touch') {
          this.touchEnd(event);
          return true;
        }
        var releasedAction = this.controlAction(releasedKey);
        if (releasedAction !== false) {
          this.setControl(releasedAction, false);
          return true;
        }
        break;

      case 'keyMove':
        if (event.key == 'Touch') {
          this.touchMove(event);
          return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /** pauses the worker and opens the pause menu */
  pauseGame() {
    if (this.desktopEntity.modalEntity || this.gameOver) {
      return;
    }
    this.sendWorkerMessage({id: 'pause'});
    this.sendEvent(0, {id: 'pauseAllAudioBuses'});
    this.desktopEntity.addModalEntity(new PauseGameEntity(this.desktopEntity, 48, 64, 160, 72, 'PAUSE GAME', 'MenuModel'));
  } // pauseGame

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        this.fps.workerFrames++;
        if (this.fps.lastPass !== false && data.pass > this.fps.lastPass) {
          this.fps.ticks += data.pass-this.fps.lastPass;
        }
        this.fps.lastPass = data.pass;
        if (data.panel) {
          this.app.score = data.panel.score;
          this.app.score2 = data.panel.score2;
          this.app.hiScore = Math.max(this.app.hiScore || 0, data.panel.score || 0);
          this.app.lives = data.panel.lives;
          this.app.player = data.panel.player;
        }
        // ★ a level ends when the rocket flies off the top ($66DA), and the
        // next planet has its own creature and its own rocket, so the
        // pre-shifted pictures have to be built again
        if (data.level !== this.app.level) {
          this.app.level = data.level;
          this.carried = false;
          if (this.render) {
            this.render.prepareLevel(data.level, data.carried);
            this.carried = data.carried;
          }
        }
        // ★ and the **carrying buffer** has to be built again whenever the
        // game moves it on ($65BC: `+6` plus eight, every time a piece is
        // fitted), because that buffer is what a falling or carried item is
        // drawn with. Without this the fuel is carried about looking like a
        // piece of the rocket — the buffer would still hold the picture the
        // level started with.
        if (this.render && data.carried !== undefined && data.carried !== this.carried) {
          this.render.prepareCarried(data.level, data.carried);
          this.carried = data.carried;
        }
        if (this.gameAreaEntity) {
          this.gameAreaEntity.setFrame(data);
        }
        if (this.inputEntity && data.controls) {
          var held = Object.keys(data.controls).filter((key) => data.controls[key]);
          this.inputEntity.setText(held.length ? held.join(' ').toUpperCase() : '-');
        }
        if (data.events && data.events.length && this.app.audioManager) {
          this.playEvents(data.events);
        }
        this.drawModel();
        this.needDraw = false;
        break;
      case 'gameOver':
        if (!this.gameOver) {
          this.gameOver = true;
          this.app.score = data.score;
          this.app.level = data.level || 0;
          this.app.setModel('GameOverModel');
        }
        break;
      case 'error':
        console.error(data.message);
        break;
    }
  } // handleWorkerMessage

  /**
   * Turns what happened in the world into noise. ★ Jetpac's sound is beeper
   * loops spent **in place** ($680D, $681E, $685F) — the game stops while they
   * play — so what comes over here is an event and app/beeper.js makes the
   * pulses out of the original's own constants.
   * @param {Array} events - The 'events' of the worker's frame.
   */
  playEvents(events) {
    events.forEach((event) => {
      var sound = GameModel.SOUNDS[event.id];
      if (!sound) {
        return;
      }
      // ★ two of them carry a number out of the original: the flame's pitch is
      // the rocket's own y ($67ED), and the sound slot's burst is its `C`
      // ($6850, $6859). The rest are the routine and nothing else.
      var options = {};
      if (event.y !== undefined) {
        options.y = event.y;
      }
      if (event.c !== undefined) {
        options.c = event.c;
      }
      this.app.audioManager.playSound('sounds', sound, options);
    });
  } // playEvents

  /**
   * Which routine of the original each event makes its noise with — and ★ the
   * mapping is the original's, so two events share one routine and one event
   * makes no noise at all:
   *
   * - a piece landing on the rocket and a load of fuel going in **both** end
   *   at `$67FD` ($65CB and $65DD meet at $65C4)
   * - **getting into the rocket is silent**: $6717 puts the life back and goes
   *   straight to the panel ($70A4), without touching the speaker
   */
  static get SOUNDS() {
    return {
      laser: 'laser',              // $6FE6 -> $681E, the rising sweep
      pickUp: 'pickUp',            // $6567 -> $6803
      built: 'built',              // $65CB -> $67FD
      fuelled: 'built',            // $65DD -> the same routine
      treasure: 'treasure',        // $64BF -> $6809
      flame: 'rocketFlame',        // $66CD -> $67ED, pitch from the rocket's y
      monsterDied: 'explosion',    // $6834 -> the sound slot, type 12
      jetmanHit: 'death'           // $6490 -> the sound slot, type 13
    };
  } // SOUNDS

  /**
   * Maps a key or gamepad event onto a control action.
   *
   * ★ The actions are **this game's**, not a sibling's: `left`, `right`,
   * `thrust`, `brake` and `fire`, exactly as `gameApp.js` names them in
   * `controlsOptions` and as `controlsState` and the worker know them
   * (`WORKER-PROTOCOL.md`). Anything else is dropped without a sound by
   * {@link setControl}, which is what once left Jetman unable to fly or
   * shoot while left and right worked.
   *
   * The keyboard keys are **only** the configured ones (`app.controls.keyboard`
   * — arrows and SPACE by default, remapped from SETTINGS); nothing is
   * accepted beside them, so a remapped key never keeps a hidden second
   * meaning. The gamepad keys are the fixed names the library gives its
   * buttons. The mouse is not a game control here — it serves the buttons and
   * the menu. The original is played on the whole top row for the thrust and
   * the whole middle row for the laser (`$7393`, `$7374`); whoever wants that
   * sets it in SETTINGS.
   * @param {string} key - The event key.
   * @returns {string|false} The action, or false.
   */
  controlAction(key) {
    var kb = this.app.controls.keyboard;
    switch (key) {
      case kb.left: case 'GamepadLeft': return 'left';
      case kb.right: case 'GamepadRight': return 'right';
      case kb.thrust: case 'GamepadUp': case 'GamepadJump': return 'thrust';
      case kb.brake: case 'GamepadDown': return 'brake';
      case kb.fire: case 'GamepadFire': case 'GamepadOK': return 'fire';
    }
    return false;
  } // controlAction

  /**
   * What this half of the screen does: the stick or the laser button
   * (controlsOptions.touchscreen.halves). Which half is which is the
   * left-handed / right-handed choice in SETTINGS.
   * @param {string} side - 'left' or 'right'.
   * @returns {Object} {icon, zones}
   */
  touchHalf(side) {
    var ts = this.app.controlsOptions.touchscreen;
    return ts.halves[ts.types[this.app.controls.touchscreen.type][side].half];
  } // touchHalf

  /**
   * Icons into the border: what each half of the screen does. The border draws
   * them only where there is room for them outside the play area.
   */
  showTouchIcons() {
    if (!this.app.controls.touchscreen.supported || !this.borderEntity) {
      return;
    }
    var icons = this.app.controlsOptions.touchscreen.icons;
    this.borderEntity.setGameControlIcons(icons[this.touchHalf('left').icon],
                                          icons[this.touchHalf('right').icon]);
  } // showTouchIcons

  /**
   * The zone of the layout under the finger. `rect` is a fraction of the half,
   * so it is worked out from where on that half the finger is, not from pixels.
   * @param {Object} event - The touch event (x, y).
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen (borderEntity).
   * @returns {Object|false} The zone, or false.
   */
  touchZone(event, side, entity) {
    var half = this.touchHalf(side);
    var width = Math.max(entity.width, 1), height = Math.max(entity.height, 1);
    var rx = (event.x-(entity.parentX+entity.x))/width;
    var ry = (event.y-(entity.parentY+entity.y))/height;
    for (var z = 0; z < half.zones.length; z++) {
      var r = half.zones[z].rect;
      if (rx >= r[0] && rx <= r[0]+r[2] && ry >= r[1] && ry <= r[1]+r[3]) {
        return half.zones[z];
      }
    }
    return false;
  } // touchZone

  /**
   * A new touch on a half of the screen. There can be several at once: each
   * keeps its own record in `touchesGameControls` and the control state is
   * their sum, so flying and firing go together, and so do left and thrust.
   * @param {Object} event - The touch event.
   * @param {string} side - 'left' or 'right'.
   * @param {Object} entity - The half of the screen.
   */
  touchStart(event, side, entity) {
    // the first touch is what makes a device a touchscreen: from now on the
    // laser fires by itself (autoFire)
    this.sendControls();
    var zone = this.touchZone(event, side, entity);
    var control = {side: side, entity: entity, action: false,
                   type: zone === false ? 'none' : zone.type,
                   control: zone === false ? false : zone.control,
                   actions: zone === false ? false : zone.actions,
                   tap: zone !== false && zone.type == 'button' && !!zone.tap,
                   since: this.app.now,
                   origin: {x: event.x, y: event.y},
                   at: {x: event.x, y: event.y}};
    this.app.inputEventsManager.touchesGameControls[event.identifier] = control;
    // A button holds its action from the moment the finger lands; the stick
    // does nothing until the finger moves, so a tap on it sends nothing.
    if (zone !== false && zone.type == 'button') {
      control.action = zone.action;
      this.setControl(zone.action, true);
    }
  } // touchStart

  /**
   * The finger came up. A short tap has to be **held**: the worker reads the
   * controls once per pass of the main loop (50.08 Hz), so a tap shorter than
   * one pass would never be seen at all.
   * @param {Object} event - The touch event.
   */
  touchEnd(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined) {
      return;
    }
    delete controls[event.identifier];
    if (control.action === false) {
      return;
    }
    var rest = this.app.controlsOptions.touchscreen.tapHoldTime-(this.app.now-control.since);
    if (control.tap && rest > 0) {
      this.heldTaps[control.action] = (this.heldTaps[control.action] || 0)+1;
      this.sendEvent(rest, {id: 'releaseTouchAction', action: control.action});
      return;
    }
    [].concat(control.action).forEach((action) => this.releaseTouchAction(action));
  } // touchEnd

  /**
   * Releases an action, but only when no other finger is still holding it —
   * two fingers on the same action must not cancel each other.
   * @param {string} action - The control action.
   */
  releaseTouchAction(action) {
    if (this.heldTaps[action]) {
      return;
    }
    var controls = this.app.inputEventsManager.touchesGameControls;
    var held = Object.keys(controls).some((id) => controls[id].action !== false
                                                  && [].concat(controls[id].action).indexOf(action) !== -1);
    if (!held) {
      this.setControl(action, false);
    }
  } // releaseTouchAction

  /**
   * The finger moved. The stick is **absolute**: the direction is where the
   * finger has moved to from where it landed, with a dead zone of
   * `joystickStep` in the middle. It holds two directions at once: thrust
   * and left or right together are a climb to the side.
   * @param {Object} event - The touch event.
   */
  touchMove(event) {
    var controls = this.app.inputEventsManager.touchesGameControls;
    var control = controls[event.identifier];
    if (control === undefined || control.type != 'joystick') {
      return;
    }
    control.at = {x: event.x, y: event.y};
    var step = this.app.controlsOptions.touchscreen.joystickStep;
    var axis = {x: false, y: false};
    if (control.control == 'horizontal' || control.control == 'both') {
      if (event.x-control.origin.x < -step) { axis.x = control.actions.left; }
      if (event.x-control.origin.x > step) { axis.x = control.actions.right; }
    }
    if (control.control == 'vertical' || control.control == 'both') {
      if (event.y-control.origin.y < -step) { axis.y = control.actions.up; }
      if (event.y-control.origin.y > step) { axis.y = control.actions.down; }
    }
    var next = [axis.x, axis.y].filter((action) => action !== false);
    var previous = control.action === false ? [] : [].concat(control.action);
    if (previous.length == next.length && previous.every((action) => next.indexOf(action) !== -1)) {
      return;
    }
    control.action = next.length == 0 ? false : (next.length == 1 ? next[0] : next);
    previous.forEach((action) => {
      if (next.indexOf(action) === -1) {
        this.releaseTouchAction(action);
      }
    });
    next.forEach((action) => this.setControl(action, true));
  } // touchMove

  updateFps(timestamp) {
    if (!this.fpsEntity) {
      return;
    }
    this.fps.frames++;
    if (this.fps.since === false) {
      this.fps.since = timestamp;
      return;
    }
    var elapsed = timestamp-this.fps.since;
    if (elapsed >= 1000) {
      this.fpsEntity.setText(Math.round(this.fps.frames*1000/elapsed)+'/'+Math.round(this.fps.workerFrames*1000/elapsed)+'/'+Math.round(this.fps.ticks*1000/elapsed)+' FPS');
      this.fps.frames = 0;
      this.fps.workerFrames = 0;
      this.fps.ticks = 0;
      this.fps.since = timestamp;
    }
  } // updateFps

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.updateFps(timestamp);
    if (this.needDraw) {
      this.drawModel();
    }
    this.needDraw = true;
  } // loopModel
} // GameModel
