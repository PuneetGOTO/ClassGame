import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { CANDY_COLUMNS, CANDY_ROWS } from "../shared/catalog";
import type { CandyBoardView, CandyPieceType, CandyStackScene, Member } from "../shared/protocol";

type SideMember = Pick<Member, "id" | "name" | "position" | "side">;

const CANVAS_W = 1200;
const CANVAS_H = 640;
const CELL = 34;
const BOARD_W = CANDY_COLUMNS * CELL;
const BOARD_H = CANDY_ROWS * CELL;
const BOARD_Y = 58;
const LEFT_BOARD_X = 148;
const RIGHT_BOARD_X = CANVAS_W - 148 - BOARD_W;

/** Candy colors and the caramel interference block. */
const CANDY_COLORS: Record<string, { top: string; bottom: string; border: string; glow: string }> = {
  O: { top: "#ffe66d", bottom: "#f9b932", border: "#d98c16", glow: "#fff3b0" }, // 柠檬布丁
  I: { top: "#7ce7ff", bottom: "#2bbbe6", border: "#188cb8", glow: "#ccf5ff" }, // 苏打汽水
  S: { top: "#82f0b5", bottom: "#32c47c", border: "#1e935a", glow: "#d2fce6" }, // 薄荷哈密瓜
  Z: { top: "#ff8fab", bottom: "#f24c7c", border: "#c72c5b", glow: "#ffd6e0" }, // 草莓果酱
  L: { top: "#ffbc75", bottom: "#f57f36", border: "#c85b18", glow: "#ffe2c2" }, // 蜜桃软糖
  J: { top: "#95b2ff", bottom: "#5679f5", border: "#3553c4", glow: "#d8e3ff" }, // 蓝莓果冻
  T: { top: "#d8a8ff", bottom: "#a15ef5", border: "#7638c7", glow: "#f0dcff" }, // 香芋慕斯
  P: { top: "#fff2cb", bottom: "#d95862", border: "#a92137", glow: "#ffd7dc" },
  X: { top: "#cfa684", bottom: "#9c704c", border: "#6e4a2e", glow: "#ebd5c3" }  // 焦糖饼干干扰块
};

