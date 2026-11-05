const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SlidingTextEntity } = await import('./svision/js/platform/canvas2D/slidingTextEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { JetpacLogoEntity } = await import('./jetpacLogoEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * HALL OF FAME as a screen of its own, in the same shape as aboutModel.js:
 * the original's menu screen (black with the panel on it,
 * GameAreaEntity.panelScreen) with the copyright line on row 23, and
 * the table below the panel, all of its width, in the proportional ROM font —
 * the heading one empty row below the score row (row 3), one more empty row,
 * ten places from row 5 and CLOSE above the copyright line on row 23.
 * Silent like the menu.
 *
 * ★ **The original has no hall of fame** (ZADANI chap. 10/4): only the HI in
 * the panel, gone when the machine is switched off. The table on the server
 * is the remake's own, as with its siblings, so there is no table of the
 * original to fall back on: with no scores yet, or offline, the places stay
 * empty and a note says why. A name too long for its column ping-pongs
 * (SlidingTextEntity), the way the player's name does in the menu.
 *
 * CLOSE (Enter, Escape, space, GamepadOK, GamepadExit) goes back to the menu.
 */
export class HallOfFameModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'HallOfFameModel';

    this.screenEntity = null;
    this.gameInfoEntity = null;
    this.titleEntity = null;
    this.subtitleEntity = null;
    this.copyrightEntity = null;
    this.tableEntity = null;
    this.rowEntities = [];
    // the names, ticked from loopModel(): a name too long for its column ping-pongs
    this.nameEntities = [];

    // the table under the panel, all of its width: rows 3-21, the same frame
    // as the about text (aboutModel.js), above the copyright line on row 23
    this.panelX = 0;
    this.panelY = 3*8;
    this.panelWidth = 32*8;
    this.panelHeight = 19*8;

    // ten places; db/hallOfFame.php returns as many
    this.places = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH', '10TH'];
  } // constructor

  newBorderEntity() {
    // no X in the border: CLOSE goes back to the menu
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['sprites'], (files, error) => this.initData(files, error));
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
    // the original's own menu screen: black with the panel on it
    this.screenEntity = GameAreaEntity.panelScreen(this);
    if (this.screenEntity) {
      // the JETPAC logo where the original prints 2UP (ZADANI.md §10/9), as
      // on the menu and in the game
      this.desktopEntity.addEntity(new JetpacLogoEntity(this.desktopEntity));
      // the copyright line as the menu shows it under its dialogs: on row 23,
      // in place of the remake's line, fourteen cells wide and centred, in
      // the ZX font, bright white (menuModel.openDialog)
      var copyrightWidth = 14*8;
      this.copyrightEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, (this.desktopWidth-copyrightWidth)/2, 23*8, copyrightWidth, 8, '©1983 A.C.G.', ZXColor.brightWhite, ZXColor.black, {align: 'center'});
      this.desktopEntity.addEntity(this.copyrightEntity);
    } else {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'JETPAC', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/sprites.json). RUN tools/dumpsprites.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
    }

    // the table under the panel, all on the black of the tableEntity itself:
    // the heading, the CLOSE button and the ten places drawn by showTable()
    this.tableEntity = new AbstractEntity(this.desktopEntity, this.panelX, this.panelY, this.panelWidth, this.panelHeight, false, ZXColor.black);
    this.desktopEntity.addEntity(this.tableEntity);
    var w = this.panelWidth, h = this.panelHeight;
    var fonts = this.app.fonts.zxFonts8x8;
    // the heading bright red and centred, as ABOUT GAME is (aboutModel.js)
    this.tableEntity.addEntity(new TextEntity(this.tableEntity, fonts, 0, 0, w, 8, 'HALL OF FAME', ZXColor.brightRed, false, {align: 'center'}));
    // CLOSE as the buttons of the about screen and of the player name
    // dialog: the font's height plus 8, the text 4 px down, 2 px over the
    // bottom edge
    var buttonHeight = fonts.charsHeight+8;
    this.tableEntity.addEntity(new ButtonEntity(this.tableEntity, fonts, w-52, h-buttonHeight-2, 52, buttonHeight, 'CLOSE', {id: 'closeHallOfFame'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', topMargin: Math.floor((buttonHeight-fonts.charsHeight)/2)}));

    if (navigator.onLine) {
      this.fetchData('hallOfFame.db', false, {});
    } else {
      this.showTable(this.defaultTable(), true);
    }

    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  /**
   * What the table shows without the server: nothing, since the original has
   * no table of its own (see the class comment).
   * @returns {Array} [{name, score}], empty.
   */
  defaultTable() {
    return [];
  } // defaultTable

  setData(data) {
    var rows = Object.keys(data.data).map((key) => data.data[key]);
    if (!rows.length) {
      // nobody has played yet: the places stay empty
      this.showTable(this.defaultTable(), true);
      return;
    }
    this.showTable(rows, false);
    if (rows[0]) {
      this.app.hiScore = Number(rows[0].score);
    }
  } // setData

  errorData(error) {
    this.showTable(this.defaultTable(), true);
  } // errorData

  /**
   * Draws the ten places.
   * @param {Array} rows - [{name, score}] in descending order of score.
   * @param {boolean} original - True when there are no scores from the server
   *        to show (nobody has played yet, or offline).
   */
  showTable(rows, original) {
    this.rowEntities.forEach((entity) => entity.destroy());
    this.rowEntities = [];
    this.nameEntities = [];
    var w = this.panelWidth, h = this.panelHeight;
    var fonts = this.app.fonts.zxFonts8x8;
    // the places in pairs, from the top down in the colours of the panel —
    // bright white, yellow, cyan — and 7TH to 10TH in plain white, on black;
    // 4 px between the rows, from row 5 (2 rows below the heading)
    var colors = [ZXColor.brightWhite, ZXColor.brightWhite, ZXColor.brightYellow, ZXColor.brightYellow,
                  ZXColor.brightCyan, ZXColor.brightCyan, ZXColor.white, ZXColor.white, ZXColor.white, ZXColor.white];
    for (var i = 0; i < this.places.length; i++) {
      var y = 2*8+i*12;
      var row = rows[i];
      var color = colors[i];
      // place right-aligned in 32 px, the score right-aligned in the next
      // 56 px, the name flush right in what is left of the width
      var place = new TextEntity(this.tableEntity, fonts, 0, y, 32, 8, this.places[i], color, false, {align: 'right'});
      this.tableEntity.addEntity(place);
      this.rowEntities.push(place);
      var score = new TextEntity(this.tableEntity, fonts, 32, y, 56, 8, row ? String(row.score).padStart(6, '0') : '', color, false, {align: 'right'});
      this.tableEntity.addEntity(score);
      this.rowEntities.push(score);
      var name = new SlidingTextEntity(this.tableEntity, fonts, 96, y, w-96, 8, row ? String(row.name) : '', color, false, {align: 'right', animation: 'pingPong', speed: 30});
      this.tableEntity.addEntity(name);
      this.rowEntities.push(name);
      this.nameEntities.push(name);
    }
    if (original) {
      // on the line of the CLOSE text: the button is the font's height plus
      // 8, 2 px over the bottom edge, its text 4 px down
      var note = new TextEntity(this.tableEntity, fonts, 0, h-fonts.charsHeight-8-2+4, w-60, 8,
        navigator.onLine ? 'NOBODY HAS PLAYED YET' : 'SYSTEM OFFLINE',
        ZXColor.brightRed, false, {});
      this.tableEntity.addEntity(note);
      this.rowEntities.push(note);
    }
  } // showTable

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'closeHallOfFame':
        this.app.setModel('MenuModel');
        return true;

    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    } else {
      // entities are not ticked on their own: the long names ping-pong only
      // when the model advances them, as the menu does with the player's name
      this.nameEntities.forEach((entity) => entity.loopEntity(timestamp));
    }

    this.drawModel();
  } // loopModel

} // HallOfFameModel
