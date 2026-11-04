// begin code

/**
 * Geometry of the Jetpac screen, read out of the original's own code rather
 * than measured off a photograph (sources/docs/screen_layout.md).
 *
 * The screen is the plain ZX Spectrum one: 256x192 pixels, attributes in 8x8
 * cells. Unlike the sibling remakes there is **no separate panel surface**:
 * Jetpac prints the panel into the same video memory it draws the game into
 * ($4021, $402D, $4039 are screen addresses), so the whole 6912 bytes are one
 * picture and ScreenComposer builds all of it.
 *
 * The play area starts at y = $2A: that is the limit the game itself tests
 * ($74A4 `CP $2A`), not a guess about where the panel ends.
 */
export const ScreenLayout = {

  WIDTH: 256,
  HEIGHT: 192,

  CELL: 8,
  COLS: 32,
  ROWS: 24,

  // The panel is character rows 0-1, but the game draws straight into video
  // memory, so these are only for placing things, never for clipping.
  PANEL_ROWS: 2,
  PANEL_HEIGHT: 16,

  // ★ The ceiling of the play area, from the code: $74A4 tests `CP $2A`, so
  // Jetman stops at y = 42 — ten pixels below the panel, not right under it.
  PLAY_TOP: 0x2A,
  // the floor: the ground platform is at y = $B8 (sprites.json, platforms[1])
  FLOOR_Y: 0xB8,

  // Attribute bytes, from $71C6 and $6096 (screen_layout.md chap. 4).
  ATTR_SCREEN: 0x47,       // bright white on black — the whole screen
  ATTR_SCORE_ROW: 0x46,    // bright yellow on black — character row 1

  // ★ **A deliberate departure, and the only one on the screen** (ZADANI §10).
  // The video memory stays byte for byte the original's — every `match*` tool
  // still passes — but the picture is painted through ZXVideoRAM's ink plane,
  // which remembers at pixel resolution which entity lit which pixel. So two
  // things of different colours in one 8x8 cell both keep theirs instead of
  // the later one taking the cell.
  //
  // Set it false and the ULA's own rule is back, clash and all. Nothing else
  // in the remake changes either way.
  TRUE_COLOUR: true,

  // 50.08 Hz — 69888 T states per frame on a 3.5 MHz Z80 (hw_notes.md).
  //
  // ★ The original is not tied to the frame at all, and it has **two rounds**
  // (disasm_notes.md chap. 3b): the short one — Jetman, his shots, the sound —
  // runs once a frame, and the long one — the rocket, the items, the
  // creatures — **0.568 times a frame**, more on an empty screen and less on
  // a busy one. The remake ticks at this rate and gives the long round that
  // measured average (gameWorker.js), so Jetman is exact and the world is
  // right on average but does not slow down when the screen fills up.
  FRAME_RATE: 3500000/69888

}; // ScreenLayout
