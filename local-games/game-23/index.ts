import { plugin, rng } from "../../packages/game-sdk";
import type {
  Action,
  BombermanBomb,
  BombermanFlame,
  BombermanMode,
  BombermanPlayer,
  BombermanPowerup,
  BombermanPowerupKind,
  BombermanScene,
  Direction,
  Progress
} from "../../packages/shared/protocol";

const COLS = 13;
const ROWS = 11;
const STEP_MS = 25;
const BOMB_FUSE_MS = 2_000;
const FLAME_TTL_MS = 450;
const SHRINK_START_MS = 35_000;
const SHRINK_INTERVAL_MS = 280;
const PULSE_MS = 180;

const BASE_SPEED = 3.45;
const SPEED_STEP = 0.55;
const MAX_SPEED_LEVEL = 3;
const MAX_FLAME_RANGE = 5;
const MAX_BOMBS = 4;
const PLAYER_HALF = 0.34;
const CORNER_SNAP = 0.44;
const POWERUP_DROP_RATE = 0.38;

type TileChar = "#" | "B" | "S" | ".";
type SoundEvent = BombermanScene["lastEvent"];

interface InternalPlayer extends BombermanPlayer {
  holdDir: Direction | null;
  pulseDir: Direction | null;
  pulseUntil: number;
  aiThinkAt: number;
}

interface InternalBomb extends BombermanBomb {
  ownerId: string;
  passIds: string[];
}

interface InternalFlame extends BombermanFlame {
  ownerId: string;
}

export interface BombermanState {
  mode: BombermanMode;
  cols: number;
  rows: number;
  tiles: TileChar[];
  players: InternalPlayer[];
  bombs: InternalBomb[];
  flames: InternalFlame[];
  powerups: BombermanPowerup[];
  nextBombId: number;
  shrinkStep: number;
  finished: boolean;
  winnerSide: number | null;
  eventSeq: number;
  lastEvent: SoundEvent;
  lastElapsed: number;
  rngState: number;
}

/** 保留两位小数并消除 -0，确保序列化与反序列化严格一致 */
function round2(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** 从槽位或观察者 ID 中解析阵营编号（0..3） */
function parseSide(id?: string): number {
  if (!id) return 0;
  const match = id.match(/^side-(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** 预生成从外圈向中心的顺时针螺旋落墙路径（覆盖全部内部 11x9 区域） */
function buildSpiralOrder(): { col: number; row: number }[] {
  const order: { col: number; row: number }[] = [];
  let left = 1;
  let right = COLS - 2;
  let top = 1;
  let bottom = ROWS - 2;
  while (left <= right && top <= bottom) {
    for (let c = left; c <= right; c++) order.push({ col: c, row: top });
    top++;
    for (let r = top; r <= bottom; r++) order.push({ col: right, row: r });
    right--;
    if (top <= bottom) {
      for (let c = right; c >= left; c--) order.push({ col: c, row: bottom });
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) order.push({ col: left, row: r });
      left++;
    }
  }
  return order;
}

const SPIRAL_ORDER = buildSpiralOrder();

const CORNER_SPAWNS: readonly { col: number; row: number; dir: Direction }[] = [
  { col: 1, row: 1, dir: "right" },
  { col: COLS - 2, row: 1, dir: "left" },
  { col: 1, row: ROWS - 2, dir: "right" },
  { col: COLS - 2, row: ROWS - 2, dir: "left" }
];

/** 确定性线性同余随机数（可随状态序列化，断点续传仍保持完全一致） */
function nextRand(state: BombermanState): number {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return state.rngState / 0x1_0000_0000;
}

function tileIndex(col: number, row: number) {
  return row * COLS + col;
}

function inBounds(col: number, row: number) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function isCornerSafe(col: number, row: number) {
  const nearLeft = col <= 2;
  const nearRight = col >= COLS - 3;
  const nearTop = row <= 2;
  const nearBottom = row >= ROWS - 3;
  const inCornerBox = (nearLeft || nearRight) && (nearTop || nearBottom);
  if (!inCornerBox) return false;
  // 四个角落的 3 格 L 形出生通道必须完全畅通
  return (col === 1 || col === COLS - 2 || row === 1 || row === ROWS - 2);
}

/** 生成四方向镜面对称的霓虹几何迷宫，并按关卡难度调节软砖密度 */
function buildSymmetricMap(seed: number, tier = 1): TileChar[] {
  const tiles: TileChar[] = new Array(COLS * ROWS).fill(".");
  const rand = rng((seed ^ Math.imul(tier, 0x45d9f3)) >>> 0);
  const brickChance = 54 + Math.min(4, Math.max(1, tier)) * 6;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c === 0 || c === COLS - 1 || r === 0 || r === ROWS - 1 || (c % 2 === 0 && r % 2 === 0)) {
        tiles[tileIndex(c, r)] = "#";
      }
    }
  }

  const halfCols = Math.ceil(COLS / 2);
  const halfRows = Math.ceil(ROWS / 2);
  for (let r = 1; r < halfRows; r++) {
    for (let c = 1; c < halfCols; c++) {
      if (tiles[tileIndex(c, r)] !== ".") continue;
      if (isCornerSafe(c, r)) continue;
      // 保留正中心小十字，便于前期向中路争夺
      if ((c === 6 && r === 5) || (c === 5 && r === 5)) continue;
      if (rand(100) < brickChance) {
        const coords = [
          [c, r],
          [COLS - 1 - c, r],
          [c, ROWS - 1 - r],
          [COLS - 1 - c, ROWS - 1 - r]
        ];
        for (const [mc, mr] of coords) {
          if (tiles[tileIndex(mc, mr)] === "." && !isCornerSafe(mc, mr)) {
            tiles[tileIndex(mc, mr)] = "B";
          }
        }
      }
    }
  }
  return tiles;
}

