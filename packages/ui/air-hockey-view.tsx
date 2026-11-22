import { useEffect, useRef, useState } from "react";
import { Lightning, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { AirHockeyPaddle, AirHockeyScene, Member } from "../shared/protocol";

type SideMember = Pick<Member, "id" | "name" | "position" | "side">;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface NeonTheme {
  bgOuter: string;
  bgInner: string;
  grid: string;
  centerLine: string;
  borderLeft: string;
  borderRight: string;
  overdriveFrame: string;
}

const THEMES: Record<AirHockeyScene["theme"], NeonTheme> = {
  cyber: {
    bgOuter: "#050b18",
    bgInner: "#0b1933",
    grid: "rgba(56, 189, 248, 0.08)",
    centerLine: "rgba(148, 163, 184, 0.35)",
    borderLeft: "#00e5ff",
    borderRight: "#ff7b00",
    overdriveFrame: "#facc15"
  },
  synth: {
    bgOuter: "#0c071c",
    bgInner: "#181036",
    grid: "rgba(167, 139, 250, 0.09)",
    centerLine: "rgba(196, 181, 253, 0.32)",
    borderLeft: "#38bdf8",
    borderRight: "#fb7185",
    overdriveFrame: "#fde047"
  },
  laser: {
    bgOuter: "#04131c",
    bgInner: "#0a2736",
    grid: "rgba(45, 212, 191, 0.08)",
    centerLine: "rgba(94, 234, 212, 0.3)",
    borderLeft: "#22d3ee",
    borderRight: "#f97316",
    overdriveFrame: "#fbbf24"
  },
  hyper: {
    bgOuter: "#090a1a",
    bgInner: "#131b3a",
    grid: "rgba(96, 165, 250, 0.09)",
    centerLine: "rgba(147, 197, 253, 0.35)",
    borderLeft: "#0ea5e9",
    borderRight: "#ec4899",
    overdriveFrame: "#f59e0b"
  }
};

// 玩家 1（左/电光蓝青）与玩家 2（右/烈焰橙红）区分配色
const PADDLE_PALETTES = [
  [
    { core: "#1d4ed8", ring: "#00e5ff", glow: "rgba(0, 229, 255, 0.58)", inner: "#dbeafe" },
    { core: "#0f766e", ring: "#2dd4bf", glow: "rgba(45, 212, 191, 0.54)", inner: "#ccfbf1" }
  ],
  [
    { core: "#ea580c", ring: "#ff9e2c", glow: "rgba(255, 138, 0, 0.6)", inner: "#ffedd5" },
    { core: "#be123c", ring: "#ff3b82", glow: "rgba(255, 59, 130, 0.56)", inner: "#ffe4e6" }
  ]
] as const;

/** 基于 Web Audio API 零素材合成霓虹气垫球音效 */
class AirHockeySynth {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock() {
    if (this.muted) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!this.ctx) this.ctx = new Ctor();
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    } catch {
      // 浏览器禁用音频时不阻塞渲染
    }
  }

  private beep(freqStart: number, freqEnd: number, duration: number, type: OscillatorType, gainLevel: number, delay = 0) {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + duration);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(gainLevel, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch {
      // 忽略瞬时音频节点异常
    }
  }

  playHit(speed: number) {
    const boost = Math.min(220, speed * 0.16);
    this.beep(320 + boost, 130, 0.085, "triangle", 0.16);
  }

  playWall() {
    this.beep(210, 110, 0.055, "sine", 0.1);
  }

  playOverdrive() {
    this.beep(440, 880, 0.14, "sawtooth", 0.1, 0);
    this.beep(587, 1175, 0.18, "sawtooth", 0.12, 0.11);
  }

  playGoal() {
    this.beep(523.25, 523.25, 0.12, "triangle", 0.15, 0);
    this.beep(659.25, 659.25, 0.12, "triangle", 0.15, 0.09);
    this.beep(783.99, 1046.5, 0.28, "triangle", 0.18, 0.18);
  }

  dispose() {
    try {
      void this.ctx?.close().catch(() => {});
    } catch {
      // 忽略关闭异常
    }
    this.ctx = null;
  }
}

