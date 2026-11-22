import { plugin, rng, shuffled } from "../../packages/game-sdk";
import type {
  Action,
  CandyAttackEvent,
  CandyBoardView,
  CandyPiece,
  CandyPieceType,
  CandyTetrisScene,
  Progress
} from "../../packages/shared/protocol";

const COLS = 10;
const ROWS = 20;
const STEP_MS = 25;
const FEVER_MS = 40_000;
const DAS_MS = 150;
const ARR_MS = 65;
const SOFT_DROP_MS = 55;

const THEMES = ["macaron", "berry", "mint", "peach"] as const;
const PIECE_TYPES: readonly CandyPieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

const SHAPES: Record<CandyPieceType, number[][]> = {
  O: [
    [1, 1],
    [1, 1]
  ],
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0]
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0]
  ]
};

type SoundKind = CandyTetrisScene["lastSound"];

interface InternalPiece {
  type: CandyPieceType;
  shape: number[][];
  x: number;
  y: number;
}

interface InternalBoard {
  id: string;
  side: number;
  grid: string[]; // 长度 COLS * ROWS，'.' 为空
  piece: InternalPiece | null;
  bagCursor: number;
  score: number;
  lines: number;
  combo: number;
  alive: boolean;
  gravityAccMs: number;
  holdDir: -1 | 0 | 1;
  holdElapsedMs: number;
  softDropping: boolean;
  softDropAccMs: number;
  lastLockSeq: number;
  lastLockY: number;
  lastClearSeq: number;
  lastClearCount: number;
  lastClearRows: number[];
  lastGarbageSeq: number;
  lastGarbageCount: number;
}

export interface CandyTetrisState {
  theme: CandyTetrisScene["theme"];
  boards: [InternalBoard, InternalBoard];
  bag: CandyPieceType[];
  rngState: number;
  fever: boolean;
  attackSeq: number;
  lastAttack: CandyAttackEvent | null;
  finished: boolean;
  winnerSide: number | null;
  soundSeq: number;
  lastSound: SoundKind;
  lastElapsed: number;
}

function parseSide(id?: string): number {
  if (!id) return 0;
  return id.startsWith("side-1") ? 1 : 0;
}

function nextRandInt(state: CandyTetrisState, max: number): number {
  state.rngState = (Math.imul(state.rngState, 1_664_525) + 1_013_904_223) >>> 0;
  return Math.floor((state.rngState / 4_294_967_296) * max);
}

/** 公平 7-Bag 共享队列：确保 1v1 双方拿到完全一致的出块序列 */
function ensureBag(state: CandyTetrisState, index: number): CandyPieceType {
  while (state.bag.length <= index + 2) {
    const chunk = shuffled(PIECE_TYPES, max => nextRandInt(state, max));
    state.bag.push(...chunk);
  }
  return state.bag[index];
}

function cloneShape(shape: number[][]): number[][] {
  return shape.map(row => [...row]);
}

function createPiece(type: CandyPieceType): InternalPiece {
  const shape = cloneShape(SHAPES[type]);
  return {
    type,
    shape,
    x: Math.floor((COLS - shape[0].length) / 2),
    y: type === "I" ? -1 : 0
  };
}

function makeBoard(id: string, side: number): InternalBoard {
  return {
    id,
    side,
    grid: new Array<string>(COLS * ROWS).fill("."),
    piece: null,
    bagCursor: 0,
    score: 0,
    lines: 0,
    combo: 0,
    alive: true,
    gravityAccMs: 0,
    holdDir: 0,
    holdElapsedMs: 0,
    softDropping: false,
    softDropAccMs: 0,
    lastLockSeq: 0,
    lastLockY: ROWS - 1,
    lastClearSeq: 0,
    lastClearCount: 0,
    lastClearRows: [],
    lastGarbageSeq: 0,
    lastGarbageCount: 0
  };
}

function recordSound(state: CandyTetrisState, sound: SoundKind) {
  state.soundSeq++;
  state.lastSound = sound;
}

/** 快节奏重力曲线：开局 460ms -> 380ms -> 310ms -> 第 40 秒甜蜜狂热 220ms */
function currentDropInterval(elapsedMs: number): number {
  if (elapsedMs >= FEVER_MS) return 220;
  if (elapsedMs >= 30_000) return 310;
  if (elapsedMs >= 15_000) return 380;
  return 460;
}

function collides(grid: readonly string[], shape: readonly number[][], px: number, py: number): boolean {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gx = px + c;
      const gy = py + r;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && grid[gy * COLS + gx] !== ".") return true;
    }
  }
  return false;
}

function computeGhostY(board: InternalBoard): number {
  if (!board.piece) return 0;
  let gy = board.piece.y;
  while (!collides(board.grid, board.piece.shape, board.piece.x, gy + 1)) {
    gy++;
  }
  return gy;
}

