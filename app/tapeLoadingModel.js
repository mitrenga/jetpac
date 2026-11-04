const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ZXVideoRAM } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAM.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * Loading from tape, the way the original does it: `LOAD ""` typed on the ZX
 * keyboard, the pilot tone and the data stripes in the border, the header
 * names and then the loading screen — the real one off the original tape
 * (data/loading.json, checked byte for byte against the SCREEN$ block, against
 * the .scr taken out of it and against the memory of a simulator that has just
 * loaded the tape: tools/matchloading.py, 20 736 checks, zero differences).
 *
 * The picture is not revealed, it is **loaded**. The block that carries it is
 * not a noise that sounds like data: it is the 6912 bytes of the picture,
 * encoded bit by bit in the pulse format of the tape (audioManager's
 * `tapeScreenDataSound`). The sound sends an event after every byte it has
 * played and the model writes that byte into the video memory, so the picture
 * appears at the speed of the sound because it *is* the sound; a further event
 * when the block ends moves the tape on, so the two cannot drift apart.
 *
 * What it looks like falls out of the machine's memory layout rather than
 * being drawn to imitate it: the three thirds of the screen fill in the ULA's
 * interleaved order, every eighth pixel line first, and the 768 attribute
 * bytes come last, which is why the picture builds up black on white and only
 * then snaps into colour. See {@link ZXVideoRAMEntity}.
 *
 * ★ Jetpac's tape is **twelve blocks, all at standard ROM speed and none of
 * them encrypted** (sources/docs/tape_layout.md) — which is the opposite of
 * Sabre Wulf, where the loader is Speedlock and the code is negated. So there
 * is nothing here that cannot be replayed: a BASIC program of 376 bytes, the
 * SCREEN$ block `JPSP`, the 8192 bytes of the game, and three little blocks of
 * fifteen, one and two bytes (a routine that shifts the game four bytes down,
 * a `JP (HL)`, and two bytes of `FRAMES` the game checks before it will run at
 * all). The long code block is cut short here: it is a show of the right
 * shape, and the picture in it is the real one, loaded, taking the time 6912
 * bytes take.
 *
 * ★ And the message on the screen is the original's own: its BASIC loader
 * prints `JETPAC IS LOADING` and a flashing `PLEASE WAIT` **before** it loads
 * the picture, and sets `INK 0: PAPER 0` afterwards so that the `Bytes:`
 * reports of the blocks that follow are invisible.
 */