/** 轻量级 60fps 客户端坐标外推，保证 80ms 同步间隔下冰球与球拍依旧丝滑 */
function predictScene(scene: AirHockeyScene, elapsedMs: number): AirHockeyScene {
  if (scene.frozen) return scene;
  const dt = Math.min(0.088, Math.max(0, elapsedMs / 1000));
  if (dt <= 0.001) return scene;

  const paddles: AirHockeyPaddle[] = scene.paddles.map(p => {
    const minX = p.side === 0 ? p.radius : scene.width / 2 + p.radius;
    const maxX = p.side === 0 ? scene.width / 2 - p.radius : scene.width - p.radius;
    return {
      ...p,
      x: Math.max(minX, Math.min(maxX, p.x + p.vx * dt)),
      y: Math.max(p.radius, Math.min(scene.height - p.radius, p.y + p.vy * dt))
    };
  });

  let px = scene.puck.x + scene.puck.vx * dt;
  let py = scene.puck.y + scene.puck.vy * dt;
  const pr = scene.puck.radius;
  const inGoal = py >= scene.goalTop + pr * 0.35 && py <= scene.goalBottom - pr * 0.35;
  if (!inGoal) {
    px = Math.max(pr, Math.min(scene.width - pr, px));
  } else {
    px = Math.max(pr * 0.4, Math.min(scene.width - pr * 0.4, px));
  }
  py = Math.max(pr, Math.min(scene.height - pr, py));

  return {
    ...scene,
    paddles,
    puck: { ...scene.puck, x: px, y: py }
  };
}

/** 绘制霓虹发光桌面、激光中线与左右独立色彩球门 */
function drawTable(ctx: CanvasRenderingContext2D, scene: AirHockeyScene, palette: NeonTheme, nowSec: number) {
  const { width: w, height: h, goalTop, goalBottom } = scene;
  const bg = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.66);
  bg.addColorStop(0, palette.bgInner);
  bg.addColorStop(1, palette.bgOuter);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 科技透视底纹网格
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let x = 60; x < w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 60; y < h; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 中心对决线与中心光环
  ctx.save();
  ctx.strokeStyle = scene.overdrive ? "rgba(250, 204, 21, 0.45)" : palette.centerLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 16);
  ctx.lineTo(w / 2, h - 16);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
  ctx.fillStyle = scene.overdrive ? palette.overdriveFrame : palette.centerLine;
  ctx.fill();
  ctx.restore();

  // 左右两侧专属发光禁区半圆与球门
  const goalCenterY = (goalTop + goalBottom) / 2;
  const goalRadius = (goalBottom - goalTop) / 2;

  // 左半场玩家 1 守门区
  ctx.save();
  ctx.strokeStyle = palette.borderLeft;
  ctx.shadowColor = palette.borderLeft;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, goalCenterY, goalRadius + 24, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  // 左球门激光门框
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(3, goalTop);
  ctx.lineTo(3, goalBottom);
  ctx.stroke();
  ctx.restore();

  // 右半场玩家 2 守门区
  ctx.save();
  ctx.strokeStyle = palette.borderRight;
  ctx.shadowColor = palette.borderRight;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w, goalCenterY, goalRadius + 24, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();

  // 右球门激光门框
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(w - 3, goalTop);
  ctx.lineTo(w - 3, goalBottom);
  ctx.stroke();
  ctx.restore();

  // 左右分区发光护栏
  const pulse = scene.overdrive ? 0.65 + 0.35 * Math.sin(nowSec * 9) : 1;
  ctx.save();
  ctx.lineWidth = 5;
  ctx.globalAlpha = pulse;

  // 左侧玩家 1 边框
  ctx.strokeStyle = scene.overdrive ? palette.overdriveFrame : palette.borderLeft;
  ctx.shadowColor = scene.overdrive ? palette.overdriveFrame : palette.borderLeft;
  ctx.shadowBlur = scene.overdrive ? 20 : 12;
  ctx.beginPath();
  ctx.moveTo(w / 2, 4);
  ctx.lineTo(14, 4);
  ctx.lineTo(4, 14);
  ctx.lineTo(4, goalTop);
  ctx.moveTo(4, goalBottom);
  ctx.lineTo(4, h - 14);
  ctx.lineTo(14, h - 4);
  ctx.lineTo(w / 2, h - 4);
  ctx.stroke();

  // 右侧玩家 2 边框
  ctx.strokeStyle = scene.overdrive ? palette.overdriveFrame : palette.borderRight;
  ctx.shadowColor = scene.overdrive ? palette.overdriveFrame : palette.borderRight;
  ctx.beginPath();
  ctx.moveTo(w / 2, 4);
  ctx.lineTo(w - 14, 4);
  ctx.lineTo(w - 4, 14);
  ctx.lineTo(w - 4, goalTop);
  ctx.moveTo(w - 4, goalBottom);
  ctx.lineTo(w - 4, h - 14);
  ctx.lineTo(w - 14, h - 4);
  ctx.lineTo(w / 2, h - 4);
  ctx.stroke();
  ctx.restore();
}