function makePlayer(id: string, side: number, slot: number, isBot: boolean): InternalPlayer {
  const spawn = CORNER_SPAWNS[slot % CORNER_SPAWNS.length];
  return {
    id,
    side,
    slot,
    ...(isBot ? { isBot: true } : {}),
    x: spawn.col + 0.5,
    y: spawn.row + 0.5,
    dir: spawn.dir,
    alive: true,
    maxBombs: 1,
    activeBombs: 0,
    flameRange: 2,
    speedLevel: 0,
    kills: 0,
    bricks: 0,
    holdDir: null,
    pulseDir: null,
    pulseUntil: 0,
    aiThinkAt: 200 + slot * 75
  };
}

/**
 * 构建四人开局队列（彻底取消 1v1）：
 * - 4 名真人按传入阵营区分 2v2（2 阵营各 2 人）或 1v1v1v1（4 阵营各 1 人）
 * - 练习房仅传 2 名真人时，按 seed 奇偶自动补 2 个 AI 组成完整四角 2v2 或 1v1v1v1
 */
function buildInitialPlayers(playerIds: readonly string[], seed: number): { mode: BombermanMode; players: InternalPlayer[] } {
  const uniqueIds = [...new Set(playerIds)];
  const parsed = uniqueIds.map(id => ({ id, side: parseSide(id) }));
  const uniqueSides = new Set(parsed.map(item => item.side));

  if (parsed.length >= 4 && uniqueSides.size >= 3) {
    // 1v1v1v1 四人混战：按阵营 0, 1, 2, 3 分落四角
    const sorted = [...parsed].sort((a, b) => a.side - b.side).slice(0, 4);
    return {
      mode: "1v1v1v1",
      players: sorted.map((item, slot) => makePlayer(item.id, item.side, slot, false))
    };
  }

  if (parsed.length >= 4) {
    // 2v2 团队战：蓝队（side 0）左上+左下，橙队（side 1）右上+右下
    const side0 = parsed.filter(item => item.side === 0).slice(0, 2);
    const side1 = parsed.filter(item => item.side !== 0).slice(0, 2);
    const players: InternalPlayer[] = [];
    if (side0[0]) players.push(makePlayer(side0[0].id, 0, 0, false));
    if (side1[0]) players.push(makePlayer(side1[0].id, 1, 1, false));
    if (side0[1]) players.push(makePlayer(side0[1].id, 0, 2, false));
    if (side1[1]) players.push(makePlayer(side1[1].id, 1, 3, false));
    return { mode: "2v2", players };
  }

  // 练习房 2 人联机试玩：自动用 2 名 AI 补足 4 角，绝不退化为 1v1
  const p0 = parsed.find(item => item.side === 0)?.id ?? "side-0#0";
  const p1 = parsed.find(item => item.side === 1)?.id ?? "side-1#0";
  const isFfa4 = (seed & 1) === 1;
  if (isFfa4) {
    return {
      mode: "1v1v1v1",
      players: [
        makePlayer(p0, 0, 0, false),
        makePlayer(p1, 1, 1, false),
        makePlayer("bot-side-2#0", 2, 2, true),
        makePlayer("bot-side-3#0", 3, 3, true)
      ]
    };
  }
  return {
    mode: "2v2",
    players: [
      makePlayer(p0, 0, 0, false),
      makePlayer(p1, 1, 1, false),
      makePlayer("bot-side-0#1", 0, 2, true),
      makePlayer("bot-side-1#1", 1, 3, true)
    ]
  };
}