export class TapeLoadingModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'TapeLoadingModel';

    this.inputLineEntity = null;
    this.commandPhase = 0;
    this.command = ['K', 'LOAD L', 'LOAD "L', 'LOAD ""L', ''];
    this.programNameEntity = null;
    this.loadingMessageEntity = null;
    this.waitMessageEntity = null;
    this.screenEntity = null;
    this.app.stack.flashState = false;
    this.tapeBreak = false;
    // the line BREAK reports: 0:1 while the BASIC program is still coming,
    // 10:7 once it runs and is the one doing the loading
    this.tapeBreakLine = '0:1';
    this.tapePhase = false;
    // The blocks are the tape's own, in its own order (tools/tapinfo.py):
    // BASIC 376 B, SCREEN$ `JPSP` 6912 B, code 8192 B, then 15 B, 1 B and 2 B.
    // At the ROM's 1500 baud a block takes about its length in bytes divided
    // by 187 seconds, which is where these durations come from.
    this.tape = [
      {id: 'pause', duration: 1000},

      // BASIC program: header, then the block
      {id: 'pilot', duration: 3000},
      {id: 'data', duration: 100},
      {id: 'pause', duration: 800, event: {id: 'setProgramName'}},
      {id: 'pilot', duration: 1500},
      {id: 'data', duration: 2000},

      // the program runs: it clears the screen, beeps its five notes and
      // prints its own message before it asks for the picture
      {id: 'pause', duration: 1000, event: {id: 'showLoadingMessage'}},
      {id: 'pause', duration: 1200, event: {id: 'showLoadingScreen'}},

      // the picture: header, then the block that carries it; the block says
      // when it is over, the duration here is only the fallback for a bus
      // that never gets to play it
      {id: 'pilot', duration: 3000},
      {id: 'data', duration: 100},
      {id: 'pause', duration: 800},
      {id: 'pilot', duration: 1500},
      {id: 'data', duration: 60000, sound: 'tapeScreenDataSound'},

      // the game: header, then the block. Standard speed, nothing exotic —
      // cut short because 8192 bytes are three quarters of a minute and the
      // picture is already there
      {id: 'pause', duration: 1000},
      {id: 'pilot', duration: 3000},
      {id: 'data', duration: 100},
      {id: 'pause', duration: 800},
      {id: 'pilot', duration: 1500},
      {id: 'data', duration: 5000}
    ];
  } // constructor

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.white;
    this.desktopEntity.bkColor = ZXColor.white;

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['loading'], (files, error) => this.initData(files, error));
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
    this.inputLineEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 23*8, 32*8, 8, '© 1982 Sinclair Research Ltd', ZXColor.black, false, {align: 'left'});
    this.desktopEntity.addEntity(this.inputLineEntity);

    this.programNameEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 1*8, 32*8, 8, 'Program: JETPAC', ZXColor.black, false, {leftMargin: 1});
    this.programNameEntity.hide = true;
    this.desktopEntity.addEntity(this.programNameEntity);

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {}});
    this.sendEvent(1000, {id: 'updateCommand'});

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  newBorderEntity() {
    // no X in the border, like the other screens: a click or a touch anywhere
    // in the border is BREAK (handleEvent), a second one goes back to the menu,
    // and Escape or GamepadExit go back straight away
    return new BorderEntity(false, false);
  } // newBorderEntity

  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'closeAllAudioBuses'});
  } // shutdown


  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'updateCommand':
        this.inputLineEntity.options.align = 'left';
        this.inputLineEntity.fonts = this.app.fonts.zxFonts8x8Mono;
        this.inputLineEntity.options.animationMode = 'flashReverseColors';
        this.inputLineEntity.setText(this.command[this.commandPhase]);
        this.inputLineEntity.options.flashMask = '';
        if (this.command[this.commandPhase].length > 0) {
          this.inputLineEntity.options.flashMask = this.inputLineEntity.options.flashMask.padStart(this.command[this.commandPhase].length-1, ' ')+'#';
        }
        this.commandPhase++;
        this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'keyboardSound', options: false});
        if (this.commandPhase < this.command.length) {
          this.sendEvent(800, {id: 'updateCommand'});
        } else {
          this.inputLineEntity.hide = true;
          this.tapePhase = 0;
          this.sendEvent(1, {id: 'updateTape'});
        }
        return true;

      case 'updateTape':
        switch (this.tape[this.tapePhase].id) {
          case 'pilot':
            this.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: 'tapePilotToneSound', options: {repeat: true}});
            this.sendEvent(0, {id: 'setBorderAnimation', value: 'pilotTone'});
            break;
          case 'data':
            this.sendEvent(0, {id: 'playSound', bus: 'sounds',
                               sound: this.tape[this.tapePhase].sound || 'tapeRndDataSound',
                               options: false});
            this.sendEvent(0, {id: 'setBorderAnimation', value: 'dataTone'});
            break;
          case 'pause':
            this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
            this.sendEvent(0, {id: 'setBorderAnimation', value: false});
            break;
        }
        if ('event' in this.tape[this.tapePhase]) {
          this.sendEvent(0, this.tape[this.tapePhase].event);
        }
        this.tapePhase++;
        if (this.tapePhase < this.tape.length) {
          this.sendEvent(this.tape[this.tapePhase-1].duration, {id: 'updateTape'});
        } else {
          this.sendEvent(this.tape[this.tapePhase-1].duration, {id: 'setMenuModel'});
        }
        return true;

      case 'setProgramName':
        this.programNameEntity.hide = false;
        return true;

      case 'showLoadingMessage':
        // ★ what the original's BASIC prints before it loads the picture:
        // JETPAC IS LOADING at row 9 column 7 and a flashing PLEASE WAIT at
        // row 12 column 10, bright white on black (tape_layout.md)
        if (this.programNameEntity) {
          this.programNameEntity.destroy();
          this.programNameEntity = null;
        }
        this.borderEntity.bkColor = ZXColor.black;
        this.desktopEntity.bkColor = ZXColor.black;
        this.inputLineEntity.hide = true;
        this.loadingMessageEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 7*8, 9*8, 18*8, 8, 'JETPAC IS LOADING', ZXColor.brightWhite, ZXColor.black, {leftMargin: 0});
        this.desktopEntity.addEntity(this.loadingMessageEntity);
        this.waitMessageEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 10*8, 12*8, 11*8, 8, 'PLEASE WAIT', ZXColor.brightWhite, ZXColor.black, {leftMargin: 0, flash: true});
        this.desktopEntity.addEntity(this.waitMessageEntity);
        return true;

      case 'tapeByte':
        // one byte off the tape, straight into the video memory; the entity
        // repaints itself on the next frame and nothing else is needed
        if (this.screenEntity && !this.tapeBreak) {
          this.screenEntity.pokeOffset(event.data.at, event.data.value);
        }
        return true;

      case 'tapeBlockEnd':
        if (!this.tapeBreak) {
          this.cancelEvent('updateTape');
          this.sendEvent(0, {id: 'updateTape'});
        }
        return true;

      case 'showLoadingScreen':
        var loading = this.loadDataFile('loading');
        if (loading) {
          if (this.programNameEntity) {
            this.programNameEntity.destroy();
            this.programNameEntity = null;
          }
          if (this.loadingMessageEntity) {
            this.loadingMessageEntity.destroy();
            this.loadingMessageEntity = null;
          }
          if (this.waitMessageEntity) {
            this.waitMessageEntity.destroy();
            this.waitMessageEntity = null;
          }
          // empty video memory to begin with — white paper, black ink, the
          // state the machine is in when the header has gone by; the bytes
          // themselves arrive one at a time with the block that follows
          this.screenEntity = new ZXVideoRAMEntity(this.desktopEntity, 0, 0);
          this.screenEntity.clear(0, ZXVideoRAM.BLANK_ATTRIBUTE);
          // the lower screen — the two lines BASIC keeps for itself — is
          // black on black before the picture comes
          this.screenEntity.videoRAM.fillAttributes(
            {row: ZXVideoRAM.ROWS-2, col: 0, rows: 2, cols: ZXVideoRAM.COLS}, 0);
          this.screenEntity.invalidate();
          this.desktopEntity.addEntity(this.screenEntity);
          // the input line has to print over the picture when BREAK comes
          var entities = this.desktopEntity.entities;
          entities.push(entities.splice(entities.indexOf(this.inputLineEntity), 1)[0]);
          this.tapeBreakLine = '10:7';
          // and it prints the way the running program has the lower screen
          // set: white ink on black paper
          this.inputLineEntity.setPenColor(ZXColor.white);
          this.inputLineEntity.setBkColor(ZXColor.black);
          // BORDER 0 — the program sets the border black before it loads on
          this.borderEntity.bkColor = ZXColor.black;
          this.desktopEntity.bkColor = ZXColor.black;
        }
        return true;

      case 'setMenuModel':
        this.app.setModel('MenuModel');
        return true;

      case 'keyPress':
        switch (event.key) {
          case 'Escape':
          case 'GamepadExit':
            this.app.setModel('MenuModel');
            return true;
          case ' ':
          case 'Enter':
          case 'GamepadOK':
            if (this.break()) {
              return true;
            }
            break;
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            this.app.inputEventsManager.keysMap[event.key] = this.borderEntity;
            return true;
          case 'Touch':
            this.app.inputEventsManager.touchesMap[event.identifier] = this.borderEntity;
            return true;
        }
        break;

      case 'keyRelease':
        switch (event.key) {
          case 'Mouse1':
          case 'Mouse2':
          case 'Mouse4':
            if (this.app.inputEventsManager.keysMap[event.key] === this.borderEntity && this.break()) {
              return true;
            }
            return true;
          case 'Touch':
            if (this.app.inputEventsManager.touchesMap[event.identifier] === this.borderEntity && this.break()) {
              return true;
            }
            return true;
        }
        break;

      case 'errorAudioBus':
        this.app.showErrorMessage(event.error, 'reopen');
        return true;
    }

    return false;
  } // handleEvent

  /**
   * Stops the load the way BREAK does on the real machine, or leaves when the
   * tape is already past the point of no return.
   * @returns {boolean} True when the event was consumed.
   */
  break() {
    if (this.tapeBreak) {
      this.app.setModel('MenuModel');
      return true;
    }

    if (this.tapePhase !== false) {
      this.cancelEvent('updateTape');
      this.cancelEvent('setMenuModel');
      this.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
      this.tapeBreak = true;
      // whatever the tape has put into the video memory stays there; the
      // report is printed over it
      this.inputLineEntity.setText('D BREAK - CONT repeats, '+this.tapeBreakLine);
      this.inputLineEntity.hide = false;
      this.sendEvent(0, {id: 'setBorderAnimation', value: false});
      this.sendEvent(5000, {id: 'setMenuModel'});
      return true;
    }
    return false;
  } // break

  loopModel(timestamp) {
    super.loopModel(timestamp);

    this.drawModel();
  } // loopModel

} // TapeLoadingModel
