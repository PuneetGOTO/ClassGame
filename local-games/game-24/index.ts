import { plugin, rng } from "../../packages/game-sdk";
import type {
  Action,
  DojoAnim,
  DojoFighterScene,
  DojoPhase,
  DojoSamurai,
  DojoSpark,
  Progress
} from "../../packages/shared/protocol";

const WIDTH = 1200;
const HEIGHT = 600;
const GROUND_Y = 492;
const STAGE_MIN_X = 68;
const STAGE_MAX_X = WIDTH - 68;
const STEP_MS = 20;

const MOVE_SPEED = 440;
const GRAVITY = 2150;
const JUMP_VY = -800;
const JUMP_BUFFER_MS = 120;
const PULSE_MS = 180;

const MAX_HP = 100;
const BASE_DAMAGE = 18;
const OVERDRIVE_MS = 40_000;
const SUDDEN_DEATH_MS = 55_000;

const ATTACK_DURATION_MS = 280;
const ATTACK_ACTIVE_START_MS = 60;
const ATTACK_ACTIVE_END_MS = 175;
const ATTACK_COOLDOWN_MS = 360;
const ATTACK_REACH = 148;
const BODY_HALF_W = 30;
const BODY_HEIGHT = 118;

const HURT_STUN_MS = 220;
const HITSTOP_MS = 65;
const SHAKE_MS = 150;
const SPARK_TTL_MS = 380;

const THEMES = ["sakura", "autumn", "bamboo", "crimson"] as const;

type SoundKind = DojoFighterScene["lastSound"];

interface InternalFighter extends DojoSamurai {
  holdDir: -1 | 0 | 1;
  pulseDir: -1 | 0 | 1;
  pulseUntil: number;
  jumpBufferUntil: number;
  attackMs: number;       // 0 表示未出刀，1..ATTACK_DURATION_MS 表示挥刀进程
  attackCooldownMs: number;
  attackHitIds: string[]; // 本次挥刀已命中过的敌人，避免多帧重复扣血
  attackClashed: boolean;
}

export interface DojoState {
  theme: DojoFighterScene["theme"];
  fighters: InternalFighter[];
  phase: DojoPhase;
  spark: DojoSpark | null;
  sparkSeq: number;
  hitstopMs: number;
  shakeMs: number;
  finished: boolean;
  winnerSide: number | null;
  soundSeq: number;
  lastSound: SoundKind;
  lastElapsed: number;
}