function spawnNextPiece(state: CandyTetrisState, board: InternalBoard) {
  const type = ensureBag(state, board.bagCursor++);
  const piece = createPiece(type);
  if (collides(board.grid, piece.shape, piece.x, piece.y)) {
    board.piece = piece;
    eliminateBoard(state, board);
    return;
  }
  board.piece = piece;
  board.gravityAccMs = 0;
}

function eliminateBoard(state: CandyTetrisState, board: InternalBoard) {
  if (!board.alive) return;
  board.alive = false;
  board.holdDir = 0;
  board.softDropping = false;
  state.finished = true;
  state.winnerSide = board.side === 0 ? 1 : 0;
  recordSound(state, "ko");
}

function moveHorizontal(board: InternalBoard, dx: -1 | 1): boolean {
  if (!board.alive || !board.piece) return false;
  if (collides(board.grid, board.piece.shape, board.piece.x + dx, board.piece.y)) return false;
  board.piece.x += dx;
  return true;
}

/** 顺时针旋转 + 多点踢墙（SRS 简化版） */
function rotatePiece(state: CandyTetrisState, board: InternalBoard): boolean {
  if (!board.alive || !board.piece) return false;
  if (board.piece.type === "O") return false;
  const old = board.piece.shape;
  const rows = old.length;
  const cols = old[0].length;
  const rotated: number[][] = Array.from({ length: cols }, (_, c) =>
    Array.from({ length: rows }, (_, r) => old[rows - 1 - r][c])
  );
  const kicks: readonly [number, number][] = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [-2, 0],
    [2, 0],
    [0, -1]
  ];
  for (const [kx, ky] of kicks) {
    if (!collides(board.grid, rotated, board.piece.x + kx, board.piece.y + ky)) {
      board.piece.shape = rotated;
      board.piece.x += kx;
      board.piece.y += ky;
      recordSound(state, "rotate");
      return true;
    }
  }
  return false;
}

/** 向对手盘面底部顶起焦糖饼干干扰行 */
function applyGarbage(state: CandyTetrisState, target: InternalBoard, count: number) {
  if (!target.alive || count <= 0) return;
  const hole = nextRandInt(state, COLS);
  for (let i = 0; i < count; i++) {
    // 顶部移除一行，底部推入带缺口的焦糖干扰行
    const topHasBlock = target.grid.slice(0, COLS).some(cell => cell !== ".");
    target.grid.splice(0, COLS);
    for (let c = 0; c < COLS; c++) {
      target.grid.push(c === hole ? "." : "X");
    }
    if (topHasBlock && target.piece && collides(target.grid, target.piece.shape, target.piece.x, target.piece.y)) {
      eliminateBoard(state, target);
      return;
    }
  }
  if (target.piece) {
    while (collides(target.grid, target.piece.shape, target.piece.x, target.piece.y) && target.piece.y > -2) {
      target.piece.y--;
    }
    if (collides(target.grid, target.piece.shape, target.piece.x, target.piece.y)) {
      eliminateBoard(state, target);
      return;
    }
  }
  target.lastGarbageSeq++;
  target.lastGarbageCount = count;
}

/** 锁定当前方块、结算消行与连击、发射糖果炮弹 */
function lockPiece(state: CandyTetrisState, board: InternalBoard) {
  if (!board.alive || !board.piece) return;
  const piece = board.piece;
  let maxRow = 0;
  let overflowTop = false;

  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) continue;
      const gx = piece.x + c;
      const gy = piece.y + r;
      if (gy < 0) {
        overflowTop = true;
      } else if (gx >= 0 && gx < COLS && gy < ROWS) {
        board.grid[gy * COLS + gx] = piece.type;
        if (gy > maxRow) maxRow = gy;
      }
    }
  }

  board.lastLockSeq++;
  board.lastLockY = maxRow;

  if (overflowTop) {
    eliminateBoard(state, board);
    return;
  }

  // 检测并消除满行
  const clearedRows: number[] = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    let full = true;
    for (let c = 0; c < COLS; c++) {
      if (board.grid[r * COLS + c] === ".") {
        full = false;
        break;
      }
    }
    if (full) clearedRows.push(r);
  }

  if (clearedRows.length > 0) {
    const remaining: string[] = [];
    const clearedSet = new Set(clearedRows);
    for (let r = 0; r < ROWS; r++) {
      if (!clearedSet.has(r)) {
        for (let c = 0; c < COLS; c++) remaining.push(board.grid[r * COLS + c]);
      }
    }
    const emptyTop = new Array<string>(clearedRows.length * COLS).fill(".");
    board.grid = [...emptyTop, ...remaining];

    board.combo++;
    board.lines += clearedRows.length;
    board.lastClearSeq++;
    board.lastClearCount = clearedRows.length;
    board.lastClearRows = clearedRows;

    const basePoints = [0, 100, 320, 600, 1000][Math.min(4, clearedRows.length)] ?? 1000;
    const feverScale = state.fever ? 1.5 : 1;
    const comboBonus = Math.max(0, board.combo - 1) * 80;
    board.score += Math.round(basePoints * feverScale) + comboBonus;

    // 消 2 行及以上（或连消 >= 2）向敌方发射糖果炮弹！
    let garbage = clearedRows.length === 4 ? 4 : clearedRows.length >= 2 ? clearedRows.length - 1 : 0;
    if (board.combo >= 2) garbage += 1;

    if (garbage > 0) {
      const targetSide = board.side === 0 ? 1 : 0;
      const opponent = state.boards[targetSide];
      state.attackSeq++;
      state.lastAttack = {
        seq: state.attackSeq,
        fromSide: board.side,
        toSide: targetSide,
        amount: garbage,
        atMs: state.lastElapsed
      };
      applyGarbage(state, opponent, garbage);
      recordSound(state, "attack");
    } else {
      recordSound(state, board.combo >= 2 ? "combo" : "clear");
    }
  } else {
    board.combo = 0;
    recordSound(state, "lock");
  }

  if (!state.finished) {
    spawnNextPiece(state, board);
  }
}

