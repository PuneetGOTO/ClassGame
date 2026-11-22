import { plugin, rng } from "../../packages/game-sdk";
import type { Action, AirHockeyPaddle, AirHockeyScene, Progress } from "../../packages/shared/protocol";
import { STICK_DEADZONE } from "../../packages/shared/rules";

const WIDTH = 1200;
const HEIGHT = 600;
const GOAL_TOP = 195;
const GOAL_BOTTOM = 405;
const PUCK_RADIUS = 24;
const PUCK_MASS = 1.0;
const PADDLE_MASS = 4.5;
const SINGLE_PADDLE_RADIUS = 44;
const DOUBLES_PADDLE_RADIUS = 36;

// 适度降低摇杆灵敏度，保证手机端推拉稳重跟手且松手快速刹停
const PADDLE_MAX_SPEED = 500;
const PADDLE_ACCEL_RATE = 14;
const PADDLE_BRAKE_RATE = 18;

const WIN_SCORE = 5;
const OVERDRIVE_MS = 40_000;
const FREEZE_MS = 700;
const SUB_STEP_MS = 10;
const PULSE_MS = 220;

const NORMAL_PUCK_MAX_SPEED = 900;
const OVERDRIVE_PUCK_MAX_SPEED = 1280;
const NORMAL_WALL_BOUNCE = 0.96;
const OVERDRIVE_WALL_BOUNCE = 1.0;
const NORMAL_HIT_MIN_SPEED = 360;
const OVERDRIVE_HIT_MIN_SPEED = 520;
const HIT_RESTITUTION = 0.92;

const THEMES = ["cyber", "synth", "laser", "hyper"] as const;

interface InternalPaddle extends AirHockeyPaddle {
  stickX: number;
  stickY: number;
  pulseX: number;
  pulseY: number;
  pulseUntil: number;
}

export interface AirHockeyState {
  theme: AirHockeyScene["theme"];
  scores: [number, number];
  paddles: InternalPaddle[];
  puck: AirHockeyScene["puck"];
  initialOffsetY: number;
  overdrive: boolean;
  frozenUntil: number;
  finished: boolean;
  lastScorer: number | null;
  hitSeq: number;
  wallSeq: number;
  roundSeq: number;
  lastElapsed: number;
}

