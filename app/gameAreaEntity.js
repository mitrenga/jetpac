const { ZXVideoRAMEntity } = await import('./svision/js/platform/canvas2D/zx/zxVideoRAMEntity.js?ver='+window.srcVersion);
const { ScreenLayout } = await import('./screenLayout.js?ver='+window.srcVersion);
const { ScreenComposer } = await import('./screenComposer.js?ver='+window.srcVersion);
// begin code

/**
 * The screen: **all of it**, 256x192, panel included.
 *
 * Unlike the sibling remakes this is not a play area with a panel entity above
 * it. Jetpac prints its panel into the same video memory it draws the game
 * into ($4021 and friends are screen addresses, $70A4 works out the place of
 * the lives with the same routine that works out the place of a sprite), so
 * splitting the two would be a remake's idea rather than the game's.
 *
 * The memory, the painting and the off-screen cache are svision's
 * {@link ZXVideoRAMEntity} (R-003, R-022). What is left here is feeding it
 * with a frame from the worker, which ScreenComposer turns into 6912 bytes.
 */
export class GameAreaEntity extends ZXVideoRAMEntity {

  /**
   * @param {AbstractEntity} parentEntity - The parent entity.
   * @param {number} x - X position relative to the parent.
   * @param {number} y - Y position relative to the parent.
   * @param {ScreenComposer} render - The shared renderer.
   */
  constructor(parentEntity, x, y, render) {
    super(parentEntity, x, y,
          {col: 0, row: 0, cols: ScreenLayout.COLS, rows: ScreenLayout.ROWS});
    this.id = 'GameAreaEntity';

    this.render = render;
    this.frameState = {};
    this.previousState = null;
    this.videoRAM.enableInkPlane(ScreenLayout.TRUE_COLOUR);
  } // constructor

  /**
   * Switches the pixel-resolution colour on or off at run time
   * (ScreenLayout.TRUE_COLOUR is where it starts).
   *
   * ★ The history has to be thrown away with it: what the ink plane knows it
   * learned from the writes that went through it, so a plane switched on
   * halfway through a round would only own the pixels drawn since. The next
   * frame is therefore built from scratch — which costs the colour trail of
   * the round, and is why this is a switch and not something to flick.
   * @param {boolean} on - Whether to paint through the ink plane.
   */
  setTrueColour(on) {
    this.videoRAM.enableInkPlane(on);
    this.previousState = null;
    if (this.frameState && this.frameState.entities) {
      this.setFrame(this.frameState);
    } else {
      this.cleanCache();
    }
  } // setTrueColour

  /**
   * ★ The screen the original's **menu** sits on: black, with the panel on it
   * and nothing else ($6260 prints JETPAC GAME SELECTION over a screen that
   * $608A has just cleared). The hall of fame and the about screen of the
   * remake sit on the same thing, so they look like the game rather than like
   * a web page.
   *
   * The panel is drawn by the game's own composer out of the game's own data,
   * in the ZX ROM font — the same code and the same bytes the game screen
   * uses, so the two cannot drift apart.
   * @param {AbstractModel} model - The model that owns the desktop.
   * @returns {ZXVideoRAMEntity|null} The screen, added to the desktop.
   */
  static panelScreen(model) {
    var gfx = model.loadDataFile('sprites');
    if (!gfx) {
      return null;
    }
    try {
      var fonts = model.app.fonts.zxFonts8x8Mono;
      var render = new ScreenComposer(gfx, {chars: fonts.fontsChars,
                                            data: fonts.fontsData});
      render.panelPlayer2 = false;                 // ZADANI.md §10/9: no 2UP
      var screen = new ZXVideoRAMEntity(model.desktopEntity, 0, 0);
      render.clearScreen(screen.videoRAM);
      // scores yes, lives no — the menu of the original shows no lives
      render.drawPanel(screen.videoRAM,
                       {score: model.app.score, score2: model.app.score2,
                        hiScore: model.app.hiScore, lives: 0, lives2: 0});
      screen.invalidate();
      model.desktopEntity.addEntity(screen);
      return screen;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  } // panelScreen

  /**
   * Takes the newest frame and **draws the difference** into the memory.
   *
   * ★ The drawing is done here rather than in {@link compose}, because it is
   * not a function of the newest frame: the original draws **incrementally**
   * (rubs each entity out where it was, draws it where it is) and never
   * cleans the colours up, so what is on the screen is the whole history of
   * the round. Every frame has to go through exactly once, in order — and
   * `compose()` is called when the cache is dirty, which is not the same
   * thing. The first frame, and only that one, is built from scratch.
   *
   * Measured against the original pass by pass, whole video memory:
   * `tools/matchtrail.js`.
   *
   * @param {Object} state - The 'frame' message of the worker.
   */
  setFrame(state) {
    if (this.previousState) {
      this.render.stepInto(this.videoRAM, state, this.previousState);
    } else {
      this.render.composeInto(this.videoRAM, state);
    }
    this.frameState = state;
    this.previousState = state;
    this.invalidate();
  } // setFrame

  /**
   * Throws the history away, so the next frame is built from scratch. Called
   * when the screen is left and come back to.
   */
  resetFrames() {
    this.previousState = null;
  } // resetFrames

} // GameAreaEntity