function stepDown(state: CandyTetrisState, board: InternalBoard, fromSoftDrop = false): boolean {
  if (!board.alive || !board.piece) return false;
  if (!collides(board.grid, board.piece.shape, board.piece.x, board.piece.y + 1)) {
    board.piece.y++;
    if (fromSoftDrop) board.score += 1;
    board.gravityAccMs = 0;
    return true;
  }
  lockPiece(state, board);
  return false;
}

function hardDrop(state: CandyTetrisState, board: InternalBoard): boolean {
  if (!board.alive || !board.piece) return false;
  let dropped = 0;
  while (!collides(board.grid, board.piece.shape, board.piece.x, board.piece.y + 1)) {
    board.piece.y++;
    dropped++;
  }
  board.score += dropped * 2;
  lockPiece(state, board);
  return true;
}

function stepPhysics(state: CandyTetrisState, dtMs: number) {
  if (state.finished) return;

  if (!state.fever && state.lastElapsed >= FEVER_MS) {
    state.fever = true;
    recordSound(state, "fever");
  }

  const dropInterval = currentDropInterval(state.lastElapsed);

  for (const board of state.boards) {
    if (!board.alive || state.finished) continue;

    // 按住左右键时的 DAS / ARR 丝滑连移
    if (board.holdDir !== 0) {
      board.holdElapsedMs += dtMs;
      while (board.holdElapsedMs >= DAS_MS + ARR_MS) {
        board.holdElapsedMs -= ARR_MS;
        moveHorizontal(board, board.holdDir);
      }
    }

    // 软降加速下落
    if (board.softDropping) {
      board.softDropAccMs += dtMs;
      while (board.softDropAccMs >= SOFT_DROP_MS && board.alive && !state.finished) {
        board.softDropAccMs -= SOFT_DROP_MS;
        stepDown(state, board, true);
      }
    } else {
      board.gravityAccMs += dtMs;
      while (board.gravityAccMs >= dropInterval && board.alive && !state.finished) {
        board.gravityAccMs -= dropInterval;
        stepDown(state, board, false);
      }
    }
  }
}

function advanceTo(state: CandyTetrisState, elapsed: number): boolean {
  const target = Math.max(state.lastElapsed, Math.round(elapsed));
  if (target <= state.lastElapsed) return false;
  if (state.finished) {
    state.lastElapsed = target;
    return false;
  }

  let current = state.lastElapsed;
  while (current < target && !state.finished) {
    const dt = Math.min(STEP_MS, target - current);
    current += dt;
    state.lastElapsed = current;
    stepPhysics(state, dt);
  }
  state.lastElapsed = target;
  return true;
}

function boardToView(state: CandyTetrisState, board: InternalBoard): CandyBoardView {
  const nextType = ensureBag(state, board.bagCursor);
  const pieceView: CandyPiece | null = board.piece
    ? {
        type: board.piece.type,
        shape: cloneShape(board.piece.shape),
        x: board.piece.x,
        y: board.piece.y,
        ghostY: computeGhostY(board)
      }
    : null;
  return {
    id: board.id,
    side: board.side,
    grid: board.grid.join(""),
    piece: pieceView,
    nextType,
    score: board.score,
    lines: board.lines,
    combo: board.combo,
    alive: board.alive,
    lastLockSeq: board.lastLockSeq,
    lastLockY: board.lastLockY,
    lastClearSeq: board.lastClearSeq,
    lastClearCount: board.lastClearCount,
    lastClearRows: [...board.lastClearRows],
    lastGarbageSeq: board.lastGarbageSeq,
    lastGarbageCount: board.lastGarbageCount
  };
}