function recordEvent(state: BombermanState, event: SoundEvent) {
  state.eventSeq++;
  state.lastEvent = event;
}

function isTileBlockedForPlayer(state: BombermanState, player: InternalPlayer, col: number, row: number): boolean {
  if (!inBounds(col, row)) return true;
  const tile = state.tiles[tileIndex(col, row)];
  if (tile !== ".") return true;
  const bomb = state.bombs.find(b => b.col === col && b.row === row);
  if (!bomb) return false;
  return !bomb.passIds.includes(player.id);
}

function rectBlocked(state: BombermanState, player: InternalPlayer, cx: number, cy: number): boolean {
  const minCol = Math.floor(cx - PLAYER_HALF);
  const maxCol = Math.floor(cx + PLAYER_HALF);
  const minRow = Math.floor(cy - PLAYER_HALF);
  const maxRow = Math.floor(cy + PLAYER_HALF);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (isTileBlockedForPlayer(state, player, c, r)) return true;
    }
  }
  return false;
}

function overlapsCell(player: InternalPlayer, col: number, row: number): boolean {
  return (
    player.x + PLAYER_HALF > col &&
    player.x - PLAYER_HALF < col + 1 &&
    player.y + PLAYER_HALF > row &&
    player.y - PLAYER_HALF < row + 1
  );
}

/** 更新刚放置炸弹的穿透许可列表：角色离开该格后立即变为实体阻挡 */
function updateBombPassThrough(state: BombermanState) {
  for (const bomb of state.bombs) {
    if (!bomb.passIds.length) continue;
    bomb.passIds = bomb.passIds.filter(pid => {
      const player = state.players.find(p => p.id === pid && p.alive);
      return player ? overlapsCell(player, bomb.col, bomb.row) : false;
    });
  }
}

/** 带拐角辅助滑入的角色移动，避免擦到立柱边缘卡死 */
function movePlayer(state: BombermanState, player: InternalPlayer, dir: Direction, dt: number) {
  player.dir = dir;
  const speed = BASE_SPEED + player.speedLevel * SPEED_STEP;
  const dist = speed * dt;
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;

  let nx = player.x + dx * dist;
  let ny = player.y + dy * dist;

  if (!rectBlocked(state, player, nx, ny)) {
    player.x = nx;
    player.y = ny;
    return;
  }

  // 拐角辅助：向最近整数通道中心微调对齐
  if (dx !== 0) {
    const centerRow = Math.floor(player.y);
    const targetY = centerRow + 0.5;
    const diff = targetY - player.y;
    const aheadCol = dx > 0 ? Math.floor(player.x + PLAYER_HALF + dist) : Math.floor(player.x - PLAYER_HALF - dist);
    if (Math.abs(diff) > 0.01 && Math.abs(diff) <= CORNER_SNAP && !isTileBlockedForPlayer(state, player, aheadCol, centerRow)) {
      const shift = Math.sign(diff) * Math.min(Math.abs(diff), dist * 1.15);
      const tryY = player.y + shift;
      if (!rectBlocked(state, player, player.x, tryY)) {
        player.y = tryY;
        if (!rectBlocked(state, player, nx, player.y)) player.x = nx;
        return;
      }
    }
    // 贴紧前方面墙
    const col = Math.floor(player.x);
    player.x = dx > 0 ? Math.min(nx, col + 1 - PLAYER_HALF - 0.001) : Math.max(nx, col + PLAYER_HALF + 0.001);
  } else if (dy !== 0) {
    const centerCol = Math.floor(player.x);
    const targetX = centerCol + 0.5;
    const diff = targetX - player.x;
    const aheadRow = dy > 0 ? Math.floor(player.y + PLAYER_HALF + dist) : Math.floor(player.y - PLAYER_HALF - dist);
    if (Math.abs(diff) > 0.01 && Math.abs(diff) <= CORNER_SNAP && !isTileBlockedForPlayer(state, player, centerCol, aheadRow)) {
      const shift = Math.sign(diff) * Math.min(Math.abs(diff), dist * 1.15);
      const tryX = player.x + shift;
      if (!rectBlocked(state, player, tryX, player.y)) {
        player.x = tryX;
        if (!rectBlocked(state, player, player.x, ny)) player.y = ny;
        return;
      }
    }
    const row = Math.floor(player.y);
    player.y = dy > 0 ? Math.min(ny, row + 1 - PLAYER_HALF - 0.001) : Math.max(ny, row + PLAYER_HALF + 0.001);
  }
}