/** 保留 1 位小数并消除 -0，确保序列化还原后严格一致 */
function round1(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

function parseSide(id?: string): number {
  if (!id) return 0;
  return id.startsWith("side-1") ? 1 : 0;
}

function recordSound(state: DojoState, sound: SoundKind) {
  state.soundSeq++;
  state.lastSound = sound;
}

function makeFighter(id: string, side: number, slot: number, x: number): InternalFighter {
  return {
    id,
    side,
    slot,
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: MAX_HP,
    maxHp: MAX_HP,
    alive: true,
    anim: "idle",
    attackProgress: 0,
    hurtMs: 0,
    hits: 0,
    holdDir: 0,
    pulseDir: 0,
    pulseUntil: 0,
    jumpBufferUntil: -1,
    attackMs: 0,
    attackCooldownMs: 0,
    attackHitIds: [],
    attackClashed: false
  };
}

/** 根据人数自动构建 1v1 或 2v2 对阵站位 */
function buildFighters(playerIds: readonly string[], seed: number): InternalFighter[] {
  const unique = [...new Set(playerIds)];
  const leftIds = unique.filter(id => parseSide(id) === 0);
  const rightIds = unique.filter(id => parseSide(id) === 1);
  if (!leftIds.length) leftIds.push("side-0#0");
  if (!rightIds.length) rightIds.push("side-1#0");

  // 用 seed 引入微小的对称起手偏移，保证不同局次可区分且绝对公平
  const rand = rng(seed ^ 0x2468ace);
  const jitter = rand(21) - 10;

  const fighters: InternalFighter[] = [];
  if (leftIds.length === 1) {
    fighters.push(makeFighter(leftIds[0], 0, 0, 290 + jitter));
  } else {
    fighters.push(makeFighter(leftIds[0], 0, 0, 210 + jitter));
    fighters.push(makeFighter(leftIds[1], 0, 1, 385 + jitter));
  }

  if (rightIds.length === 1) {
    fighters.push(makeFighter(rightIds[0], 1, 0, WIDTH - 290 - jitter));
  } else {
    fighters.push(makeFighter(rightIds[0], 1, 0, WIDTH - 210 - jitter));
    fighters.push(makeFighter(rightIds[1], 1, 1, WIDTH - 385 - jitter));
  }
  return fighters;
}

function teamHpTotals(fighters: readonly InternalFighter[]): { hp: [number, number]; max: [number, number] } {
  const hp: [number, number] = [0, 0];
  const max: [number, number] = [0, 0];
  for (const f of fighters) {
    const s = f.side === 1 ? 1 : 0;
    hp[s] += Math.max(0, f.hp);
    max[s] += f.maxHp;
  }
  return { hp, max };
}

function attackRect(f: InternalFighter) {
  const left = f.facing === 1 ? f.x + 14 : f.x - ATTACK_REACH;
  const right = f.facing === 1 ? f.x + ATTACK_REACH : f.x - 14;
  return {
    left,
    right,
    top: f.y - BODY_HEIGHT + 6,
    bottom: f.y - 10
  };
}

function bodyRect(f: InternalFighter) {
  return {
    left: f.x - BODY_HALF_W,
    right: f.x + BODY_HALF_W,
    top: f.y - BODY_HEIGHT,
    bottom: f.y
  };
}

function rectsOverlap(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number }
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function isAttackActive(f: InternalFighter) {
  return (
    f.alive &&
    !f.attackClashed &&
    f.attackMs >= ATTACK_ACTIVE_START_MS &&
    f.attackMs <= ATTACK_ACTIVE_END_MS
  );
}

function updatePhase(state: DojoState) {
  if (state.finished) return;
  const { hp } = teamHpTotals(state.fighters);
  let nextPhase: DojoPhase = "normal";
  if (state.lastElapsed >= SUDDEN_DEATH_MS && hp[0] === hp[1]) {
    nextPhase = "sudden-death";
  } else if (state.lastElapsed >= OVERDRIVE_MS) {
    nextPhase = "overdrive";
  }
  if (nextPhase !== state.phase) {
    state.phase = nextPhase;
    if (nextPhase === "overdrive" || nextPhase === "sudden-death") {
      recordSound(state, "taiko");
    }
  }
}

function currentDamage(phase: DojoPhase) {
  if (phase === "sudden-death") return 999;
  if (phase === "overdrive") return BASE_DAMAGE * 2;
  return BASE_DAMAGE;
}

function evaluateVictory(state: DojoState) {
  if (state.finished) return;
  const blueAlive = state.fighters.some(f => f.side === 0 && f.alive);
  const redAlive = state.fighters.some(f => f.side === 1 && f.alive);
  if (!blueAlive || !redAlive) {
    state.finished = true;
    state.winnerSide = blueAlive && !redAlive ? 0 : redAlive && !blueAlive ? 1 : null;
    for (const f of state.fighters) {
      f.holdDir = 0;
      f.pulseDir = 0;
      if (f.alive && f.side === state.winnerSide) {
        f.anim = "win";
      }
    }
  }
}

function updateAnimations(state: DojoState) {
  for (const f of state.fighters) {
    if (!f.alive) {
      f.anim = "ko";
      f.attackProgress = 0;
      continue;
    }
    if (state.finished && f.side === state.winnerSide) {
      f.anim = "win";
      f.attackProgress = 0;
      continue;
    }
    if (f.hurtMs > 0) {
      f.anim = "hurt";
      f.attackProgress = 0;
      continue;
    }
    if (f.attackMs > 0) {
      f.anim = "attack";
      f.attackProgress = round1(Math.min(1, f.attackMs / ATTACK_DURATION_MS));
      continue;
    }
    f.attackProgress = 0;
    if (f.y < GROUND_Y - 1) {
      f.anim = "jump";
    } else if (Math.abs(f.vx) > 20) {
      f.anim = "run";
    } else {
      f.anim = "idle";
    }
  }
}

function stepPhysics(state: DojoState, dtMs: number) {
  if (state.finished) return;
  const dt = dtMs / 1000;

  // 衰减震屏与火花
  if (state.shakeMs > 0) state.shakeMs = Math.max(0, state.shakeMs - dtMs);
  if (state.spark) {
    state.spark.ttlMs -= dtMs;
    if (state.spark.ttlMs <= 0) state.spark = null;
  }

  // 命中顿帧（hit-stop）：短暂冻结运动增强刀剑打击感
  if (state.hitstopMs > 0) {
    state.hitstopMs = Math.max(0, state.hitstopMs - dtMs);
    return;
  }

  updatePhase(state);

  // 1. 角色移动、跳跃、重力与出刀计时
  for (const f of state.fighters) {
    if (!f.alive) {
      f.vx = 0;
      if (f.y < GROUND_Y) {
        f.vy += GRAVITY * dt;
        f.y = Math.min(GROUND_Y, f.y + f.vy * dt);
        if (f.y >= GROUND_Y) f.vy = 0;
      }
      continue;
    }

    if (f.hurtMs > 0) f.hurtMs = Math.max(0, f.hurtMs - dtMs);
    if (f.attackCooldownMs > 0) f.attackCooldownMs = Math.max(0, f.attackCooldownMs - dtMs);
    if (f.attackMs > 0) {
      f.attackMs += dtMs;
      if (f.attackMs > ATTACK_DURATION_MS) {
        f.attackMs = 0;
        f.attackHitIds = [];
        f.attackClashed = false;
      }
    }

    const moveDir: -1 | 0 | 1 = f.holdDir !== 0
      ? f.holdDir
      : state.lastElapsed < f.pulseUntil ? f.pulseDir : 0;

    if (f.hurtMs > 0) {
      // 受击击退期间缓慢减速
      f.vx *= Math.pow(0.08, dt);
    } else {
      // 出刀期间略微减缓水平移速，增加出招重量感
      const speedScale = f.attackMs > 0 ? 0.52 : 1;
      f.vx = moveDir * MOVE_SPEED * speedScale;
      if (moveDir !== 0 && f.attackMs === 0) {
        f.facing = moveDir;
      }
    }

    // 落地跳跃判定（支持短缓冲，防空中无限连跳）
    const onGround = f.y >= GROUND_Y - 0.5;
    if (onGround && f.hurtMs === 0 && f.jumpBufferUntil >= state.lastElapsed) {
      f.vy = JUMP_VY;
      f.jumpBufferUntil = -1;
    }

    f.vy += GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    if (f.y >= GROUND_Y) {
      f.y = GROUND_Y;
      f.vy = 0;
    }
    if (f.x < STAGE_MIN_X) {
      f.x = STAGE_MIN_X;
      if (f.vx < 0) f.vx = 0;
    } else if (f.x > STAGE_MAX_X) {
      f.x = STAGE_MAX_X;
      if (f.vx > 0) f.vx = 0;
    }
  }

  // 2. 先检测双刀相交拼刀（Clash）
  for (let i = 0; i < state.fighters.length; i++) {
    const a = state.fighters[i];
    if (!isAttackActive(a)) continue;
    const rectA = attackRect(a);
    for (let j = i + 1; j < state.fighters.length; j++) {
      const b = state.fighters[j];
      if (a.side === b.side || !isAttackActive(b)) continue;
      if (rectsOverlap(rectA, attackRect(b))) {
        a.attackClashed = true;
        b.attackClashed = true;
        a.vx = -a.facing * 320;
        b.vx = -b.facing * 320;
        a.hurtMs = 110;
        b.hurtMs = 110;
        state.hitstopMs = HITSTOP_MS;
        state.shakeMs = SHAKE_MS;
        state.spark = {
          seq: ++state.sparkSeq,
          x: round1((a.x + b.x) / 2),
          y: round1(Math.min(a.y, b.y) - 66),
          damage: 0,
          kind: "clash",
          ttlMs: SPARK_TTL_MS
        };
        recordSound(state, "clash");
      }
    }
  }

  // 3. 挥刀命中判定（2v2 同队严格免伤）
  const damage = currentDamage(state.phase);
  let anyKo = false;
  for (const attacker of state.fighters) {
    if (!isAttackActive(attacker)) continue;
    const box = attackRect(attacker);
    for (const target of state.fighters) {
      if (!target.alive || target.side === attacker.side) continue;
      if (attacker.attackHitIds.includes(target.id)) continue;
      if (!rectsOverlap(box, bodyRect(target))) continue;

      attacker.attackHitIds.push(target.id);
      attacker.hits++;
      const dealt = Math.min(target.hp, damage);
      target.hp = Math.max(0, target.hp - damage);
      target.hurtMs = HURT_STUN_MS;
      target.attackMs = 0;
      target.attackHitIds = [];
      target.vx = attacker.facing * 300;
      target.vy = target.y >= GROUND_Y - 1 ? -190 : Math.min(target.vy, -120);

      state.hitstopMs = HITSTOP_MS;
      state.shakeMs = SHAKE_MS;
      const isKo = target.hp <= 0;
      if (isKo) {
        target.alive = false;
        anyKo = true;
      }
      state.spark = {
        seq: ++state.sparkSeq,
        x: round1(target.x - attacker.facing * 12),
        y: round1(target.y - 68),
        damage: state.phase === "sudden-death" ? 999 : dealt,
        kind: isKo ? "ko" : "hit",
        ttlMs: SPARK_TTL_MS
      };
      recordSound(state, isKo ? "ko" : "hit");
    }
  }

  if (anyKo) {
    evaluateVictory(state);
  }
  updatePhase(state);
  updateAnimations(state);
}

function advanceTo(state: DojoState, elapsed: number): boolean {
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

function triggerAttack(state: DojoState, fighter: InternalFighter): boolean {
  if (!fighter.alive || fighter.hurtMs > 0 || fighter.attackMs > 0 || fighter.attackCooldownMs > 0) {
    return false;
  }
  fighter.attackMs = 1;
  fighter.attackCooldownMs = ATTACK_COOLDOWN_MS;
  fighter.attackHitIds = [];
  fighter.attackClashed = false;
  fighter.anim = "attack";
  recordSound(state, "swing");
  return true;
}

function toScene(state: DojoState): DojoFighterScene {
  const { hp, max } = teamHpTotals(state.fighters);
  return {
    kind: "dojo-fighter",
    width: WIDTH,
    height: HEIGHT,
    groundY: GROUND_Y,
    theme: state.theme,
    elapsedMs: state.lastElapsed,
    phase: state.phase,
    teamHp: hp,
    teamMaxHp: max,
    fighters: state.fighters.map(f => ({
      id: f.id,
      side: f.side,
      slot: f.slot,
      x: round1(f.x),
      y: round1(f.y),
      vx: round1(f.vx),
      vy: round1(f.vy),
      facing: f.facing,
      hp: Math.max(0, Math.round(f.hp)),
      maxHp: f.maxHp,
      alive: f.alive,
      anim: f.anim,
      attackProgress: round1(f.attackProgress),
      hurtMs: Math.max(0, Math.round(f.hurtMs)),
      hits: f.hits
    })),
    spark: state.spark ? { ...state.spark } : null,
    shakeMs: Math.max(0, Math.round(state.shakeMs)),
    finished: state.finished,
    winnerSide: state.winnerSide,
    soundSeq: state.soundSeq,
    lastSound: state.lastSound
  };
}

export default plugin<DojoState>({
  init({ seed, tier = 1, playerIds }) {
    const theme = THEMES[Math.max(0, Math.min(THEMES.length - 1, tier - 1))];
    return {
      theme,
      fighters: buildFighters(playerIds, seed),
      phase: "normal",
      spark: null,
      sparkSeq: 0,
      hitstopMs: 0,
      shakeMs: 0,
      finished: false,
      winnerSide: null,
      soundSeq: 0,
      lastSound: "none",
      lastElapsed: 0
    };
  },
  getState(state) {
    return toScene(state);
  },
  getProgress(state, viewer): Progress {
    const side = parseSide(viewer);
    const { hp, max } = teamHpTotals(state.fighters);
    return {
      value: hp[side],
      target: Math.max(1, max[side]),
      label: `HP ${hp[side]}/${max[side]}`
    };
  },
  checkWin(state, playerId) {
    return state.finished && state.winnerSide !== null && state.winnerSide === parseSide(playerId);
  },
  isComplete(state) {
    return state.finished;
  },
  clearControls(state, playerId) {
    for (const f of state.fighters) {
      if (playerId === undefined || f.id === playerId) {
        f.holdDir = 0;
        f.pulseDir = 0;
        f.pulseUntil = 0;
        f.jumpBufferUntil = -1;
      }
    }
  },
  tick(state, frame) {
    return advanceTo(state, frame.elapsed);
  },
  handleInput(state, playerId, action: Action, frame) {
    if (state.finished) return false;
    const fighter = state.fighters.find(f => f.id === playerId);
    if (!fighter || !fighter.alive) return false;

    const validMove = action.kind === "move" && (
      action.direction === "left" || action.direction === "right" || action.direction === "up"
    );
    const validAction = action.kind === "action" && (
      action.action === "hold-left"
      || action.action === "hold-right"
      || action.action === "release"
      || action.action === "jump"
      || action.action === "attack"
      || action.action === "interact"
    );
    if (!validMove && !validAction) return false;

    advanceTo(state, frame.elapsed);
    if (state.finished || !fighter.alive) return false;

    if (action.kind === "move") {
      if (action.direction === "up") {
        fighter.jumpBufferUntil = state.lastElapsed + JUMP_BUFFER_MS;
        return true;
      }
      const dir: -1 | 1 = action.direction === "left" ? -1 : 1;
      fighter.pulseDir = dir;
      fighter.pulseUntil = state.lastElapsed + PULSE_MS;
      if (fighter.attackMs === 0 && fighter.hurtMs === 0) fighter.facing = dir;
      return true;
    }

    if (action.kind === "action") {
      switch (action.action) {
        case "hold-left":
          fighter.holdDir = -1;
          if (fighter.attackMs === 0 && fighter.hurtMs === 0) fighter.facing = -1;
          return true;
        case "hold-right":
          fighter.holdDir = 1;
          if (fighter.attackMs === 0 && fighter.hurtMs === 0) fighter.facing = 1;
          return true;
        case "release":
          fighter.holdDir = 0;
          fighter.pulseDir = 0;
          fighter.pulseUntil = 0;
          return true;
        case "jump":
          fighter.jumpBufferUntil = state.lastElapsed + JUMP_BUFFER_MS;
          return true;
        case "attack":
        case "interact":
          return triggerAttack(state, fighter);
      }
    }
    return false;
  }
});