function toScene(state: CandyTetrisState): CandyTetrisScene {
  return {
    kind: "candy-tetris",
    cols: COLS,
    rows: ROWS,
    theme: state.theme,
    elapsedMs: state.lastElapsed,
    fever: state.fever,
    dropIntervalMs: currentDropInterval(state.lastElapsed),
    boards: [boardToView(state, state.boards[0]), boardToView(state, state.boards[1])],
    scores: [state.boards[0].score, state.boards[1].score],
    lastAttack: state.lastAttack ? { ...state.lastAttack } : null,
    finished: state.finished,
    winnerSide: state.winnerSide,
    soundSeq: state.soundSeq,
    lastSound: state.lastSound
  };
}

export default plugin<CandyTetrisState>({
  init({ seed, tier = 1, playerIds }) {
    const leftId = playerIds.find(id => parseSide(id) === 0) ?? playerIds[0] ?? "side-0#0";
    const rightId = playerIds.find(id => parseSide(id) === 1) ?? "side-1#0";
    const theme = THEMES[Math.max(0, Math.min(THEMES.length - 1, tier - 1))];
    const state: CandyTetrisState = {
      theme,
      boards: [makeBoard(leftId, 0), makeBoard(rightId, 1)],
      bag: [],
      rngState: (seed ^ Math.imul(tier, 0x9e3779b1)) >>> 0,
      fever: false,
      attackSeq: 0,
      lastAttack: null,
      finished: false,
      winnerSide: null,
      soundSeq: 0,
      lastSound: "none",
      lastElapsed: 0
    };
    // 预生成首批 7-Bag 并为双方发出第一块相同的糖果方块
    ensureBag(state, 14);
    spawnNextPiece(state, state.boards[0]);
    spawnNextPiece(state, state.boards[1]);
    return state;
  },
  getState(state) {
    return toScene(state);
  },
  getProgress(state, viewer): Progress {
    const board = state.boards[parseSide(viewer) === 1 ? 1 : 0];
    return {
      value: board.score,
      target: 1500,
      label: `${board.score} 分 · 消 ${board.lines} 行`
    };
  },
  checkWin(state, playerId) {
    return state.finished && state.winnerSide !== null && state.winnerSide === parseSide(playerId);
  },
  isComplete(state) {
    return state.finished;
  },
  clearControls(state, playerId) {
    for (const board of state.boards) {
      if (playerId === undefined || board.id === playerId) {
        board.holdDir = 0;
        board.holdElapsedMs = 0;
        board.softDropping = false;
        board.softDropAccMs = 0;
      }
    }
  },
  tick(state, frame) {
    return advanceTo(state, frame.elapsed);
  },
  handleInput(state, playerId, action: Action, frame) {
    if (state.finished) return false;
    const board = state.boards.find(b => b.id === playerId);
    if (!board || !board.alive) return false;

    const validMove = action.kind === "move";
    const validAction = action.kind === "action" && (
      action.action === "hold-left"
      || action.action === "hold-right"
      || action.action === "duck"
      || action.action === "release"
      || action.action === "rotate"
      || action.action === "hard-drop"
      || action.action === "jump"
      || action.action === "interact"
    );
    if (!validMove && !validAction) return false;

    advanceTo(state, frame.elapsed);
    if (state.finished || !board.alive) return false;

    if (action.kind === "move") {
      if (action.direction === "left") {
        const moved = moveHorizontal(board, -1);
        if (moved) recordSound(state, "move");
        return moved;
      }
      if (action.direction === "right") {
        const moved = moveHorizontal(board, 1);
        if (moved) recordSound(state, "move");
        return moved;
      }
      if (action.direction === "up") return rotatePiece(state, board);
      if (action.direction === "down") return stepDown(state, board, true);
      return false;
    }

    if (action.kind === "action") {
      switch (action.action) {
        case "hold-left":
          board.holdDir = -1;
          board.holdElapsedMs = 0;
          if (moveHorizontal(board, -1)) recordSound(state, "move");
          return true;
        case "hold-right":
          board.holdDir = 1;
          board.holdElapsedMs = 0;
          if (moveHorizontal(board, 1)) recordSound(state, "move");
          return true;
        case "duck":
          board.softDropping = true;
          board.softDropAccMs = 0;
          stepDown(state, board, true);
          return true;
        case "release":
          board.holdDir = 0;
          board.holdElapsedMs = 0;
          board.softDropping = false;
          board.softDropAccMs = 0;
          return true;
        case "rotate":
        case "jump":
          return rotatePiece(state, board);
        case "hard-drop":
        case "interact":
          return hardDrop(state, board);
      }
    }
    return false;
  }
});