/** 放置炸弹 */
function placeBomb(state: BombermanState, player: InternalPlayer): boolean {
  if (!player.alive) return false;
  if (player.activeBombs >= player.maxBombs) return false;
  const col = Math.floor(player.x);
  const row = Math.floor(player.y);
  if (!inBounds(col, row) || state.tiles[tileIndex(col, row)] !== ".") return false;
  if (state.bombs.some(b => b.col === col && b.row === row)) return false;

  const passIds = state.players.filter(p => p.alive && overlapsCell(p, col, row)).map(p => p.id);
  state.bombs.push({
    id: state.nextBombId++,
    col,
    row,
    ownerId: player.id,
    ownerSide: player.side,
    range: player.flameRange,
    fuseLeftMs: BOMB_FUSE_MS,
    passIds
  });
  player.activeBombs++;
  recordEvent(state, "bomb");
  return true;
}

function addFlame(state: BombermanState, col: number, row: number, ownerId: string, ownerSide: number, kind: BombermanFlame["kind"]) {
  state.flames.push({ col, row, ownerId, ownerSide, ttlMs: FLAME_TTL_MS, kind });
}

function maybeSpawnPowerup(state: BombermanState, col: number, row: number) {
  if (nextRand(state) > POWERUP_DROP_RATE) return;
  const roll = nextRand(state);
  const kind: BombermanPowerupKind = roll < 0.36 ? "flame" : roll < 0.72 ? "bomb" : "speed";
  state.powerups.push({ col, row, kind });
}

/** 引爆炸弹并支持十字连锁引爆 */
function detonateBomb(state: BombermanState, initialBomb: InternalBomb) {
  const queue: InternalBomb[] = [initialBomb];
  const processed = new Set<number>();

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (processed.has(bomb.id)) continue;
    processed.add(bomb.id);

    const idx = state.bombs.findIndex(b => b.id === bomb.id);
    if (idx >= 0) state.bombs.splice(idx, 1);

    const owner = state.players.find(p => p.id === bomb.ownerId);
    if (owner && owner.activeBombs > 0) owner.activeBombs--;

    addFlame(state, bomb.col, bomb.row, bomb.ownerId, bomb.ownerSide, "center");

    const dirs: readonly [number, number, "h" | "v"][] = [
      [1, 0, "h"],
      [-1, 0, "h"],
      [0, 1, "v"],
      [0, -1, "v"]
    ];
    for (const [dc, dr, kind] of dirs) {
      for (let step = 1; step <= bomb.range; step++) {
        const c = bomb.col + dc * step;
        const r = bomb.row + dr * step;
        if (!inBounds(c, r)) break;
        const tile = state.tiles[tileIndex(c, r)];
        if (tile === "#" || tile === "S") break;
        if (tile === "B") {
          state.tiles[tileIndex(c, r)] = ".";
          if (owner) owner.bricks++;
          addFlame(state, c, r, bomb.ownerId, bomb.ownerSide, kind);
          maybeSpawnPowerup(state, c, r);
          break;
        }
        // 烧毁未拾取的地面道具
        const puIdx = state.powerups.findIndex(p => p.col === c && p.row === r);
        if (puIdx >= 0) state.powerups.splice(puIdx, 1);

        addFlame(state, c, r, bomb.ownerId, bomb.ownerSide, kind);

        // 连锁引爆路径上的其他炸弹
        const chained = state.bombs.find(b => b.col === c && b.row === r && !processed.has(b.id));
        if (chained) {
          queue.push(chained);
          break;
        }
      }
    }
  }
  recordEvent(state, "explode");
}

