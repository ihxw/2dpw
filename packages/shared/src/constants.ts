/** Network / timing constants shared by client and server. */
export const SERVER_PORT = 7788;
export const WS_PATH = '/ws';
export const PROTOCOL_VERSION = 1;

/** Logic tick rate of the server (Hz). */
export const TICK_RATE = 20;

/**
 * Grid geometry. One logical cell == one isometric tile (2:1 diamond).
 * Source art (Flare) is authored at 192x96 per tile.
 */
export const TILE_W = 192;
export const TILE_H = 96;

/** Mir-style step timing (ms). Walk = 1 cell, run = 2 cells, per step. */
export const WALK_STEP_MS = 600;
export const RUN_STEP_MS = 600;
