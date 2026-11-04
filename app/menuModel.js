const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { BorderEntity } = await import('./borderEntity.js?ver='+window.srcVersion);
const { JetpacLogoEntity } = await import('./jetpacLogoEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { ZXPlayerNameEntity } = await import('./svision/js/platform/canvas2D/zx/zxPlayerNameEntity.js?ver='+window.srcVersion);
const { ZXVolumeEntity } = await import('./svision/js/platform/canvas2D/zx/zxVolumeEntity.js?ver='+window.srcVersion);
const { ZXSettingsEntity } = await import('./svision/js/platform/canvas2D/zx/zxSettingsEntity.js?ver='+window.srcVersion);
const { ZXWaitForAudioEventEntity } = await import('./svision/js/platform/canvas2D/zx/zxWaitForAudioEventEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { ZXDialogEntity } = await import('./svision/js/platform/canvas2D/zx/zxDialogEntity.js?ver='+window.srcVersion);
const { ZXDialogProperties } = await import('./svision/js/platform/canvas2D/zx/zxDialogProperties.js?ver='+window.srcVersion);
const { DialogTheme } = await import('./svision/js/platform/canvas2D/dialogs/dialogTheme.js?ver='+window.srcVersion);
const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { GameAreaEntity } = await import('./gameAreaEntity.js?ver='+window.srcVersion);
// begin code

/**
 * Main menu, the same structure as the other ZX remakes — but with two items
 * the original itself has:
 *
 * - ★ **HALL OF FAME** (the screen itself keeps the original's heading
 *   ULTIMATE HALL OF FAME, $B346), because the original has one (six places, table at
 *   $B304). The original also flips the menu over to it by itself every
 *   sixteen seconds or so (CounterHallOfFame, $96B8, measured 823 / 802
 *   frames — data/global.json hallOfFame); the remake **does not** (decided
 *   2026-09-07, ZADANI chap. 6): its menu is something to browse, and a panel
 *   opening on top of it was never asked for. The hall of fame is an item.
 *
 * ★ Decided 2026-09-07 (ZADANI chap. 6): the menu is **one player only**
 * (the original offers `1 PLAYER GAME` / `2 PLAYER GAME`; the worker and the
 * panel still know both, the menu asks for neither), there is **one volume**
 * (SOUNDS — the music goes over the same bus, a MUSIC slider went), and the remake's
 * own MAP OF THE WORLD, TRAINING SCREEN and PHYSICS SANDBOX are gone.
 *
 * What is the remake's own is the rest of the menu, the key remapping, the
 * options and the touch controls (ZADANI chap. 6). And unlike Underwurlde
 * there is a MUSIC slider, because Sabre Wulf has music.
 *
 * The menu itself never touches the audio buses; items that need sound go
 * through ZXWaitForAudioEventEntity first when the browser wants a user
 * gesture.
 */
export class MenuModel extends AbstractModel {

  constructor(app, selectionItem) {
    super(app);
    this.id = 'MenuModel';

    // ★ coloured in the groups of the original's game selection screen, read
    // off sources/media/screens/title_menu.scr: the game itself in bright
    // yellow ($46), the choices in bright cyan ($45), START GAME in bright
    // white ($47)
    var game = ZXColor.brightYellow, choice = ZXColor.brightCyan, about = ZXColor.brightWhite;
    this.menuItems = [
      {t1: 'START GAME', event: {id: 'startGame', players: 1}, penColor: game},
      {t1: 'PLAYER NAME', event: {id: 'setPlayerName'}, penColor: game},
      {t1: 'HALL OF FAME', event: {id: 'showHallOfFame'}, penColor: game},
      {t1: 'SOUNDS', event: {id: 'setSounds'}, penColor: choice},
      {t1: 'SETTINGS', event: {id: 'setSettings'}, penColor: choice},
      {t1: 'SHOW TAPE LOADING', event: {id: 'startTapeLoading'}, penColor: choice},
      {t1: 'ABOUT GAME', event: {id: 'showAbout'}, penColor: about}
    ];
    this.menuOptions = {
      fonts: this.app.fonts.zxFonts8x8,
      // the menu sits where the original's items are: below the panel, from
      // character row 5 down ($628D places JETPAC GAME SELECTION on row 5 and
      // the items under it)
      leftMargin: 4,
      rightMargin: 4,
      topMargin: 8,
      itemHeight: 12,
      t1LeftMargin: 3,
      t1TopMargin: 2,
      t2Width: 96,
      t2RightMargin: 3,
      t2TopMargin: 2,
      textColor: ZXColor.brightWhite,
      // the bar takes the colour of the selected item's group (selectionBarColor
      // false) and the text goes black on it
      selectionTextColor: ZXColor.black,
      selectionBarColor: false,
      hoverColor: '#333333ff',
      selectionHoverColor: false,
      clickColor: '#444444ff',
      selectionClickColor: false,
      selection: selectionItem
    };
    // the dialogs opened from the menu look like the ABOUT GAME panel
    // (aboutModel.js): a black window with the title in bright red over the
    // black middle of the jungle frame. The contents come from svision and are
    // laid out for 200 x 124 px; the window has no frame, only the title bar,
    // so they get 192 x 117 — the right edge of the volume panel (MAX, +) and
    // of the keyboard loses up to 6 px, the bottom row moves up with the
    // height. It fills cells 4-27 of the jungle frame in width and has the
    // title on the same row as the about panel (36, 42, 184 x 126), with the
    // same bottom edge at 168. What is not set here is the default of
    // ZXDialogProperties (the look of Manic Miner)
    this.dialogProperties = ZXDialogProperties.merge({
      x: 32,
      y: 42,
      width: 192,
      height: 126,
      frameWidth: 0,
      titleColor: ZXColor.brightRed,
      bkColor: ZXColor.black,
      theme: {
        penColor: ZXColor.brightWhite,
        valueColor: choice,
        selectionColor: game,
        selectionPenColor: ZXColor.black,
        hoverColor: '#333333ff',
        clickColor: '#444444ff',
        separatorColor: ZXColor.brightWhite,
        iconColor: ZXColor.brightCyan,
        sliderColor: ZXColor.brightWhite,
        keyboardButtonsBkColor: ZXColor.brightCyan,
        // the default keyboard is 194 px wide, the panel 192: the rows are shifted
        // by 7 instead of 9 and SPACE is 23 instead of 25, so the widest row is
        // exactly 192. `update` merges `buttons` key by key (the other keys stay)
        // and replaces `rows` whole
        keyboardLayout: {
          action: 'update',
          options: {
            rows: [{shiftX: 0}, {shiftX: 5}, {shiftX: 10}, {shiftX: 0}],
            buttons: {
              '⇧': {width: 19},
              ' ': {width: 21}
            }
          }
        }
      },
      // the remap dialog covers the whole settings window, its title bar
      // included: the contents start 9 px under the top of the window, so the
      // dialog sits at -9 and the contents must not clip it. It looks like the
      // settings window itself: no frame, black panel, the title in bright
      // red, the same colours inside
      clipsChildren: false,
      remapKeys: {
        x: 0,
        y: -9,
        width: 192,
        height: 126,
        frameWidth: 0,
        titleColor: ZXColor.brightRed,
        bkColor: ZXColor.black,
        theme: {
          penColor: ZXColor.brightWhite,
          valueColor: choice,
          // the field awaiting the key: black cursor on cyan
          selectionColor: ZXColor.cyan,
          selectionPenColor: ZXColor.black
        }
      },
      // the gesture for audio: the popup of the about panel, black on yellow
      waitForAudioEvent: {frameColor: ZXColor.black, bkColor: ZXColor.brightYellow, theme: {penColor: ZXColor.black}}
    });

    // the player name dialog: the same black window, but its title and its
    // CANCEL / OK in the proportional ROM font, as the about screen and the
    // hall of fame are, the keys of its keyboard bright white and a held
    // CAPS SHIFT / SYMBOL SHIFT bright yellow; the other dialogs keep the
    // menu's. The window is a row taller at either end (34-176 instead of
    // 42-168): the title goes a row up, CANCEL / OK a row down, and the
    // keyboard, centred between them, stays where it was. A plain deep merge
    // over the menu's properties: ZXDialogProperties.merge would fill them
    // in from the ZX defaults again (the yellow window of Manic Miner)
    this.playerNameProperties = DialogTheme.mergeDeep(this.dialogProperties, {
      y: 34,
      height: 142,
      fonts: 'zxFonts8x8',
      theme: {
        buttonFont: 'zxFonts8x8',
        keyboardButtonsBkColor: ZXColor.brightWhite,
        keyboardButtonsShiftColor: ZXColor.brightYellow
      }
    });

    this.titleEntity = null;
    this.subtitleEntity = null;
    this.versionEntity = null;
    this.menuEntity = null;
    this.newVersionAvailable = false;
    // the window of the dialog open from the menu (openDialog), while it lasts
    this.dialogEntity = null;
    // the jungle frame of the original's menu screen (RoomComposer.composeMainMenu)
    this.screenEntity = null;
    this.gameInfoEntity = null;
  } // constructor

  newBorderEntity() {
    return new BorderEntity(false, false);
  } // newBorderEntity

  init() {
    super.init();

    this.borderEntity.bkColor = ZXColor.black;
    this.desktopEntity.bkColor = ZXColor.black;

    // the data files: at once from localStorage, or from the server when
    // they are missing there (R-062)
    this.loadDataFiles(['sprites', 'sounds'], (files, error) => this.initData(files, error));

    this.sendEvent(0, {id: 'closeAllAudioBuses'});
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
    // ★ The original's own menu screen is **black with the panel on it**
    // (JETPAC GAME SELECTION, $6260): no picture, no frame, just 1UP, HI and
    // 2UP with their scores and the items below. That is what this is — the
    // panel is drawn into video memory by the same composer the game uses,
    // out of the same data, with the ZX ROM font.
    this.screenEntity = GameAreaEntity.panelScreen(this);
    if (this.screenEntity) {
      // the JETPAC logo where the original prints 2UP (ZADANI.md §10/9)
      this.desktopEntity.addEntity(new JetpacLogoEntity(this.desktopEntity));
    } else {
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8, 0, 8*8, this.desktopWidth, 8, 'JETPAC', ZXColor.brightWhite, false, {align: 'center'}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.fonts5x5, 8, 8*8+16, this.desktopWidth-16, 40,
        'GAME DATA MISSING (data/sprites.json). RUN tools/dumpsprites.py.', ZXColor.brightGreen, false, {align: 'center', textWrap: true}));
    }
    // inside the jungle frame: cells 4-27 x 5-20 are the black middle, 4 px
    // kept free on either side
    this.menuEntity = new MenuEntity(this.desktopEntity, 36, 42, 184, 126, this.desktopEntity.bkColor, this.menuOptions, this, this.getMenuData);
    this.desktopEntity.addEntity(this.menuEntity);

    // the version, centred in the ZX font on the bottom band of the jungle frame
    // (rows 21-23); still a button, because a newer version on the server turns
    // it into UPGRADE !
    // black only behind the text, so the band keeps its jungle on both sides
    var versionText = 'v'+this.app.version;
    var versionWidth = 14*8;                            // fourteen cells, centred
    this.versionEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Mono, (this.desktopWidth-versionWidth)/2, 176, versionWidth, 8, versionText, {id: 'upgradeApp'}, [], ZXColor.brightWhite, ZXColor.black, {align: 'center'});
    this.desktopEntity.addEntity(this.versionEntity);
    // suppress the hover/click colors resolved in init(), so the button always
    // looks like plain text
    this.versionEntity.hoverColor = false;
    this.versionEntity.clickColor = false;
    this.checkServerVersion();


    // Menu je **němé**, a to schválně: prohlížeč pustí zvuk až po gestu
    // uživatele, a do menu se přijde hned po načtení stránky, kdy žádné gesto
    // ještě být nemuselo. Sběrnice se proto zavřou a zvuk začíná až o patro
    // níž, za položkou menu, kterou hráč zvolil — tam už gesto proběhlo a
    // ZXWaitForAudioEventEntity si ho v handleEvent umí vyžádat. Preludium
    // originálu hraje pod ABOUT GAME (aboutModel.js); hall of fame je němá
    // jako menu.
    // the flash clock of the ZX attributes (app.stack.flashState, 330 ms like
    // the ROM's 16 frames): the blinking cursor of the remap dialog and of the
    // player name input reads it, so the menu has to keep it going like every
    // other model
    this.app.stack.flashState = false;
    this.sendEvent(330, {id: 'changeFlashState'});
  } // initData


  checkServerVersion() {
    var receiver = {
      id: this.id+'Version',
      fetchDataId: '',
      setData: (data) => {
        if (data.data.version && data.data.version !== 'unknown' && data.data.version !== this.app.version) {
          this.newVersionAvailable = true;
          // not over the copyright line of an open dialog; showVersion() puts
          // UPGRADE ! there when the dialog closes
          if (this.dialogEntity === null) {
            this.showVersion();
          }
        }
      },
      errorData: () => {}
    };
    receiver.fetchDataId = this.app.fetchData('version.db', false, {}, receiver);
  } // checkServerVersion

  getMenuData(self, key, row) {
    switch (key) {

      case 'numberOfItems':
        return self.menuItems.length;

      case 't2':
        switch (row) {
          case 1:
            return self.app.playerName;
          case 3:
            return self.volumeText(self.app.audioManager.volume.sounds);
        }
        break;

      default:
        if (key in self.menuItems[row]) {
          return self.menuItems[row][key];
        }
        break;

    }
    return '';
  } // getMenuData

  /**
   * The level as the volume dialog words it (VolumeControl.levelText): OFF,
   * 10%..90%, MAX.
   * @param {number} volume - A slider's 0-10.
   * @returns {string}
   */
  volumeText(volume) {
    return ZXVolumeEntity.levelText(volume);
  } // volumeText

  /**
   * Opens a dialog from the menu: the window with the title (ZXDialogEntity)
   * over the middle of the jungle frame, placed and coloured by the dialog
   * properties, and the contents the factory makes for it, as the modal of
   * the desktop.
   * @param {string} title - The text of the title bar.
   * @param {Function} contentFactory - Called with the window, returns the contents entity.
   */
  openDialog(title, contentFactory, properties) {
    var p = properties || this.dialogProperties;
    this.dialogEntity = new ZXDialogEntity(this.desktopEntity, p.x, p.y, p.width, p.height, title, p, contentFactory);
    this.desktopEntity.addModalEntity(this.dialogEntity);
    // while the dialog is open the bottom band shows the copyright line of the
    // original's screen instead of the version, like the hall of fame and the
    // about screen do; the version comes back when the dialog closes
    // (handleEvent, 'destroy' of the window)
    this.versionEntity.setText('© 1984  A.C.G.');
    this.versionEntity.setPenColor(ZXColor.brightWhite);
  } // openDialog

  /**
   * Puts the version back on the bottom band: the version number, or UPGRADE !
   * in red when the server has a newer one.
   */
  showVersion() {
    if (this.newVersionAvailable) {
      this.versionEntity.setText('UPGRADE !');
      this.versionEntity.setPenColor(ZXColor.brightRed);
    } else {
      this.versionEntity.setText('v'+this.app.version);
      this.versionEntity.setPenColor(ZXColor.brightWhite);
    }
  } // showVersion

  /**
   * Asks for the browser's gesture for audio before an action that plays
   * sound: ZXWaitForAudioEventEntity in a window without a title, centred on
   * the screen, coloured by the `waitForAudioEvent` dialog properties.
   * @param {string} continueEvent - The event sent when the gesture comes.
   */
  openWaitForAudioEvent(continueEvent) {
    var p = this.dialogProperties.waitForAudioEvent;
    this.desktopEntity.addModalEntity(new ZXDialogEntity(this.desktopEntity, 66, 77, 124, 41, false, p, (dialog) => new ZXWaitForAudioEventEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, continueEvent, p)));
  } // openWaitForAudioEvent

  handleEvent(event) {
    // the dialog's window closing — the desktop removes it in super.handleEvent
    // and returns true, so the version has to come back before that
    if (event.id == 'destroy' && event.entity === this.dialogEntity) {
      this.dialogEntity = null;
      this.showVersion();
    }
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'startGame':
        this.app.setPlayers(event.players);
        if (!this.app.playerName.length) {
          this.openDialog('PLAYER NAME', (dialog) => new ZXPlayerNameEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, true, this.playerNameProperties), this.playerNameProperties);
          return true;
        } else {
          if (this.app.inputEventsManager.needEventForAudio()) {
            this.openWaitForAudioEvent('startGame2');
            return true;
          }
        }
      case 'startGame2':
        // straight into the game: the original's game selection screen **is**
        // this menu, so there is no title screen in between
        this.app.startGame();
        return true;

      case 'setPlayerName':
        this.openDialog('PLAYER NAME', (dialog) => new ZXPlayerNameEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, false, this.playerNameProperties), this.playerNameProperties);
        return true;

      case 'showHallOfFame':
        // a screen of its own (hallOfFameModel.js); silent, so no gesture for
        // audio is needed on the way
        this.app.setModel('HallOfFameModel');
        return true;

      case 'setSounds':
        // ★ Jetpac has no music, so the sample is a sound of the game: three
        // laser shots, four frames apart, the way the trigger lets them out
        // ($681E and $6F94; AudioManager.volumeSample)
        this.openDialog('SOUNDS', (dialog) => new ZXVolumeEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, 'sounds', 'audioBusSoundsLevel', 'volumeSample', this.dialogProperties));
        return true;

      case 'setSettings':
        this.openDialog('SETTINGS', (dialog) => new ZXSettingsEntity(dialog, dialog.innerX, dialog.innerY, dialog.innerWidth, dialog.innerHeight, this.app.controlsOptions, this.dialogProperties));
        return true;

      case 'startTapeLoading':
        if (this.app.inputEventsManager.needEventForAudio()) {
          this.openWaitForAudioEvent('startTapeLoading2');
          return true;
        }
      case 'startTapeLoading2':
        this.app.setModel('TapeLoadingModel');
        return true;

      case 'showAbout':
        // a screen of its own with the prelude under it (aboutModel.js), so
        // the browser's gesture for audio is asked for first, as for the game
        if (this.app.inputEventsManager.needEventForAudio()) {
          this.openWaitForAudioEvent('showAbout2');
          return true;
        }
      case 'showAbout2':
        this.app.setModel('AboutModel');
        return true;

      case 'upgradeApp':
        if (this.newVersionAvailable) {
          this.app.upgradeApp();
        }
        return true;

      case 'changeFlashState':
        this.app.stack.flashState = !this.app.stack.flashState;
        this.sendEvent(330, {id: 'changeFlashState'});
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.desktopEntity.modalEntity) {
      this.desktopEntity.modalEntity.loopEntity(timestamp);
    } else if (this.menuEntity) {
      // a player's name too long for its column ping-pongs
      this.menuEntity.loopEntity(timestamp);
    }

    this.drawModel();
  } // loopModel

} // MenuModel