function checkPowerupPickups(state: BombermanState) {
  for (const player of state.players) {
    if (!player.alive) continue;
    const col = Math.floor(player.x);
    const row = Math.floor(player.y);
    const idx = state.powerups.findIndex(p => p.col === col && p.row === row);
    if (idx < 0) continue;
    const powerup = state.powerups.splice(idx, 1)[0];
    if (powerup.kind === "flame") player.flameRange = Math.min(MAX_FLAME_RANGE, player.flameRange + 1);
    else if (powerup.kind === "bomb") player.maxBombs = Math.min(MAX_BOMBS, player.maxBombs + 1);
    else if (powerup.kind === "speed") player.speedLevel = Math.min(MAX_SPEED_LEVEL, player.speedLevel + 1);
    recordEvent(state, "powerup");
  }
}

/** 火焰伤害判定：2v2 模式下队友火焰严格不互伤 */
function applyFlameHits(state: BombermanState) {
  let eliminated = false;
  for (const player of state.players) {
    if (!player.alive) continue;
    for (const flame of state.flames) {
      if (!overlapsCell(player, flame.col, flame.row)) continue;
      // 2v2 队友不互伤（自己炸自己仍会淘汰，保持博弈乐趣）
      if (state.mode === "2v2" && flame.ownerSide === player.side && flame.ownerId !== player.id) continue;
      player.alive = false;
      player.holdDir = null;
      player.pulseDir = null;
      if (flame.ownerSide !== player.side) {
        const killer = state.players.find(p => p.id === flame.ownerId);
        if (killer) killer.kills++;
      }
      eliminated = true;
      break;
    }
  }
  if (eliminated) {
    recordEvent(state, "ko");
    evaluateVictory(state);
  }
}

/** 第 35 秒起沿顺时针螺旋落下不可破坏的高能死墙 */
function advanceShrinkWalls(state: BombermanState) {
  if (state.lastElapsed < SHRINK_START_MS) return;
  const targetStep = Math.min(
    SPIRAL_ORDER.length - 1,
    Math.floor((state.lastElapsed - SHRINK_START_MS) / SHRINK_INTERVAL_MS) + 1
  );
  if (targetStep <= state.shrinkStep) return;

  let crushedAny = false;
  while (state.shrinkStep < targetStep) {
    const cell = SPIRAL_ORDER[state.shrinkStep];
    state.shrinkStep++;
    const idx = tileIndex(cell.col, cell.row);
    state.tiles[idx] = "S";

    // 清除落墙格上的道具与未爆炸弹
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      if (state.powerups[i].col === cell.col && state.powerups[i].row === cell.row) state.powerups.splice(i, 1);
    }
    for (let i = state.bombs.length - 1; i >= 0; i--) {
      const b = state.bombs[i];
      if (b.col === cell.col && b.row === cell.row) {
        const owner = state.players.find(p => p.id === b.ownerId);
        if (owner && owner.activeBombs > 0) owner.activeBombs--;
        state.bombs.splice(i, 1);
      }
    }
    // 淘汰未能及时撤离的角色
    for (const player of state.players) {
      if (player.alive && overlapsCell(player, cell.col, cell.row)) {
        player.alive = false;
        player.holdDir = null;
        player.pulseDir = null;
        crushedAny = true;
      }
    }
  }
  recordEvent(state, crushedAny ? "ko" : "shrink");
  if (crushedAny) evaluateVictory(state);
}

/** 胜负判定：只剩唯一存活阵营时立即提前结束 */
function evaluateVictory(state: BombermanState) {
  if (state.finished) return;
  const aliveSides = [...new Set(state.players.filter(p => p.alive).map(p => p.side))];
  if (aliveSides.length === 1) {
    state.finished = true;
    state.winnerSide = aliveSides[0];
  } else if (aliveSides.length === 0) {
    state.finished = true;
    state.winnerSide = null;
  }
}