const PREVIEW_SHAPES: Record<CandyPieceType, number[][]> = {
  O: [[1, 1], [1, 1]],
  I: [[1, 1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  P: [[0, 1, 0], [1, 1, 1], [0, 1, 0]]
};

interface SprinkleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  ttl: number;
  maxTtl: number;
  rot: number;
  spin: number;
}

interface PopCallout {
  x: number;
  y: number;
  text: string;
  color: string;
  ttl: number;
  maxTtl: number;
}

interface CandyProjectile {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  amount: number;
  progress: number; // 0..1
}

/** 零外部素材 Web Audio 合成清脆木琴与泡泡音效 */
class CandyAudio {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private xylophone(ctx: AudioContext, freq: number, start: number, dur = 0.16, vol = 0.14) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.01);
  }

  play(sound: CandyStackScene["lastSound"]) {
    if (sound === "none") return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (sound === "move") {
      this.xylophone(ctx, 520, now, 0.05, 0.05);
      return;
    }
    if (sound === "rotate") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.07);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
      return;
    }
    if (sound === "lock") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }
    if (sound === "clear") {
      [523.25, 659.25, 783.99].forEach((f, i) => this.xylophone(ctx, f, now + i * 0.05, 0.18, 0.15));
      return;
    }
    if (sound === "combo") {
      [587.33, 739.99, 880, 1174.66].forEach((f, i) => this.xylophone(ctx, f, now + i * 0.045, 0.2, 0.15));
      return;
    }
    if (sound === "attack") {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.xylophone(ctx, f, now + i * 0.04, 0.22, 0.16));
      return;
    }
    if (sound === "fever") {
      [659.25, 783.99, 987.77, 1318.51].forEach((f, i) => this.xylophone(ctx, f, now + i * 0.06, 0.24, 0.15));
      return;
    }
    if (sound === "ko") {
      [523.25, 440, 349.23, 261.63].forEach((f, i) => this.xylophone(ctx, f, now + i * 0.08, 0.25, 0.15));
    }
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** 绘制圆角半透明「果冻软糖方块」（带左上角白色月牙高光与柔影） */
function drawJellyCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, type: string, alpha = 1) {
  const palette = CANDY_COLORS[type] ?? CANDY_COLORS.X;
  const pad = 1.6;
  const rx = x + pad;
  const ry = y + pad;
  const rw = size - pad * 2;
  const rh = size - pad * 2;
  const r = Math.max(4, size * 0.28);

  ctx.save();
  ctx.globalAlpha = alpha;

  // 底部柔和阴影
  roundedRect(ctx, rx, ry + 2, rw, rh, r);
  ctx.fillStyle = "rgba(120, 82, 58, 0.18)";
  ctx.fill();

  // 果冻主体渐变
  const grad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
  grad.addColorStop(0, palette.top);
  grad.addColorStop(1, palette.bottom);
  roundedRect(ctx, rx, ry, rw, rh, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // 柔润外描边
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 内层果冻高光膜
  roundedRect(ctx, rx + 2.5, ry + 2.5, rw - 5, rh * 0.48, r * 0.65);
  ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
  ctx.fill();

  // 左上角白色月牙高光
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.ellipse(rx + rw * 0.29, ry + rh * 0.27, rw * 0.17, rh * 0.09, -0.55, 0, Math.PI * 2);
  ctx.fill();

  // 焦糖饼干干扰块加上小饼干孔洞点缀
  if (type === "X") {
    ctx.fillStyle = "rgba(92, 56, 30, 0.45)";
    ctx.beginPath();
    ctx.arc(rx + rw * 0.35, ry + rh * 0.62, 1.6, 0, Math.PI * 2);
    ctx.arc(rx + rw * 0.65, ry + rh * 0.62, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** 绘制暖奶油色斜条纹甜品桌布 + 柔和粉彩糖果气泡背景 */
function drawBakeryBackground(ctx: CanvasRenderingContext2D, elapsedMs: number, fever: boolean) {
  ctx.fillStyle = fever ? "#fff0f5" : "#fff8ee";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 暖奶油斜条纹桌布
  ctx.save();
  ctx.fillStyle = fever ? "rgba(255, 182, 206, 0.22)" : "rgba(255, 224, 184, 0.34)";
  const stripeW = 38;
  const shift = (elapsedMs * (fever ? 0.035 : 0.012)) % (stripeW * 2);
  for (let x = -CANVAS_H - stripeW * 2; x < CANVAS_W + CANVAS_H; x += stripeW * 2) {
    ctx.beginPath();
    ctx.moveTo(x + shift, 0);
    ctx.lineTo(x + shift + stripeW, 0);
    ctx.lineTo(x + shift + stripeW - CANVAS_H * 0.55, CANVAS_H);
    ctx.lineTo(x + shift - CANVAS_H * 0.55, CANVAS_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 漂浮的柔和粉彩糖果气泡
  const bubbleColors = ["#ffc8dd", "#bde0fe", "#caffbf", "#fdffb6", "#e7c6ff", "#ffd6a5"];
  for (let i = 0; i < 16; i++) {
    const bx = ((i * 97 + 45) % (CANVAS_W - 60)) + 30 + Math.sin(elapsedMs / 900 + i) * 14;
    const speed = (fever ? 38 : 18) + (i % 4) * 6;
    const by = CANVAS_H + 30 - (((elapsedMs / 1000) * speed + i * 71) % (CANVAS_H + 80));
    const br = 14 + (i % 4) * 7;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = bubbleColors[i % bubbleColors.length];
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(bx - br * 0.32, by - br * 0.32, br * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 绘制单块马卡龙圆角瓷白立体烤盘 */
function drawCandyBoard(
  ctx: CanvasRenderingContext2D,
  board: CandyBoardView,
  originX: number,
  originY: number,
  squashT: number,
  shakeT: number,
  teamLabel: string,
  playerLabel: string
) {
  const isBlue = board.side === 0;
  const accent = isBlue ? "#38bdf8" : "#f97316";
  const softBg = isBlue ? "#f0f9ff" : "#fff4eb";
  const gridLine = isBlue ? "rgba(56, 189, 248, 0.14)" : "rgba(249, 115, 22, 0.14)";

  ctx.save();
  // 落地 Q 弹压扁回弹 + 挨打上顶微抖
  const bounce = squashT > 0 ? Math.sin(squashT * Math.PI) : 0;
  const scaleX = 1 + bounce * 0.032;
  const scaleY = 1 - bounce * 0.032;
  const shakeY = shakeT > 0 ? -Math.sin(shakeT * Math.PI * 3) * 8 * shakeT : 0;

  const cx = originX + BOARD_W / 2;
  const bottomY = originY + BOARD_H;
  ctx.translate(cx, bottomY + shakeY);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-cx, -bottomY);

  // 瓷白立体外阴影与外框
  roundedRect(ctx, originX - 12, originY - 12, BOARD_W + 24, BOARD_H + 24, 22);
  ctx.fillStyle = "rgba(138, 101, 74, 0.18)";
  ctx.fill();

  roundedRect(ctx, originX - 12, originY - 16, BOARD_W + 24, BOARD_H + 24, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.stroke();

  // 柔和浅色奶油烤盘底色
  roundedRect(ctx, originX, originY, BOARD_W, BOARD_H, 12);
  ctx.fillStyle = softBg;
  ctx.fill();

  // 细格子参考线
  ctx.strokeStyle = gridLine;
  ctx.lineWidth = 1;
  for (let c = 1; c < CANDY_COLUMNS; c++) {
    ctx.beginPath();
    ctx.moveTo(originX + c * CELL, originY);
    ctx.lineTo(originX + c * CELL, originY + BOARD_H);
    ctx.stroke();
  }
  for (let r = 1; r < CANDY_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(originX, originY + r * CELL);
    ctx.lineTo(originX + BOARD_W, originY + r * CELL);
    ctx.stroke();
  }

  // 已锁定的果冻软糖与焦糖干扰块
  for (let r = 0; r < CANDY_ROWS; r++) {
    for (let c = 0; c < CANDY_COLUMNS; c++) {
      const ch = board.grid[r * CANDY_COLUMNS + c];
      if (ch && ch !== ".") {
        drawJellyCell(ctx, originX + c * CELL, originY + r * CELL, CELL, ch, 1);
      }
    }
  }

  // 幽灵落点虚线预览（Ghost Piece）与当前下落软糖
  if (board.alive && board.piece) {
    const { shape, x, y, ghostY, type } = board.piece;
    const ghostColor = (CANDY_COLORS[type] ?? CANDY_COLORS.I).border;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const gx = x + c;
        const gy = ghostY + r;
        if (gy >= 0 && gy < CANDY_ROWS) {
          ctx.save();
          roundedRect(ctx, originX + gx * CELL + 3, originY + gy * CELL + 3, CELL - 6, CELL - 6, 7);
          ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
          ctx.fill();
          ctx.strokeStyle = ghostColor;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const gx = x + c;
        const gy = y + r;
        if (gy >= 0 && gy < CANDY_ROWS) {
          drawJellyCell(ctx, originX + gx * CELL, originY + gy * CELL, CELL, type, 1);
        }
      }
    }
  }

  // 顶部阵营马卡龙徽章
  roundedRect(ctx, originX + 26, originY - 36, BOARD_W - 52, 30, 15);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 15px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${teamLabel} · ${playerLabel}`, originX + BOARD_W / 2, originY - 21);

  // 淘汰糖霜遮罩
  if (!board.alive) {
    roundedRect(ctx, originX, originY, BOARD_W, BOARD_H, 12);
    ctx.fillStyle = "rgba(255, 245, 248, 0.72)";
    ctx.fill();
    ctx.fillStyle = "#e11d48";
    ctx.font = "900 32px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("甜品滿出來啦!", originX + BOARD_W / 2, originY + BOARD_H / 2);
  }

  ctx.restore();
}

/** 绘制中央「下一個軟糖」马卡龙瓷碟预览 */
function drawNextPreview(ctx: CanvasRenderingContext2D, type: CandyPieceType, cx: number, cy: number, title: string, accent: string) {
  const w = 128;
  const h = 104;
  roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 18);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = "800 13px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, cx, cy - h / 2 + 18);

  const shape = PREVIEW_SHAPES[type];
  const cellSize = 21;
  const pw = shape[0].length * cellSize;
  const ph = shape.length * cellSize;
  const startX = cx - pw / 2;
  const startY = cy + 8 - ph / 2;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        drawJellyCell(ctx, startX + c * cellSize, startY + r * cellSize, cellSize, type, 1);
      }
    }
  }
}

function labelForSide(side: number, members: SideMember[]) {
  const m = members.find(item => item.side === side);
  return m ? `P${m.position} ${m.name}` : side === 0 ? "P1" : "P2";
}

export function CandyStackCanvas({ scene, members }: { scene: CandyStackScene; members: SideMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<CandyAudio | null>(null);
  const particlesRef = useRef<SprinkleParticle[]>([]);
  const calloutsRef = useRef<PopCallout[]>([]);
  const projectilesRef = useRef<CandyProjectile[]>([]);
  const squashRef = useRef<[number, number]>([0, 0]);
  const shakeRef = useRef<[number, number]>([0, 0]);
  const seenRef = useRef({
    soundSeq: scene.soundSeq,
    attackSeq: scene.lastAttack?.seq ?? 0,
    lockSeq: [scene.boards[0].lastLockSeq, scene.boards[1].lastLockSeq],
    clearSeq: [scene.boards[0].lastClearSeq, scene.boards[1].lastClearSeq],
    garbageSeq: [scene.boards[0].lastGarbageSeq, scene.boards[1].lastGarbageSeq],
    lastTime: 0
  });
  const [muted, setMuted] = useState(false);

  if (!audioRef.current) audioRef.current = new CandyAudio();
  audioRef.current.muted = muted;

  // 触发音频、粒子、波普字效、落地 Q 弹与糖果炮弹事件
  useEffect(() => {
    const seen = seenRef.current;
    if (scene.soundSeq > seen.soundSeq) {
      audioRef.current?.play(scene.lastSound);
      seen.soundSeq = scene.soundSeq;
    }

    const sprinklePalette = ["#ff6b8b", "#ffd447", "#4fd1f5", "#5ee3a1", "#ffa057", "#c58aff"];
    scene.boards.forEach((board, idx) => {
      const ox = idx === 0 ? LEFT_BOARD_X : RIGHT_BOARD_X;
      if (board.lastLockSeq > seen.lockSeq[idx]) {
        seen.lockSeq[idx] = board.lastLockSeq;
        squashRef.current[idx] = 1;
      }
      if (board.lastGarbageSeq > seen.garbageSeq[idx]) {
        seen.garbageSeq[idx] = board.lastGarbageSeq;
        shakeRef.current[idx] = 1;
      }
      if (board.lastClearSeq > seen.clearSeq[idx]) {
        seen.clearSeq[idx] = board.lastClearSeq;
        const rows = board.lastClearRows.length ? board.lastClearRows : [CANDY_ROWS - 1];
        for (const row of rows) {
          for (let p = 0; p < 16; p++) {
            particlesRef.current.push({
              x: ox + ((p + 0.5) / 16) * BOARD_W,
              y: BOARD_Y + row * CELL + CELL / 2,
              vx: (Math.random() - 0.5) * 320,
              vy: -120 - Math.random() * 210,
              size: 4 + Math.random() * 5,
              color: sprinklePalette[p % sprinklePalette.length],
              ttl: 0.65,
              maxTtl: 0.65,
              rot: Math.random() * Math.PI,
              spin: (Math.random() - 0.5) * 10
            });
          }
        }
        const label = board.lastClearCount >= 4
          ? "甜蜜大爆發!!"
          : board.lastClearCount === 3
            ? "超甜三連!"
            : board.lastClearCount === 2
              ? "雙倍甜蜜!"
              : board.combo >= 2
                ? `超甜連擊 ×${board.combo}!`
                : "NICE!";
        calloutsRef.current.push({
          x: ox + BOARD_W / 2,
          y: BOARD_Y + Math.max(4, rows[0]) * CELL,
          text: label,
          color: idx === 0 ? "#0284c7" : "#e11d48",
          ttl: 0.95,
          maxTtl: 0.95
        });
      }
    });

    if (scene.lastAttack && scene.lastAttack.seq > seen.attackSeq) {
      seen.attackSeq = scene.lastAttack.seq;
      const fromX = scene.lastAttack.fromSide === 0 ? LEFT_BOARD_X + BOARD_W / 2 : RIGHT_BOARD_X + BOARD_W / 2;
      const toX = scene.lastAttack.toSide === 0 ? LEFT_BOARD_X + BOARD_W / 2 : RIGHT_BOARD_X + BOARD_W / 2;
      projectilesRef.current.push({
        fromX,
        fromY: BOARD_Y + BOARD_H * 0.45,
        toX,
        toY: BOARD_Y + BOARD_H - 36,
        color: scene.lastAttack.fromSide === 0 ? "#38bdf8" : "#ff6b8b",
        amount: scene.lastAttack.amount,
        progress: 0
      });
    }
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== CANVAS_W * dpr || canvas.height !== CANVAS_H * dpr) {
      canvas.width = CANVAS_W * dpr;
      canvas.height = CANVAS_H * dpr;
    }

    const now = performance.now();
    const dt = seenRef.current.lastTime > 0 ? Math.min(0.06, (now - seenRef.current.lastTime) / 1000) : 0.02;
    seenRef.current.lastTime = now;

    // 衰减 Q 弹与抖动
    for (let i = 0; i < 2; i++) {
      squashRef.current[i] = Math.max(0, squashRef.current[i] - dt * 5.2);
      shakeRef.current[i] = Math.max(0, shakeRef.current[i] - dt * 3.6);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. 暖奶油甜品桌布 + 粉彩糖果气泡背景
    drawBakeryBackground(ctx, scene.elapsedMs, scene.fever);

    // 2. 左右双瓷白马卡龙烤盘
    drawCandyBoard(
      ctx,
      scene.boards[0],
      LEFT_BOARD_X,
      BOARD_Y,
      squashRef.current[0],
      shakeRef.current[0],
      "藍方",
      labelForSide(0, members)
    );
    drawCandyBoard(
      ctx,
      scene.boards[1],
      RIGHT_BOARD_X,
      BOARD_Y,
      squashRef.current[1],
      shakeRef.current[1],
      "橙方",
      labelForSide(1, members)
    );

    // 3. 中央甜品工坊信息区（双 NEXT 预览碟 + 狂热徽章 + 互攻规则）
    const midX = CANVAS_W / 2;
    drawNextPreview(ctx, scene.boards[0].nextType, midX - 72, 168, "藍方下一塊", "#38bdf8");
    drawNextPreview(ctx, scene.boards[1].nextType, midX + 72, 168, "橙方下一塊", "#f97316");

    // 中央大 VS / 甜蜜狂热徽章
    roundedRect(ctx, midX - 110, 268, 220, 92, 24);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = scene.fever ? "#ff6b8b" : "#f59e0b";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = scene.fever ? "#e11d48" : "#d97706";
    ctx.font = "900 22px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.fillText(scene.fever ? "甜蜜狂熱 1.5×" : "1v1 糖果互攻", midX, 300);

    ctx.fillStyle = "#785842";
    ctx.font = "700 14px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.fillText("消 2 行以上發射糖果炮彈!", midX, 334);

    // 双方连击 & 消行小徽章
    [0, 1].forEach(side => {
      const b = scene.boards[side];
      const bx = midX + (side === 0 ? -72 : 72);
      const accent = side === 0 ? "#0284c7" : "#e11d48";
      roundedRect(ctx, bx - 64, 392, 128, 86, 18);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = side === 0 ? "#7dd3fc" : "#fda4af";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#8a654a";
      ctx.font = "700 13px 'Microsoft YaHei', system-ui, sans-serif";
      ctx.fillText(`消行 ${b.lines}`, bx, 418);
      ctx.fillStyle = accent;
      ctx.font = "900 20px 'Microsoft YaHei', system-ui, sans-serif";
      ctx.fillText(b.combo >= 2 ? `連消 ×${b.combo}` : `${b.score} 分`, bx, 450);
    });

    // 4. 彩色糖豆消行粒子
    const particles = particlesRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 520 * dt;
      p.rot += p.spin * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.ttl / p.maxTtl);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      roundedRect(ctx, -p.size, -p.size * 0.65, p.size * 2, p.size * 1.3, p.size * 0.6);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // 5. 发光糖果炮弹抛物线动画
    const projs = projectilesRef.current;
    for (let i = projs.length - 1; i >= 0; i--) {
      const proj = projs[i];
      proj.progress += dt * 2.2;
      if (proj.progress >= 1) {
        projs.splice(i, 1);
        continue;
      }
      const t = proj.progress;
      const px = proj.fromX + (proj.toX - proj.fromX) * t;
      const py = proj.fromY + (proj.toY - proj.fromY) * t - Math.sin(t * Math.PI) * 195;
      ctx.save();
      ctx.shadowColor = proj.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 14px 'Microsoft YaHei', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${proj.amount}`, px, py + 1);
      ctx.restore();
    }

    // 6. 波普漫画字效
    const callouts = calloutsRef.current;
    for (let i = callouts.length - 1; i >= 0; i--) {
      const c = callouts[i];
      c.ttl -= dt;
      if (c.ttl <= 0) {
        callouts.splice(i, 1);
        continue;
      }
      const prog = 1 - c.ttl / c.maxTtl;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (c.ttl / c.maxTtl) * 1.6);
      ctx.font = "900 28px 'Microsoft YaHei', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText(c.text, c.x, c.y - prog * 42);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y - prog * 42);
      ctx.restore();
    }

    ctx.restore();
  }, [scene, members]);

  return (
    <div className="candy-stage">
      <div className="candy-hud">
        <div className="candy-team blue">
          <span className="candy-pill blue">藍方</span>
          <strong className="candy-score">{scene.scores[0]}</strong>
        </div>

        <div className="candy-hud-center">
          <span className={"candy-mode-tag" + (scene.fever ? " fever" : "")}>
            {scene.fever ? "甜蜜狂熱加速中 · 1.5× 分" : "馬卡龍消行工坊 · 1v1"}
          </span>
          <button
            type="button"
            className="candy-mute"
            aria-label={muted ? "開啟木琴音效" : "靜音"}
            onClick={() => setMuted(v => !v)}
          >
            {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          </button>
        </div>

        <div className="candy-team orange">
          <strong className="candy-score">{scene.scores[1]}</strong>
          <span className="candy-pill">橙方</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="candy-canvas"
        aria-label="馬卡龍消行工坊即時對戰"
      />
    </div>
  );
}
