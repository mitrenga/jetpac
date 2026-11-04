const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { MenuEntity } = await import('./svision/js/platform/canvas2D/menuEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The pause panel. ★ The original pauses too — it holds the game while
 * CAPS SHIFT is held ($69BD) — but it has no screen or menu for it
 * (ZADANI chap. 10/4); RESUME / SOUNDS / EXIT is the remake's own, like the
 * main menu itself. Jetpac has no music, so SOUNDS is the one switch.
 *
 * The look is the Spectrum's: an 8 px white frame all round, the title in the
 * proportional ROM font in the top band of the frame, the items black on
 * cyan inside. 160 x 72 px, its top left corner on the cell grid (48, 64,
 * gameModel.js).
 */
export class PauseGameEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height, title, exitModel) {
    super(parentEntity, x, y, width, height, false, false);
    this.id = 'PauseGameEntity';

    this.title = title;
    this.exitModel = exitModel;
    this.menuItems = [
      {t1: 'RESUME GAME', event: {id: 'closePauseGame'}},
      {t1: 'SOUNDS', event: {id: 'changeSoundsState'}},
      {t1: 'EXIT GAME', event: {id: 'exitGame'}}
    ];
    // the frame all round, the title in its top band
    this.frameWidth = 8;
    // the selection bar keeps the frame's own width from the frame on every
    // side: the cyan inside is 144 x 56, so 8 px all round and three rows
    // of 12 px, 14 px apart (8 + 12 + 2 + 12 + 2 + 12 + 8 = 56). itemPitch
    // has to be set, the menu's own is 16
    this.menuOptions = {
      fonts: this.app.fonts.zxFonts8x8,
      leftMargin: 8,
      rightMargin: 8,
      topMargin: 8,
      itemHeight: 12,
      itemPitch: 14,
      t1LeftMargin: 3,
      t1TopMargin: 2,
      t2Width: 48,
      t2RightMargin: 3,
      t2TopMargin: 2,
      textColor: ZXColor.black,
      selectionTextColor: ZXColor.black,
      selectionBarColor: ZXColor.brightWhite,
      hoverColor: '#0000001e',
      selectionHoverColor: '#ffffffcc',
      clickColor: '#0000002e',
      selectionClickColor: ZXColor.white
    };
  } // constructor

  init() {
    super.init();
    var f = this.frameWidth;
    // the white frame (the whole panel; the cyan inside covers its middle)
    this.addEntity(new AbstractEntity(this, 0, 0, this.width, this.height, false, ZXColor.white));
    // the title in the top band of the frame, black, centred
    this.addEntity(new TextEntity(this, this.app.fonts.zxFonts8x8, 0, 0, this.width, f, this.title, ZXColor.black, false, {align: 'center'}));
    this.addEntity(new MenuEntity(this, f, f, this.width-2*f, this.height-2*f, ZXColor.cyan, this.menuOptions, this, this.getMenuData));
  } // init

  getMenuData(self, key, row) {
    switch (key) {
      
      case 'numberOfItems':
        return self.menuItems.length;

      case 't2':
        switch (row) {
          case 1:
            return self.app.muted.sounds ? 'MUTE' : 'ON';
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

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {

      case 'keyPress':
        switch (event.key) {
          case 'Escape':
            this.sendEvent(-1, 1, {id: 'continueGame'});
            this.destroy();
            return true;
        }
        break;

      case 'closePauseGame':
        this.sendEvent(-1, 1, {id: 'continueGame'});
        this.destroy();
        return true;
        
      case 'changeSoundsState':
        this.app.muted.sounds = !this.app.muted.sounds;
        this.sendEvent(0, 0, {id: 'muteAudioBus', bus: 'sounds', muted: this.app.muted.sounds});
        this.sendEvent(1, 0, {id: 'refreshMenu'});
        return true;

      case 'exitGame':
        this.app.setModel(this.exitModel);
        return true;
    }

    return false;
  } // handleEvent

} // PauseGameEntity