/** 计算当前危险格集合（正在燃烧、即将爆炸的十字波及范围、即将落墙预警格） */
function computeDangerCells(state: BombermanState): Set<number> {
  const danger = new Set<number>();
  for (const flame of state.flames) danger.add(tileIndex(flame.col, flame.row));
  for (const bomb of state.bombs) {
    danger.add(tileIndex(bomb.col, bomb.row));
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let step = 1; step <= bomb.range; step++) {
        const c = bomb.col + dc * step;
        const r = bomb.row + dr * step;
        if (!inBounds(c, r)) break;
        const tile = state.tiles[tileIndex(c, r)];
        if (tile === "#" || tile === "S") break;
        danger.add(tileIndex(c, r));
        if (tile === "B") break;
      }
    }
  }
  if (state.lastElapsed >= SHRINK_START_MS - 1_200 && state.shrinkStep < SPIRAL_ORDER.length - 1) {
    for (let look = 0; look < 3 && state.shrinkStep + look < SPIRAL_ORDER.length - 1; look++) {
      const cell = SPIRAL_ORDER[state.shrinkStep + look];
      danger.add(tileIndex(cell.col, cell.row));
    }
  }
  return danger;
}

/** 轻量确定性 AI（仅在练习房 2 人联机补位 2 名机器人时执行） */
function updateBot(state: BombermanState, bot: InternalPlayer) {
  if (!bot.alive || !bot.isBot) return;
  if (state.lastElapsed < bot.aiThinkAt) return;
  bot.aiThinkAt = state.lastElapsed + 160;

  const col = Math.floor(bot.x);
  const row = Math.floor(bot.y);
  const danger = computeDangerCells(state);
  const dirs: readonly [Direction, number, number][] = [
    ["up", 0, -1],
    ["down", 0, 1],
    ["left", -1, 0],
    ["right", 1, 0]
  ];

  // 1. 若脚下危险，立即向安全邻格撤离（简单 BFS 最多看 4 步）
  if (danger.has(tileIndex(col, row))) {
    const queue: { c: number; r: number; firstDir: Direction | null; depth: number }[] = [{ c: col, r: row, firstDir: null, depth: 0 }];
    const visited = new Set<number>([tileIndex(col, row)]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.firstDir && !danger.has(tileIndex(cur.c, cur.r))) {
        bot.holdDir = cur.firstDir;
        return;
      }
      if (cur.depth >= 4) continue;
      for (const [d, dc, dr] of dirs) {
        const nc = cur.c + dc;
        const nr = cur.r + dr;
        const nIdx = tileIndex(nc, nr);
        if (visited.has(nIdx) || isTileBlockedForPlayer(state, bot, nc, nr)) continue;
        visited.add(nIdx);
        queue.push({ c: nc, r: nr, firstDir: cur.firstDir ?? d, depth: cur.depth + 1 });
      }
    }
  }

  // 2. 检查周围是否紧邻软砖或敌人，若存在安全撤离路线则放炸弹
  const nearTarget = dirs.some(([, dc, dr]) => {
    const nc = col + dc;
    const nr = row + dr;
    if (!inBounds(nc, nr)) return false;
    if (state.tiles[tileIndex(nc, nr)] === "B") return true;
    return state.players.some(p =>
      p.alive && p.id !== bot.id && (state.mode === "1v1v1v1" || p.side !== bot.side)
      && Math.abs(Math.floor(p.x) - col) + Math.abs(Math.floor(p.y) - row) <= 2
    );
  });

  if (nearTarget && bot.activeBombs < bot.maxBombs) {
    // 确认至少有 2 个相邻或转角安全格可躲避
    const escape = dirs.find(([, dc, dr]) => {
      const nc = col + dc;
      const nr = row + dr;
      return !isTileBlockedForPlayer(state, bot, nc, nr) && !danger.has(tileIndex(nc, nr));
    });
    if (escape && nextRand(state) < 0.7) {
      placeBomb(state, bot);
      bot.holdDir = escape[0];
      return;
    }
  }

  // 3. 向中心或道具/安全空地移动
  const safeMoves = dirs.filter(([, dc, dr]) => {
    const nc = col + dc;
    const nr = row + dr;
    return !isTileBlockedForPlayer(state, bot, nc, nr) && !danger.has(tileIndex(nc, nr));
  });
  if (!safeMoves.length) {
    bot.holdDir = null;
    return;
  }

  // 优先靠向中心（尤其缩圈阶段）或临近道具
  safeMoves.sort((a, b) => {
    const ac = col + a[1], ar = row + a[2];
    const bc = col + b[1], br = row + b[2];
    const aPu = state.powerups.some(p => p.col === ac && p.row === ar) ? -10 : 0;
    const bPu = state.powerups.some(p => p.col === bc && p.row === br) ? -10 : 0;
    const aDist = Math.abs(ac - 6) + Math.abs(ar - 5) + aPu;
    const bDist = Math.abs(bc - 6) + Math.abs(br - 5) + bPu;
    return aDist - bDist;
  });

  const pick = nextRand(state) < 0.72 ? safeMoves[0] : safeMoves[Math.floor(nextRand(state) * safeMoves.length)];
  bot.holdDir = pick[0];
}

