import { plugin, rng } from "../../packages/game-sdk";
import type { Action, Progress, VolleyballPlayer, VolleyballScene } from "../../packages/shared/protocol";

const WIDTH = 1200;
const HEIGHT = 600;
const NET_WIDTH = 20;
const NET_HEIGHT = 116;
const BALL_RADIUS = 24;
const SINGLE_RADIUS = 56;
const DOUBLES_RADIUS = 48;

const GRAVITY = 2500;
const PLAYER_SPEED = 740;
const PLAYER_JUMP = 840;
const BOUNCE = 0.96;
const BOUNCE_NET = 0.8;
const MOMENTUM_TRANSFER = 0.22;
const BALL_MIN_HIT_SPEED = 600;
const BALL_MAX_VX = 960;
const BALL_MAX_VY = 1050;
const FREEZE_MS = 650;
const SUB_STEP_MS = 10;
const PULSE_MS = 220;
const JUMP_BUFFER_MS = 140;

const THEMES = ["sunset", "lagoon", "aurora", "arena"] as const;
const SCORE_TARGETS = [11, 13, 15, 17] as const;

interface InternalPlayer extends VolleyballPlayer {
  holdDir: -1 | 0 | 1;
  pulseDir: -1 | 0 | 1;
  pulseUntil: number;
  jumpBufferUntil: number;
}

export interface VolleyballState {
  theme: VolleyballScene["theme"];
  scoreTarget: number;
  scores: [number, number];
  players: InternalPlayer[];
  ball: VolleyballScene["ball"];
  serveOffset: number;
  frozenUntil: number;
  lastScorer: number | null;
  rally: number;
  roundSeq: number;
  lastElapsed: number;
}