/** 保留 1 位小数并消除 -0，保证序列化还原前后严格相等 */
function round1(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 解析玩家或观察者 ID 所属阵营（0 为玩家 1 左半场，1 为玩家 2 右半场） */
function parseSide(id?: string): number {
  if (!id) return 0;
  const match = /^side-(\d+)(?:#(\d+))?$/.exec(id);
  return match ? Number(match[1]) % 2 : 0;
}

/** 解析玩家槽位元信息，缺失任意半场时自动补齐对手拍位 */
function parseSlots(playerIds: string[]) {
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

/** 根据阵营与同侧人数分配初始站位（2v2 为后卫 + 前锋错位） */
function initialPosition(side: number, index: number, sideCount: number): [number, number] {
  if (sideCount <= 1) {
    return [side === 0 ? 210 : WIDTH - 210, HEIGHT / 2];
  }
  if (side === 0) {
    return index === 0 ? [155, 250] : [405, 350];
  }
  return index === 0 ? [WIDTH - 155, 350] : [WIDTH - 405, 250];
}

/** 清空单个球拍的摇杆与按键脉冲状态 */
function resetPaddleInput(paddle: InternalPaddle) {
  paddle.stickX = 0;
  paddle.stickY = 0;
  paddle.pulseX = 0;
  paddle.pulseY = 0;
  paddle.pulseUntil = 0;
}

/** 限制球拍不越过球台边缘及中线 */
function clampPaddle(paddle: InternalPaddle) {
  const r = paddle.radius;
  const minX = paddle.side === 0 ? r : WIDTH / 2 + r;
  const maxX = paddle.side === 0 ? WIDTH / 2 - r : WIDTH - r;

  if (paddle.x < minX) {
    paddle.x = minX;
    if (paddle.vx < 0) paddle.vx = 0;
  } else if (paddle.x > maxX) {
    paddle.x = maxX;
    if (paddle.vx > 0) paddle.vx = 0;
  }

  if (paddle.y < r) {
    paddle.y = r;
    if (paddle.vy < 0) paddle.vy = 0;
  } else if (paddle.y > HEIGHT - r) {
    paddle.y = HEIGHT - r;
    if (paddle.vy > 0) paddle.vy = 0;
  }
}

/** 重置球拍与冰球站位；concedingSide 为 null 时置于开球中点 */
function resetRoundPositions(state: AirHockeyState, concedingSide: number | null) {
  if (concedingSide === null) {
    state.puck.x = WIDTH / 2;
    state.puck.y = round1(HEIGHT / 2 + state.initialOffsetY);
  } else {
    state.puck.x = concedingSide === 0 ? WIDTH * 0.38 : WIDTH * 0.62;
    state.puck.y = round1(HEIGHT / 2 + state.initialOffsetY * 0.6);
  }
  state.puck.vx = 0;
  state.puck.vy = 0;

  const groups = [
    state.paddles.filter(p => p.side === 0),
    state.paddles.filter(p => p.side === 1)
  ];
  for (const group of groups) {
    group.forEach((paddle, idx) => {
      const [x, y] = initialPosition(paddle.side, idx, group.length);
      paddle.x = x;
      paddle.y = y;
      paddle.vx = 0;
      paddle.vy = 0;
    });
  }
}

/** 限制冰球最高速度 */
function capPuckSpeed(puck: AirHockeyState["puck"], maxSpeed: number) {
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > maxSpeed && speed > 1e-6) {
    const scale = maxSpeed / speed;
    puck.vx *= scale;
    puck.vy *= scale;
  }
}

/** 检测并解决球拍与冰球之间的二维弹性碰撞 */
function collidePaddleAndPuck(state: AirHockeyState, paddle: InternalPaddle) {
  const puck = state.puck;
  let dx = puck.x - paddle.x;
  let dy = puck.y - paddle.y;
  let dist = Math.hypot(dx, dy);
  const minDist = puck.radius + paddle.radius;
  if (dist >= minDist) return;

  if (dist < 1e-6) {
    dx = paddle.side === 0 ? 1 : -1;
    dy = 0;
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  // 优先推出冰球防止把球拍挤出己方半场或穿墙
  puck.x += nx * (overlap + 0.5);
  puck.y += ny * (overlap + 0.5);

  const rvx = puck.vx - paddle.vx;
  const rvy = puck.vy - paddle.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal < 0) {
    const invMassSum = 1 / PUCK_MASS + 1 / PADDLE_MASS;
    const j = (-(1 + HIT_RESTITUTION) * velAlongNormal) / invMassSum;
    puck.vx += (j / PUCK_MASS) * nx;
    puck.vy += (j / PUCK_MASS) * ny;
    // 给球拍微小反作用力，避免手感发虚
    paddle.vx -= (j / PADDLE_MASS) * nx * 0.35;
    paddle.vy -= (j / PADDLE_MASS) * ny * 0.35;
  } else {
    // 若重叠加追撞且法向已同向，附加一次推离速度避免粘球
    puck.vx += nx * 160 + paddle.vx * 0.25;
    puck.vy += ny * 160 + paddle.vy * 0.25;
  }

  const minHit = state.overdrive ? OVERDRIVE_HIT_MIN_SPEED : NORMAL_HIT_MIN_SPEED;
  const maxSpeed = state.overdrive ? OVERDRIVE_PUCK_MAX_SPEED : NORMAL_PUCK_MAX_SPEED;
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed < minHit) {
    const outNx = speed > 1e-3 ? puck.vx / speed : nx;
    const outNy = speed > 1e-3 ? puck.vy / speed : ny;
    puck.vx = outNx * minHit;
    puck.vy = outNy * minHit;
  }
  capPuckSpeed(puck, maxSpeed);
  state.hitSeq += 1;
}

/** 推进单个 10ms 物理子步 */
function stepPhysics(state: AirHockeyState, simTime: number, dt: number) {
  if (state.finished) return;

  // 第 40 秒自动切入加速狂飙阶段
  if (!state.overdrive && simTime >= OVERDRIVE_MS) {
    state.overdrive = true;
    const speed = Math.hypot(state.puck.vx, state.puck.vy);
    if (speed > 20) {
      state.puck.vx *= 1.28;
      state.puck.vy *= 1.28;
      capPuckSpeed(state.puck, OVERDRIVE_PUCK_MAX_SPEED);
    }
  }

  if (state.frozenUntil > 0) {
    if (simTime >= state.frozenUntil) {
      state.frozenUntil = 0;
      const concedingSide = state.lastScorer === null ? null : 1 - state.lastScorer;
      resetRoundPositions(state, concedingSide);
      state.roundSeq += 1;
    }
    return;
  }

  // 1. 按低灵敏度一阶平滑跟踪摇杆速度并限制半场活动范围
  for (const paddle of state.paddles) {
    let dirX = paddle.stickX;
    let dirY = paddle.stickY;
    if (Math.hypot(dirX, dirY) < STICK_DEADZONE && simTime < paddle.pulseUntil) {
      dirX = paddle.pulseX;
      dirY = paddle.pulseY;
    }
    const mag = Math.hypot(dirX, dirY);
    if (mag >= STICK_DEADZONE) {
      const clampedMag = Math.min(1, mag);
      const targetVx = (dirX / mag) * clampedMag * PADDLE_MAX_SPEED;
      const targetVy = (dirY / mag) * clampedMag * PADDLE_MAX_SPEED;
      const alpha = 1 - Math.exp(-PADDLE_ACCEL_RATE * dt);
      paddle.vx += (targetVx - paddle.vx) * alpha;
      paddle.vy += (targetVy - paddle.vy) * alpha;
    } else {
      const brake = Math.exp(-PADDLE_BRAKE_RATE * dt);
      paddle.vx *= brake;
      paddle.vy *= brake;
      if (Math.hypot(paddle.vx, paddle.vy) < 1.5) {
        paddle.vx = 0;
        paddle.vy = 0;
      }
    }
    paddle.x += paddle.vx * dt;
    paddle.y += paddle.vy * dt;
    clampPaddle(paddle);
  }

  // 2. 推进冰球位置与桌面微摩擦阻尼
  const puck = state.puck;
  const maxSpeed = state.overdrive ? OVERDRIVE_PUCK_MAX_SPEED : NORMAL_PUCK_MAX_SPEED;
  const wallBounce = state.overdrive ? OVERDRIVE_WALL_BOUNCE : NORMAL_WALL_BOUNCE;
  const damping = state.overdrive ? Math.pow(0.996, dt * 60) : Math.pow(0.992, dt * 60);

  puck.vx *= damping;
  puck.vy *= damping;
  if (Math.hypot(puck.vx, puck.vy) < 2) {
    puck.vx = 0;
    puck.vy = 0;
  }
  capPuckSpeed(puck, maxSpeed);
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;

  // 3. 球拍与冰球碰撞
  for (const paddle of state.paddles) {
    collidePaddleAndPuck(state, paddle);
  }

  // 4. 上下边界反弹
  if (puck.y < puck.radius) {
    puck.y = puck.radius;
    if (puck.vy < 0) {
      puck.vy = -puck.vy * wallBounce;
      state.wallSeq += 1;
    }
  } else if (puck.y > HEIGHT - puck.radius) {
    puck.y = HEIGHT - puck.radius;
    if (puck.vy > 0) {
      puck.vy = -puck.vy * wallBounce;
      state.wallSeq += 1;
    }
  }

  // 5. 左右边界与球门判分
  const inGoalMouth = puck.y >= GOAL_TOP + puck.radius * 0.35 && puck.y <= GOAL_BOTTOM - puck.radius * 0.35;
  if (puck.x < puck.radius) {
    if (inGoalMouth) {
      puck.x = puck.radius;
      puck.vx = 0;
      puck.vy = 0;
      state.scores[1] += 1;
      state.lastScorer = 1;
      if (state.scores[1] >= WIN_SCORE) {
        state.finished = true;
      } else {
        state.frozenUntil = simTime + FREEZE_MS;
      }
      return;
    }
    puck.x = puck.radius;
    if (puck.vx < 0) {
      puck.vx = -puck.vx * wallBounce;
      state.wallSeq += 1;
    }
  } else if (puck.x > WIDTH - puck.radius) {
    if (inGoalMouth) {
      puck.x = WIDTH - puck.radius;
      puck.vx = 0;
      puck.vy = 0;
      state.scores[0] += 1;
      state.lastScorer = 0;
      if (state.scores[0] >= WIN_SCORE) {
        state.finished = true;
      } else {
        state.frozenUntil = simTime + FREEZE_MS;
      }
      return;
    }
    puck.x = WIDTH - puck.radius;
    if (puck.vx > 0) {
      puck.vx = -puck.vx * wallBounce;
      state.wallSeq += 1;
    }
  }
}

/** 将物理模拟按固定子步推进至目标 elapsed */
function advanceTo(state: AirHockeyState, targetElapsed: number) {
  if (state.finished || targetElapsed <= state.lastElapsed) return false;
  let cursor = state.lastElapsed;

  while (cursor < targetElapsed && !state.finished) {
    const stepMs = Math.min(SUB_STEP_MS, targetElapsed - cursor);
    cursor += stepMs;
    stepPhysics(state, cursor, stepMs / 1000);
  }
  state.lastElapsed = targetElapsed;
  return true;
}

export default plugin<AirHockeyState>({
  init({ playerIds, seed, tier }) {
    const rand = rng(seed);
    const level = tier ?? 1;
    const slots = parseSlots(playerIds);
    const sideCounts = [
      slots.filter(item => item.side === 0).length,
      slots.filter(item => item.side === 1).length
    ];
    const paddles: InternalPaddle[] = [];

    for (const side of [0, 1]) {
      const group = slots.filter(item => item.side === side);
      const radius = sideCounts[side] > 1 ? DOUBLES_PADDLE_RADIUS : SINGLE_PADDLE_RADIUS;
      group.forEach((item, idx) => {
        const [x, y] = initialPosition(side, idx, group.length);
        paddles.push({
          id: item.id,
          side,
          slot: idx,
          x,
          y,
          vx: 0,
          vy: 0,
          radius,
          stickX: 0,
          stickY: 0,
          pulseX: 0,
          pulseY: 0,
          pulseUntil: 0
        });
      });
    }

    const initialOffsetY = rand(29) - 14;
    const state: AirHockeyState = {
      theme: THEMES[(level - 1) % THEMES.length],
      scores: [0, 0],
      paddles,
      puck: { x: 0, y: 0, vx: 0, vy: 0, radius: PUCK_RADIUS },
      initialOffsetY,
      overdrive: false,
      frozenUntil: 0,
      finished: false,
      lastScorer: null,
      hitSeq: 0,
      wallSeq: 0,
      roundSeq: 1,
      lastElapsed: 0
    };
    resetRoundPositions(state, null);
    return state;
  },

  handleInput(state, playerId, input: Action, frame) {
    if (state.finished) return false;
    const isValid = input.kind === "stick" || input.kind === "move";
    if (!isValid) return false;

    const paddle = state.paddles.find(item => item.id === playerId);
    if (!paddle) return false;

    if (input.kind === "stick") {
      const mag = Math.hypot(input.x, input.y);
      const nx = mag < STICK_DEADZONE ? 0 : mag > 1 ? input.x / mag : input.x;
      const ny = mag < STICK_DEADZONE ? 0 : mag > 1 ? input.y / mag : input.y;
      if (nx === 0 && ny === 0 && paddle.stickX === 0 && paddle.stickY === 0 && paddle.pulseUntil === 0) {
        return false;
      }
      advanceTo(state, frame.elapsed);
      if (state.finished) return false;
      paddle.stickX = nx;
      paddle.stickY = ny;
      paddle.pulseX = 0;
      paddle.pulseY = 0;
      paddle.pulseUntil = 0;
      if (nx === 0 && ny === 0) {
        paddle.vx *= 0.25;
        paddle.vy *= 0.25;
      } else {
        paddle.vx = nx * PADDLE_MAX_SPEED;
        paddle.vy = ny * PADDLE_MAX_SPEED;
      }
      return true;
    }

    advanceTo(state, frame.elapsed);
    if (state.finished) return false;
    const dirMap = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0]
    } as const;
    const [dx, dy] = dirMap[input.direction];
    paddle.pulseX = dx;
    paddle.pulseY = dy;
    paddle.pulseUntil = state.lastElapsed + PULSE_MS;
    paddle.vx = dx * PADDLE_MAX_SPEED;
    paddle.vy = dy * PADDLE_MAX_SPEED;
    return true;
  },

  clearControls(state, playerId) {
    for (const paddle of state.paddles) {
      if (playerId === undefined || paddle.id === playerId) {
        resetPaddleInput(paddle);
        paddle.vx = 0;
        paddle.vy = 0;
      }
    }
  },

  tick(state, frame) {
    return advanceTo(state, frame.elapsed);
  },

  getState(state): AirHockeyScene {
    return {
      kind: "air-hockey",
      width: WIDTH,
      height: HEIGHT,
      goalTop: GOAL_TOP,
      goalBottom: GOAL_BOTTOM,
      theme: state.theme,
      scores: [state.scores[0], state.scores[1]],
      winScore: WIN_SCORE,
      paddles: state.paddles.map(paddle => ({
        id: paddle.id,
        side: paddle.side,
        slot: paddle.slot,
        x: round1(paddle.x),
        y: round1(paddle.y),
        vx: round1(paddle.vx),
        vy: round1(paddle.vy),
        radius: paddle.radius
      })),
      puck: {
        x: round1(state.puck.x),
        y: round1(state.puck.y),
        vx: round1(state.puck.vx),
        vy: round1(state.puck.vy),
        radius: state.puck.radius
      },
      overdrive: state.overdrive,
      frozen: state.frozenUntil > 0 || state.finished,
      lastScorer: state.lastScorer,
      hitSeq: state.hitSeq,
      wallSeq: state.wallSeq,
      roundSeq: state.roundSeq
    };
  },

  getProgress(state, viewer): Progress {
    const side = parseSide(viewer);
    return { value: state.scores[side], target: WIN_SCORE, label: "進球" };
  },

  checkWin(state, playerId) {
    return state.scores[parseSide(playerId)] >= WIN_SCORE;
  },

  isComplete(state) {
    return state.scores[0] >= WIN_SCORE || state.scores[1] >= WIN_SCORE;
  }
});