function stepPhysics(state: BombermanState, dtMs: number) {
  if (state.finished) return;
  const dt = dtMs / 1000;

  // 1. 机器人决策与玩家移动
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.isBot) updateBot(state, player);
    const activeDir = player.holdDir ?? (state.lastElapsed < player.pulseUntil ? player.pulseDir : null);
    if (activeDir) movePlayer(state, player, activeDir, dt);
  }

  // 2. 更新炸弹穿透许可与道具拾取
  updateBombPassThrough(state);
  checkPowerupPickups(state);

  // 3. 推进火焰残余时长
  for (let i = state.flames.length - 1; i >= 0; i--) {
    state.flames[i].ttlMs -= dtMs;
    if (state.flames[i].ttlMs <= 0) state.flames.splice(i, 1);
  }

  // 4. 推进炸弹引信并引爆到期炸弹
  const readyToExplode: InternalBomb[] = [];
  for (const bomb of state.bombs) {
    bomb.fuseLeftMs -= dtMs;
    if (bomb.fuseLeftMs <= 0) readyToExplode.push(bomb);
  }
  for (const bomb of readyToExplode) {
    if (state.bombs.some(b => b.id === bomb.id)) detonateBomb(state, bomb);
  }

  // 5. 火焰伤害判定
  if (state.flames.length > 0) applyFlameHits(state);

  // 6. 第 35 秒起螺旋落墙缩圈
  if (!state.finished) advanceShrinkWalls(state);
}

