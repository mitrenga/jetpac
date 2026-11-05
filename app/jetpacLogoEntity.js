const { SpriteEntity } = await import('./svision/js/platform/canvas2D/spriteEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * The JETPAC logo in the top right corner of the panel — where the original
 * prints `2UP` and its score (ZADANI.md §10/9).
 *
 * The letters are the ones of `sources/font/JETPAC IS LOADING.png`, read off
 * the picture pixel by pixel: a bold face with three-pixel strokes that is in
 * no font of the zx-fonts collection, so it lives here as a grid rather than
 * in a font table. It is **not** on the original's eight-pixel character
 * pitch — the gaps between the letters are the picture's own, one pixel
 * each, and JET and PAC are two pixels apart (the picture leaves a whole
 * word space there).
 *
 * Forty-nine by seven pixels. The top four rows are bright cyan and the bottom three bright red,
 * and the logo sits at `y = 4`, so the colour changes exactly on the boundary
 * of character rows 0 and 1 — the way an attribute cell would have to.
 */
export class JetpacLogoEntity extends SpriteEntity {

  /** where the panel prints `2UP` and its score: cells 25-31, rows 0-1 */
  static get X() { return 204; }
  static get Y() { return 4; }

  /**
   * @param {AbstractEntity} parentEntity - The desktop.
   * @param {number} [x] - Left edge; the panel's place when absent.
   * @param {number} [y] - Top edge; the panel's place when absent.
   */
  constructor(parentEntity, x, y) {
    super(parentEntity,
          x === undefined ? JetpacLogoEntity.X : x,
          y === undefined ? JetpacLogoEntity.Y : y,
          false, false, 0, 0);
    this.id = 'JetpacLogoEntity';
    this.setGraphicsData({
      frames: 1, directions: 1,
      colors: {c: ZXColor.brightCyan, r: ZXColor.brightRed},
      sprite: [[
        'ccccccc-ccccccc-ccccccc--cccccc----cccccc--cccccc',
        'ccccccc-cccccc--ccccccc--ccccccc--ccccccc-cccccc-',
        '--ccc---ccc-------ccc----ccc-ccc--ccc-ccc-ccc----',
        '--ccc---ccccc-----ccc----ccccccc-cccccccc-ccc----',
        '--rrr---rrr-------rrr----rrrrrr--rrrrrrrr-rrr----',
        'rrrrr---rrrrrr----rrr----rrr----rrr---rrr-rrrrrr-',
        'rrrr----rrrrrrr---rrr----rrr----rrr---rrr--rrrrrr'
      ]]
    });
  } // constructor

} // JetpacLogoEntity