/** 保留 1 位小数并消除 -0，保证序列化还原前后严格相等 */
function round1(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 解析玩家或观察者 ID 所属阵营（0 为蓝方左半场，1 为橙方右半场） */
function parseSide(id?: string): number {
  if (!id) return 0;
  const match = /^side-(\d+)(?:#(\d+))?$/.exec(id);
  return match ? Number(match[1]) % 2 : 0;
}

/** 解析玩家槽位元信息 */
function parsePlayerSlots(playerIds: string[]) {
  const parsed: { id: string; side: number; slot: number }[] = [];
  for (const id of playerIds) {
    const match = /^side-(\d+)(?:#(\d+))?$/.exec(id);
    if (match) {
      parsed.push({ id, side: Number(match[1]) % 2, slot: Number(match[2] ?? 0) });
    } else {
      parsed.push({ id, side: 0, slot: parsed.filter(item => item.side === 0).length });
    }
  }
  if (!parsed.some(item => item.side === 0)) {
    parsed.unshift({ id: "side-0#0", side: 0, slot: 0 });
  }
  if (!parsed.some(item => item.side === 1)) {
    parsed.push({ id: "side-1#0", side: 1, slot: 0 });
  }
  return parsed;
}

/** 根据阵营与同侧人数计算初始水平站位 */
function initialX(side: number, indexInSide: number, sideCount: number) {
  if (sideCount <= 1) {
    return side === 0 ? WIDTH * 0.25 : WIDTH * 0.75;
  }
  const leftPositions = [WIDTH * 0.16, WIDTH * 0.34];
  const rightPositions = [WIDTH * 0.66, WIDTH * 0.84];
  const table = side === 0 ? leftPositions : rightPositions;
  return table[indexInSide] ?? (side === 0 ? WIDTH * 0.25 : WIDTH * 0.75);
}

/** 重置球与全部史莱姆站位（发球方为参数 serveSide） */
function resetPositions(state: VolleyballState, serveSide: number) {
  const baseServeX = serveSide === 0 ? WIDTH * 0.25 : WIDTH * 0.75;
  state.ball.x = round1(baseServeX + state.serveOffset);
  state.ball.y = round1(HEIGHT * 0.3);
  state.ball.vx = 0;
  state.ball.vy = 0;

  const sideGroups = [
    state.players.filter(player => player.side === 0),
    state.players.filter(player => player.side === 1)
  ];
  for (const group of sideGroups) {
    group.forEach((player, idx) => {
      player.x = round1(initialX(player.side, idx, group.length));
      player.y = HEIGHT;
      player.vx = 0;
      player.vy = 0;
      player.moveDir = 0;
      player.holdDir = 0;
      player.pulseDir = 0;
      player.pulseUntil = 0;
      player.jumpBufferUntil = 0;
    });
  }
}

/** 根据当前按键状态更新史莱姆活动方向与水平速度 */
function effectiveDir(player: InternalPlayer, simTime: number): -1 | 0 | 1 {
  if (player.holdDir !== 0) return player.holdDir;
  if (simTime < player.pulseUntil) return player.pulseDir;
  return 0;
}

/** 限制史莱姆不能越过球场边缘或中网 */
function clampPlayer(player: InternalPlayer) {
  const halfNet = NET_WIDTH / 2;
  if (player.side === 0) {
    const minX = player.radius;
    const maxX = WIDTH / 2 - halfNet - player.radius;
    if (player.x < minX) player.x = minX;
    if (player.x > maxX) player.x = maxX;
  } else {
    const minX = WIDTH / 2 + halfNet + player.radius;
    const maxX = WIDTH - player.radius;
    if (player.x < minX) player.x = minX;
    if (player.x > maxX) player.x = maxX;
  }
  if (player.y > HEIGHT) {
    player.y = HEIGHT;
    player.vy = 0;
  }
}

/** 将球推离圆形物体表面并沿法线反弹 */
function bounceOffCircle(
  ball: VolleyballState["ball"],
  cx: number,
  cy: number,
  cr: number,
  cvx: number,
  cvy: number,
  bounce: number,
  momentumTransfer: number,
  minSpeed: number
) {
  let dx = ball.x - cx;
  let dy = ball.y - cy;
  let dist = Math.hypot(dx, dy);
  const combined = ball.radius + cr;
  if (dist > combined) return false;

  // 若圆心完全重合则向上推开，避免除零
  if (dist < 1e-6) {
    dx = 0;
    dy = -1;
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;

  ball.x = cx + nx * (combined + 0.5);
  ball.y = cy + ny * (combined + 0.5);

  const speed = Math.max(minSpeed, Math.hypot(ball.vx, ball.vy));
  ball.vx = (nx * speed + cvx * momentumTransfer) * bounce;
  ball.vy = (ny * speed + cvy * momentumTransfer) * bounce;

  if (Math.abs(ball.vx) > BALL_MAX_VX) ball.vx = Math.sign(ball.vx) * BALL_MAX_VX;
  if (Math.abs(ball.vy) > BALL_MAX_VY) ball.vy = Math.sign(ball.vy) * BALL_MAX_VY;
  return true;
}

/** 推进单个物理子步（dt 单位为秒） */
function stepPhysics(state: VolleyballState, simTime: number, dt: number) {
  if (state.frozenUntil > 0) {
    if (simTime >= state.frozenUntil) {
      state.frozenUntil = 0;
      const serveSide = state.lastScorer ?? 0;
      resetPositions(state, serveSide);
      state.rally = 0;
      state.roundSeq += 1;
    }
    return;
  }

  // 1. 更新全部史莱姆位移与跳跃
  for (const player of state.players) {
    const dir = effectiveDir(player, simTime);
    player.moveDir = dir;
    player.vx = dir * PLAYER_SPEED;

    if (player.y >= HEIGHT && simTime <= player.jumpBufferUntil) {
      player.vy = -PLAYER_JUMP;
      player.jumpBufferUntil = 0;
    }
    if (player.y < HEIGHT || player.vy < 0) {
      player.vy += GRAVITY * dt;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    clampPlayer(player);

    if (player.y >= HEIGHT && simTime <= player.jumpBufferUntil) {
      player.vy = -PLAYER_JUMP;
      player.jumpBufferUntil = 0;
    }
  }

  // 2. 更新排球受重力影响及最大速度约束
  const ball = state.ball;
  ball.vy += GRAVITY * dt;
  if (Math.abs(ball.vx) > BALL_MAX_VX) ball.vx = Math.sign(ball.vx) * BALL_MAX_VX;
  if (Math.abs(ball.vy) > BALL_MAX_VY) ball.vy = Math.sign(ball.vy) * BALL_MAX_VY;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // 3. 球与史莱姆半圆碰撞（仅在史莱姆底边上方发生半圆触球，防止地面穿模）
  for (const player of state.players) {
    if (ball.y <= player.y + ball.radius * 0.45) {
      if (bounceOffCircle(ball, player.x, player.y, player.radius, player.vx, player.vy, 1, MOMENTUM_TRANSFER, BALL_MIN_HIT_SPEED)) {
        state.rally += 1;
        if (ball.y > HEIGHT - ball.radius) ball.y = HEIGHT - ball.radius;
      }
    }
  }

  // 4. 球与中网碰撞（顶端半圆 + 两侧柱体）
  const netTopY = HEIGHT - NET_HEIGHT + NET_WIDTH / 2;
  const halfNet = NET_WIDTH / 2;
  if (!bounceOffCircle(ball, WIDTH / 2, netTopY, halfNet, 0, 0, BOUNCE_NET, 0, 0)) {
    if (ball.y > netTopY) {
      if (ball.x + ball.radius > WIDTH / 2 - halfNet && ball.x < WIDTH / 2 && ball.vx > 0) {
        ball.x = WIDTH / 2 - halfNet - ball.radius;
        ball.vx = -ball.vx * BOUNCE_NET;
      } else if (ball.x - ball.radius < WIDTH / 2 + halfNet && ball.x > WIDTH / 2 && ball.vx < 0) {
        ball.x = WIDTH / 2 + halfNet + ball.radius;
        ball.vx = -ball.vx * BOUNCE_NET;
      }
    }
  }

  // 5. 球与左右边墙反弹
  if (ball.x < ball.radius) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * BOUNCE;
  } else if (ball.x > WIDTH - ball.radius) {
    ball.x = WIDTH - ball.radius;
    ball.vx = -Math.abs(ball.vx) * BOUNCE;
  }

  // 6. 球触地判分与进入短暂冻结庆祝期
  if (ball.y >= HEIGHT - ball.radius) {
    ball.y = HEIGHT - ball.radius;
    ball.vy = -Math.abs(ball.vy) * BOUNCE;
    const scorer = ball.x < WIDTH / 2 ? 1 : 0;
    state.scores[scorer] += 1;
    state.lastScorer = scorer;
    state.frozenUntil = simTime + FREEZE_MS;
  }
}

/** 按时间增量分步推进模拟至目标 elapsed */
function advanceTo(state: VolleyballState, targetElapsed: number) {
  if (targetElapsed <= state.lastElapsed) return false;
  const delta = Math.min(250, targetElapsed - state.lastElapsed);
  let cursor = state.lastElapsed;
  const end = state.lastElapsed + delta;

  while (cursor < end) {
    const stepMs = Math.min(SUB_STEP_MS, end - cursor);
    cursor += stepMs;
    stepPhysics(state, cursor, stepMs / 1000);
  }
  state.lastElapsed = targetElapsed;
  return true;
}

export default plugin<VolleyballState>({
  init({ playerIds, seed, tier }) {
    const rand = rng(seed);
    const level = tier ?? 1;
    const slots = parsePlayerSlots(playerIds);
    const sideCounts = [
      slots.filter(item => item.side === 0).length,
      slots.filter(item => item.side === 1).length
    ];
    const players: InternalPlayer[] = [];

    for (const side of [0, 1]) {
      const group = slots.filter(item => item.side === side);
      const radius = sideCounts[side] > 1 ? DOUBLES_RADIUS : SINGLE_RADIUS;
      group.forEach((item, idx) => {
        players.push({
          id: item.id,
          side,
          slot: idx,
          x: round1(initialX(side, idx, group.length)),
          y: HEIGHT,
          vx: 0,
          vy: 0,
          radius,
          moveDir: 0,
          holdDir: 0,
          pulseDir: 0,
          pulseUntil: 0,
          jumpBufferUntil: 0
        });
      });
    }

    const serveSide = rand(2);
    const serveOffset = rand(37) - 18;
    const state: VolleyballState = {
      theme: THEMES[(level - 1) % THEMES.length],
      scoreTarget: SCORE_TARGETS[(level - 1) % SCORE_TARGETS.length],
      scores: [0, 0],
      players,
      ball: { x: 0, y: 0, vx: 0, vy: 0, radius: BALL_RADIUS },
      serveOffset,
      frozenUntil: 0,
      lastScorer: null,
      rally: 0,
      roundSeq: 1,
      lastElapsed: 0
    };
    resetPositions(state, serveSide);
    return state;
  },

  handleInput(state, playerId, input: Action, frame) {
    const isValidAction =
      (input.kind === "action" && ["hold-left", "hold-right", "release", "jump"].includes(input.action)) ||
      (input.kind === "move" && ["left", "right", "up"].includes(input.direction));
    if (!isValidAction) return false;

    const player = state.players.find(item => item.id === playerId)
      ?? state.players.find(item => item.id.startsWith(playerId + "#"))
      ?? state.players.find(item => item.side === parseSide(playerId));
    if (!player) return false;

    advanceTo(state, frame.elapsed);
    const now = state.lastElapsed;
    if (input.kind === "action") {
      if (input.action === "hold-left") {
        player.holdDir = -1;
        player.pulseDir = 0;
        player.pulseUntil = 0;
        player.moveDir = -1;
        player.vx = -PLAYER_SPEED;
        return true;
      }
      if (input.action === "hold-right") {
        player.holdDir = 1;
        player.pulseDir = 0;
        player.pulseUntil = 0;
        player.moveDir = 1;
        player.vx = PLAYER_SPEED;
        return true;
      }
      if (input.action === "release") {
        player.holdDir = 0;
        player.pulseDir = 0;
        player.pulseUntil = 0;
        player.moveDir = 0;
        player.vx = 0;
        return true;
      }
      if (input.action === "jump") {
        player.jumpBufferUntil = now + JUMP_BUFFER_MS;
        if (player.y >= HEIGHT && state.frozenUntil === 0) {
          player.vy = -PLAYER_JUMP;
          player.jumpBufferUntil = 0;
        }
        return true;
      }
      return false;
    }

    if (input.kind === "move") {
      if (input.direction === "up") {
        player.jumpBufferUntil = now + JUMP_BUFFER_MS;
        if (player.y >= HEIGHT && state.frozenUntil === 0) {
          player.vy = -PLAYER_JUMP;
          player.jumpBufferUntil = 0;
        }
        return true;
      }
      if (input.direction === "left" || input.direction === "right") {
        const dir = input.direction === "left" ? -1 : 1;
        player.pulseDir = dir;
        player.pulseUntil = now + PULSE_MS;
        player.moveDir = dir;
        player.vx = dir * PLAYER_SPEED;
        return true;
      }
    }

    return false;
  },

  tick(state, frame) {
    return advanceTo(state, frame.elapsed);
  },

  getState(state): VolleyballScene {
    return {
      kind: "volleyball",
      width: WIDTH,
      height: HEIGHT,
      netWidth: NET_WIDTH,
      netHeight: NET_HEIGHT,
      theme: state.theme,
      scores: [state.scores[0], state.scores[1]],
      players: state.players.map(player => ({
        id: player.id,
        side: player.side,
        slot: player.slot,
        x: round1(player.x),
        y: round1(player.y),
        vx: round1(player.vx),
        vy: round1(player.vy),
        radius: player.radius,
        moveDir: player.moveDir
      })),
      ball: {
        x: round1(state.ball.x),
        y: round1(state.ball.y),
        vx: round1(state.ball.vx),
        vy: round1(state.ball.vy),
        radius: state.ball.radius
      },
      frozen: state.frozenUntil > 0,
      lastScorer: state.lastScorer,
      rally: state.rally,
      roundSeq: state.roundSeq
    };
  },

  getProgress(state, viewer): Progress {
    const side = parseSide(viewer);
    return { value: state.scores[side], target: state.scoreTarget, label: "得分" };
  },

  // 严格 60 秒计时分胜负，不因达到某个分数提前结束
  checkWin() {
    return false;
  },

  isComplete() {
    return false;
  }
});