function advanceTo(state: BombermanState, elapsed: number): boolean {
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

function nextShrinkInfo(state: BombermanState): BombermanScene["nextShrink"] {
  if (state.shrinkStep >= SPIRAL_ORDER.length - 1) return null;
  if (state.lastElapsed < SHRINK_START_MS - 1_500) return null;
  const cell = SPIRAL_ORDER[state.shrinkStep];
  if (state.lastElapsed < SHRINK_START_MS) {
    const warnRatio = round2(Math.max(0, Math.min(1, 1 - (SHRINK_START_MS - state.lastElapsed) / 1_500)));
    return { col: cell.col, row: cell.row, warnRatio };
  }
  const nextAt = SHRINK_START_MS + state.shrinkStep * SHRINK_INTERVAL_MS;
  const remaining = Math.max(0, nextAt - state.lastElapsed);
  const warnRatio = round2(Math.max(0, Math.min(1, 1 - remaining / SHRINK_INTERVAL_MS)));
  return { col: cell.col, row: cell.row, warnRatio };
}

function sideProgress(state: BombermanState, side: number): Progress {
  const members = state.players.filter(p => p.side === side);
  const alive = members.filter(p => p.alive).length;
  const kills = members.reduce((sum, p) => sum + p.kills, 0);
  const bricks = members.reduce((sum, p) => sum + p.bricks, 0);
  const score = alive * 100 + kills * 15 + bricks;
  return {
    value: score,
    target: members.length * 100,
    label: `存活 ${alive} · 擊殺 ${kills}`
  };
}

function toScene(state: BombermanState): BombermanScene {
  return {
    kind: "bomberman",
    mode: state.mode,
    cols: state.cols,
    rows: state.rows,
    tiles: state.tiles.join(""),
    elapsedMs: state.lastElapsed,
    shrinkStartMs: SHRINK_START_MS,
    shrinkStep: state.shrinkStep,
    nextShrink: nextShrinkInfo(state),
    players: state.players.map(p => ({
      id: p.id,
      side: p.side,
      slot: p.slot,
      ...(p.isBot ? { isBot: true } : {}),
      x: round2(p.x),
      y: round2(p.y),
      dir: p.dir,
      alive: p.alive,
      maxBombs: p.maxBombs,
      activeBombs: p.activeBombs,
      flameRange: p.flameRange,
      speedLevel: p.speedLevel,
      kills: p.kills,
      bricks: p.bricks
    })),
    bombs: state.bombs.map(b => ({
      id: b.id,
      col: b.col,
      row: b.row,
      ownerSide: b.ownerSide,
      range: b.range,
      fuseLeftMs: Math.max(0, Math.round(b.fuseLeftMs))
    })),
    flames: state.flames.map(f => ({
      col: f.col,
      row: f.row,
      ownerSide: f.ownerSide,
      ttlMs: Math.max(0, Math.round(f.ttlMs)),
      kind: f.kind
    })),
    powerups: state.powerups.map(pu => ({ ...pu })),
    finished: state.finished,
    winnerSide: state.winnerSide,
    eventSeq: state.eventSeq,
    lastEvent: state.lastEvent
  };
}

export default plugin<BombermanState>({
  init({ seed, playerIds, tier }) {
    const { mode, players } = buildInitialPlayers(playerIds, seed);
    return {
      mode,
      cols: COLS,
      rows: ROWS,
      tiles: buildSymmetricMap(seed, tier ?? 1),
      players,
      bombs: [],
      flames: [],
      powerups: [],
      nextBombId: 1,
      shrinkStep: 0,
      finished: false,
      winnerSide: null,
      eventSeq: 0,
      lastEvent: "none",
      lastElapsed: 0,
      rngState: (seed ^ 0x9e3779b9) >>> 0
    };
  },
  getState(state) {
    return toScene(state);
  },
  getProgress(state, viewer) {
    return sideProgress(state, parseSide(viewer));
  },
  checkWin(state, playerId) {
    return state.finished && state.winnerSide !== null && state.winnerSide === parseSide(playerId);
  },
  isComplete(state) {
    return state.finished;
  },
  clearControls(state, playerId) {
    for (const player of state.players) {
      if (player.isBot) continue;
      if (playerId === undefined || player.id === playerId) {
        player.holdDir = null;
        player.pulseDir = null;
        player.pulseUntil = 0;
      }
    }
  },
  tick(state, frame) {
    return advanceTo(state, frame.elapsed);
  },
  handleInput(state, playerId, action: Action, frame) {
    if (state.finished) return false;
    const player = state.players.find(p => p.id === playerId && !p.isBot);
    if (!player || !player.alive) return false;

    // 先校验输入合法性，避免无效协议输入错误推进物理时钟
    const validMove = action.kind === "move";
    const validAction = action.kind === "action" && (
      action.action === "hold-up"
      || action.action === "hold-down"
      || action.action === "hold-left"
      || action.action === "hold-right"
      || action.action === "release"
      || action.action === "bomb"
      || action.action === "interact"
    );
    if (!validMove && !validAction) return false;

    advanceTo(state, frame.elapsed);
    if (state.finished || !player.alive) return false;

    if (action.kind === "move") {
      player.pulseDir = action.direction;
      player.pulseUntil = state.lastElapsed + PULSE_MS;
      return true;
    }

    if (action.kind === "action") {
      switch (action.action) {
        case "hold-up":
          player.holdDir = "up";
          return true;
        case "hold-down":
          player.holdDir = "down";
          return true;
        case "hold-left":
          player.holdDir = "left";
          return true;
        case "hold-right":
          player.holdDir = "right";
          return true;
        case "release":
          player.holdDir = null;
          player.pulseDir = null;
          player.pulseUntil = 0;
          return true;
        case "bomb":
        case "interact":
          return placeBomb(state, player);
      }
    }
    return false;
  }
});
