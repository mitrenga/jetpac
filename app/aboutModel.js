const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * ABOUT GAME as a screen of its own: the original's menu screen (black with
 * the panel on it, GameAreaEntity.panelScreen) with the copyright line on the
 * bottom row, and the about text and its buttons below the panel, all of its
 * width, in the proportional ROM font.
 *
 * ★ Jetpac has no music, so this screen is silent like the menu.
 *
 * The title bar keeps the dialog's counter: five clicks on it show the game
 * statistics from the server, five more the system information, five more the
 * text again. CLOSE (Escape, GamepadExit) goes back to the menu, MORE INFO
 * (Enter, GamepadOK) opens the about page.
 */
export class AboutModel extends AbstractModel {

  constructor(app) {
    super(app);
    this.id = 'AboutModel';

    this.screenEntity = null;
    this.gameInfoEntity = null;
    this.titleEntity = null;
    this.subtitleEntity = null;
    this.copyrightEntity = null;
    this.aboutEntity = null;

    // the about panel under the panel of the original's screen, all of its
    // width: the title one empty row below the score row (row 3), one more
    // empty row, the text from row 5, the buttons on row 21 above the
    // copyright line on row 23 — all of it in the proportional ROM font
    this.panelX = 0;
    this.panelY = 3*8;
    this.panelWidth = 32*8;
    this.panelHeight = 20*8;
    this.panelBkColor = ZXColor.black;

    this.aboutText = 'Jetpac is a remake of the 1983 Ultimate Play the Game classic for the 16K ZX Spectrum.\n' +
                    'Jetman\'s rocket lies in pieces on an alien planet. Stack the parts on its base, fill the tank with ' +
                    'six loads of fuel and take off for the next planet, while waves of aliens pour in from both sides ' +
                    'of the screen. Treasure falling from the sky is worth extra points.\n' +
                    'The high scores are kept in the hall of fame on the server.';
    this.statsText = 'error:\nstatistics data not available!';
    this.clickCounter = 0;
  } // constructor

  newBorderEntity() {
    // no X in the border: CLOSE and the ESC of the panel go back to the menu
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
      // ★ the copyright line of the original's own menu screen, where it has
      // it: the bottom row, bright white ($6283 prints it at $B800, i.e. row
      // 23, from the string at $6040)
      this.copyrightEntity = new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, 0, 23*8, 32*8, 8, '©1983 A.C.G. ALL RIGHTS RESERVED', ZXColor.brightWhite, ZXColor.black, {align: 'center'});
      this.desktopEntity.addEntity(this.copyrightEntity);
    } else {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'JETPAC', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/sprites.json). RUN tools/dumpsprites.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
    }

    // the about text and the buttons, over the middle of the frame
    this.aboutEntity = new AbstractEntity(this.desktopEntity, this.panelX, this.panelY, this.panelWidth, this.panelHeight, false, ZXColor.black);
    this.desktopEntity.addEntity(this.aboutEntity);
    var w = this.panelWidth, h = this.panelHeight;
    var fonts = this.app.fonts.zxFonts8x8;
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, fonts, 0, 0, w, 8, 'ABOUT GAME', {id: 'clickLabel'}, [], ZXColor.brightRed, false, {align: 'center', member: 'titleBar', hoverColor: ZXColor.black, clickColor: ZXColor.black}));
    this.aboutEntity.addEntity(new TextEntity(this.aboutEntity, fonts, 0, 2*8, w, h-5*8, this.aboutText, ZXColor.brightWhite, false, {align: 'justify', textWrap: true, member: 'aboutText'}));
    // the buttons as CANCEL / OK of the player name dialog draw them
    // (PlayerNameEntity): the font's height plus 8, the text 4 px down, 2 px
    // over the bottom edge
    var buttonHeight = fonts.charsHeight+8;
    var buttonY = h-buttonHeight-2;
    var topMargin = Math.floor((buttonHeight-fonts.charsHeight)/2);
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, fonts, 0, buttonY, 76, buttonHeight, 'MORE INFO', {id: 'openAboutURL'}, ['Enter', 'GamepadOK'], ZXColor.brightWhite, ZXColor.green, {align: 'center', topMargin: topMargin}));
    this.aboutEntity.addEntity(new ButtonEntity(this.aboutEntity, fonts, w-52, buttonY, 52, buttonHeight, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', topMargin: topMargin}));

    this.fetchData('stats.db', false, {});


    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData

  setData(data) {
    this.statsText = '';
    Object.entries(data.data).forEach(([periodKey, periodValue]) => {
      this.statsText += periodKey + ': [';
      Object.entries(periodValue).forEach(([key, value]) => {
        this.statsText += key + ':' + value + ', ';
      });
      this.statsText = this.statsText.slice(0, -2) + ']\n';
    });
  } // setData

  errorData(error) {
  } // errorData

  /**
   * Switches the panel between the about text, the statistics and the system
   * information, by the count of clicks on the title bar.
   * @returns {void}
   */
  updateAbout() {
    switch (Math.floor(this.clickCounter/5)) {
      case 1:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'GAME STATS'});
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: this.statsText});
        break;
      case 2:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'SYSTEM INFO'});
        var ipLabelSeparator = ' ';
        if (window.clientIP.indexOf(':') >= 0) {
          ipLabelSeparator = '\n';
        }
        var sysInfoText =
          'version: ' + this.app.version + '\n' +
          'element: ' + this.app.element.clientWidth + ' x ' + this.app.element.clientHeight + '\n' +
          'canvas: ' + this.app.element.width + ' x ' + this.app.element.height + '\n' +
          'ratio: ' + this.app.layout.ratio + '\n' +
          'ip:' + ipLabelSeparator + window.clientIP + '\n';
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: sysInfoText});
        break;
      default:
        this.sendEvent(0, {id: 'updateEntity', member: 'titleBar', text: 'ABOUT GAME'});
        this.sendEvent(0, {id: 'updateEntity', member: 'aboutText', text: this.aboutText});
        break;
    }
  } // updateAbout

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;

      case 'closeAbout':
        this.app.setModel('MenuModel');
        return true;

      case 'openAboutURL':
        window.location.href = 'about';
        return true;

      case 'clickLabel':
        if (this.clickCounter < 14) {
          this.clickCounter++;
        } else {
          this.clickCounter = 0;
        }
        if (this.clickCounter%5 == 0) {
          this.updateAbout();
        }
        return true;

      case 'resizeModel':
        if (this.clickCounter > 9) {
          this.updateAbout();
        }
        return false;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    }

    this.drawModel();
  } // loopModel

} // AboutModel