/** 绘制立体双环霓虹球拍与玩家身份标注 */
function drawPaddle(ctx: CanvasRenderingContext2D, paddle: AirHockeyPaddle, label: string) {
  const pal = PADDLE_PALETTES[paddle.side % 2][paddle.slot % 2];
  const { x, y, radius: r } = paddle;

  ctx.save();
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 22;

  const outerGrad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
  outerGrad.addColorStop(0, pal.inner);
  outerGrad.addColorStop(0.55, pal.core);
  outerGrad.addColorStop(1, "#090f1e");

  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = pal.ring;
  ctx.stroke();

  // 中央立体握柄环
  ctx.fillStyle = "rgba(8, 15, 32, 0.86)";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.ring;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(r * 0.38)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 1);
  ctx.restore();
}

/** 绘制发光冰球与加速流光尾迹 */
function drawPuck(
  ctx: CanvasRenderingContext2D,
  scene: AirHockeyScene,
  trail: { x: number; y: number }[]
) {
  const { puck, overdrive } = scene;

  for (let i = 0; i < trail.length; i++) {
    const pt = trail[i];
    const ratio = (i + 1) / (trail.length + 1);
    ctx.fillStyle = overdrive
      ? `rgba(250, 204, 21, ${ratio * 0.42})`
      : `rgba(186, 230, 253, ${ratio * 0.28})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, puck.radius * ratio * 0.88, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.shadowColor = overdrive ? "rgba(250, 204, 21, 0.85)" : "rgba(255, 255, 255, 0.65)";
  ctx.shadowBlur = overdrive ? 26 : 16;

  const grad = ctx.createRadialGradient(
    puck.x - puck.radius * 0.28,
    puck.y - puck.radius * 0.28,
    puck.radius * 0.1,
    puck.x,
    puck.y,
    puck.radius
  );
  if (overdrive) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "#fde047");
    grad.addColorStop(1, "#a855f7");
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.65, "#bae6fd");
    grad.addColorStop(1, "#0284c7");
  }

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = overdrive ? "#fef08a" : "#e0f2fe";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.radius * 0.45, 0, Math.PI * 2);
  ctx.strokeStyle = overdrive ? "rgba(168, 85, 247, 0.55)" : "rgba(14, 165, 233, 0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export function AirHockeyCanvas({ scene, members }: { scene: AirHockeyScene; members: SideMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const synthRef = useRef<AirHockeySynth | null>(null);
  const [muted, setMuted] = useState(false);

  const latestRef = useRef<{ scene: AirHockeyScene; receivedAt: number }>({
    scene,
    receivedAt: performance.now()
  });
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const prevRef = useRef({
    roundSeq: scene.roundSeq,
    hitSeq: scene.hitSeq,
    wallSeq: scene.wallSeq,
    overdrive: scene.overdrive,
    scores: [scene.scores[0], scene.scores[1]] as [number, number]
  });
  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const synth = new AirHockeySynth();
    synthRef.current = synth;
    const unlock = () => synth.unlock();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      synth.dispose();
      synthRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (synthRef.current) synthRef.current.muted = muted;
  }, [muted]);

  // 监听服务端事件变化并驱动 Web Audio 合成音效与火花特效
  useEffect(() => {
    const now = performance.now();
    const prev = prevRef.current;
    const synth = synthRef.current;

    if (scene.roundSeq !== prev.roundSeq) {
      trailRef.current = [];
    }

    if (scene.overdrive && !prev.overdrive) {
      synth?.playOverdrive();
      ripplesRef.current.push({
        x: scene.width / 2,
        y: scene.height / 2,
        radius: 20,
        maxRadius: 240,
        life: 0,
        maxLife: 0.55,
        color: "#fde047"
      });
    }

    if (scene.hitSeq > prev.hitSeq) {
      const speed = Math.hypot(scene.puck.vx, scene.puck.vy);
      synth?.playHit(speed);
      const color = scene.puck.x < scene.width / 2 ? "#00e5ff" : "#ff9e2c";
      ripplesRef.current.push({
        x: scene.puck.x,
        y: scene.puck.y,
        radius: scene.puck.radius * 0.9,
        maxRadius: scene.puck.radius * 3,
        life: 0,
        maxLife: 0.28,
        color
      });
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
        const pSpeed = 110 + Math.random() * 170;
        particlesRef.current.push({
          x: scene.puck.x,
          y: scene.puck.y,
          vx: Math.cos(angle) * pSpeed,
          vy: Math.sin(angle) * pSpeed,
          life: 0,
          maxLife: 0.3 + Math.random() * 0.14,
          radius: 2.5 + Math.random() * 2.5,
          color
        });
      }
    } else if (scene.wallSeq > prev.wallSeq) {
      synth?.playWall();
      ripplesRef.current.push({
        x: scene.puck.x,
        y: scene.puck.y,
        radius: scene.puck.radius * 0.8,
        maxRadius: scene.puck.radius * 2.2,
        life: 0,
        maxLife: 0.22,
        color: "#e2e8f0"
      });
    }

    if (scene.scores[0] > prev.scores[0] || scene.scores[1] > prev.scores[1]) {
      synth?.playGoal();
      const goalColor = scene.lastScorer === 0 ? "#00e5ff" : "#ff7b00";
      const gx = scene.lastScorer === 0 ? scene.width - 12 : 12;
      const gy = scene.puck.y;
      ripplesRef.current.push({
        x: gx,
        y: gy,
        radius: 18,
        maxRadius: 150,
        life: 0,
        maxLife: 0.6,
        color: goalColor
      });
      for (let i = 0; i < 20; i++) {
        const angle = (scene.lastScorer === 0 ? Math.PI : 0) + (Math.random() - 0.5) * Math.PI * 0.9;
        const gSpeed = 160 + Math.random() * 280;
        particlesRef.current.push({
          x: gx,
          y: gy,
          vx: Math.cos(angle) * gSpeed,
          vy: Math.sin(angle) * gSpeed,
          life: 0,
          maxLife: 0.55 + Math.random() * 0.25,
          radius: 3 + Math.random() * 3.5,
          color: goalColor
        });
      }
    }

    prevRef.current = {
      roundSeq: scene.roundSeq,
      hitSeq: scene.hitSeq,
      wallSeq: scene.wallSeq,
      overdrive: scene.overdrive,
      scores: [scene.scores[0], scene.scores[1]]
    };
    latestRef.current = { scene, receivedAt: now };
  }, [scene]);

  useEffect(() => {
    let rafId = 0;
    let lastFrame = performance.now();

    const render = (now: number) => {
      const frameDt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;
      const canvas = canvasRef.current;

      if (canvas) {
        const ctx = canvas.getContext("2d");
        const snap = latestRef.current;
        const predicted = predictScene(snap.scene, now - snap.receivedAt);

        if (ctx) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const rect = canvas.getBoundingClientRect();
          const targetW = Math.max(600, Math.round(rect.width * dpr));
          const targetH = Math.max(300, Math.round((rect.width / 2) * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          ctx.save();
          ctx.scale(canvas.width / predicted.width, canvas.height / predicted.height);

          drawTable(ctx, predicted, THEMES[predicted.theme], now / 1000);

          if (!predicted.frozen) {
            trailRef.current.push({ x: predicted.puck.x, y: predicted.puck.y });
            if (trailRef.current.length > 8) trailRef.current.shift();
          }

          drawPuck(ctx, predicted, trailRef.current);

          const sideMembers = [
            membersRef.current.filter(m => m.side === 0),
            membersRef.current.filter(m => m.side === 1)
          ];
          for (const paddle of predicted.paddles) {
            const member = sideMembers[paddle.side]?.[paddle.slot];
            const label = member ? `P${member.position}` : predicted.paddles.length <= 2
              ? (paddle.side === 0 ? "P1" : "P2")
              : `${paddle.side === 0 ? "1" : "2"}-${paddle.slot + 1}`;
            drawPaddle(ctx, paddle, label);
          }

          ripplesRef.current = ripplesRef.current.filter(rp => {
            rp.life += frameDt;
            const progress = rp.life / rp.maxLife;
            if (progress >= 1) return false;
            const r = rp.radius + (rp.maxRadius - rp.radius) * progress;
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.strokeStyle = rp.color;
            ctx.lineWidth = 3 * (1 - progress * 0.4);
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            return true;
          });

          particlesRef.current = particlesRef.current.filter(pt => {
            pt.life += frameDt;
            const progress = pt.life / pt.maxLife;
            if (progress >= 1) return false;
            pt.x += pt.vx * frameDt;
            pt.y += pt.vy * frameDt;
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.radius * (1 - progress * 0.4), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return true;
          });

          if (predicted.frozen && predicted.lastScorer !== null) {
            const label = predicted.lastScorer === 0 ? "藍方進球" : "橙方進球";
            const accent = predicted.lastScorer === 0 ? "#00e5ff" : "#ff7b00";
            ctx.save();
            ctx.font = "700 30px system-ui, sans-serif";
            const boxW = ctx.measureText(label).width + 64;
            const boxX = predicted.width / 2 - boxW / 2;
            const boxY = 44;
            ctx.fillStyle = "rgba(5, 11, 24, 0.84)";
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, 54, 27);
            ctx.fill();
            ctx.strokeStyle = accent;
            ctx.shadowColor = accent;
            ctx.shadowBlur = 16;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, predicted.width / 2, boxY + 27);
            ctx.restore();
          }

          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const leftNames = members.filter(m => m.side === 0).map(m => `P${m.position} ${m.name}`).join(" · ") || "藍方";
  const rightNames = members.filter(m => m.side === 1).map(m => `P${m.position} ${m.name}`).join(" · ") || "橙方";

  return (
    <div className="airhockey-stage">
      <div className="airhockey-hud">
        <div className="airhockey-team left" data-side={0}>
          <div className="airhockey-team-meta">
            <span className="airhockey-names">{leftNames}</span>
            <div className="airhockey-pips" aria-hidden="true">
              {Array.from({ length: scene.winScore }, (_, i) => (
                <i key={i} className={i < scene.scores[0] ? "lit" : ""} />
              ))}
            </div>
          </div>
          <strong className="airhockey-score">{scene.scores[0]}</strong>
        </div>

        <div className="airhockey-center">
          {scene.overdrive ? (
            <span className="airhockey-overdrive"><Lightning size={15} weight="fill" /> 冰球加速</span>
          ) : (
            <span className="airhockey-target">先進 {scene.winScore} 球</span>
          )}
          <button
            type="button"
            className="airhockey-mute"
            aria-label={muted ? "開啟音效" : "靜音"}
            onClick={() => setMuted(prev => !prev)}
          >
            {muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}
          </button>
        </div>

        <div className="airhockey-team right" data-side={1}>
          <strong className="airhockey-score">{scene.scores[1]}</strong>
          <div className="airhockey-team-meta">
            <span className="airhockey-names">{rightNames}</span>
            <div className="airhockey-pips" aria-hidden="true">
              {Array.from({ length: scene.winScore }, (_, i) => (
                <i key={i} className={i < scene.scores[1] ? "lit" : ""} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} className="airhockey-canvas" aria-label="霓虹氣墊球實況畫面" />
    </div>
  );
}
