import { useEffect, useRef } from "react";
import type { Member, VolleyballPlayer, VolleyballScene } from "../shared/protocol";

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

interface ThemePalette {
  sky: [string, string, string];
  celestial: { x: number; y: number; r: number; core: string; halo: string };
  hills: [string, string];
  floorTop: string;
  floorBottom: string;
  floorLine: string;
  netPost: string;
  netCap: string;
  ballCore: string;
  ballEdge: string;
  ballSeam: string;
}

const THEMES: Record<VolleyballScene["theme"], ThemePalette> = {
  sunset: {
    sky: ["#1a1438", "#6d326d", "#f08a5d"],
    celestial: { x: 890, y: 155, r: 64, core: "#ffe6a7", halo: "rgba(255, 198, 122, 0.28)" },
    hills: ["rgba(38, 22, 62, 0.45)", "rgba(23, 18, 48, 0.7)"],
    floorTop: "#272448",
    floorBottom: "#141328",
    floorLine: "rgba(255, 210, 160, 0.36)",
    netPost: "#e9ecf5",
    netCap: "#ffd166",
    ballCore: "#fff9dc",
    ballEdge: "#f4a261",
    ballSeam: "rgba(122, 54, 18, 0.42)"
  },
  lagoon: {
    sky: ["#0b2545", "#134e6f", "#45b7b8"],
    celestial: { x: 260, y: 135, r: 54, core: "#fff7cc", halo: "rgba(170, 246, 235, 0.26)" },
    hills: ["rgba(11, 56, 84, 0.48)", "rgba(8, 38, 60, 0.72)"],
    floorTop: "#133b56",
    floorBottom: "#0a2235",
    floorLine: "rgba(130, 240, 230, 0.35)",
    netPost: "#e6f6fa",
    netCap: "#72efdd",
    ballCore: "#ffffff",
    ballEdge: "#ffd166",
    ballSeam: "rgba(16, 79, 102, 0.38)"
  },
  aurora: {
    sky: ["#081224", "#102c46", "#1d5b66"],
    celestial: { x: 930, y: 130, r: 46, core: "#e0fbfc", halo: "rgba(115, 243, 196, 0.24)" },
    hills: ["rgba(14, 42, 62, 0.52)", "rgba(9, 25, 42, 0.76)"],
    floorTop: "#132942",
    floorBottom: "#091524",
    floorLine: "rgba(115, 243, 196, 0.36)",
    netPost: "#dbeafe",
    netCap: "#73e3b3",
    ballCore: "#f6fff8",
    ballEdge: "#64dfdf",
    ballSeam: "rgba(12, 56, 74, 0.42)"
  },
  arena: {
    sky: ["#10192b", "#1e3254", "#364f7c"],
    celestial: { x: 600, y: 110, r: 78, core: "#eef6ff", halo: "rgba(147, 197, 253, 0.2)" },
    hills: ["rgba(22, 34, 58, 0.5)", "rgba(14, 22, 40, 0.75)"],
    floorTop: "#1f2e4a",
    floorBottom: "#101a2e",
    floorLine: "rgba(191, 219, 254, 0.38)",
    netPost: "#f1f5f9",
    netCap: "#fbbf24",
    ballCore: "#fffbeb",
    ballEdge: "#fb923c",
    ballSeam: "rgba(96, 48, 12, 0.38)"
  }
};

const SLIME_STYLES = [
  [
    { light: "#8be0ff", mid: "#3399ff", dark: "#1752b8", glow: "rgba(51, 153, 255, 0.32)" },
    { light: "#a8fff0", mid: "#2ec4b6", dark: "#0f766e", glow: "rgba(46, 196, 182, 0.3)" }
  ],
  [
    { light: "#ffd39c", mid: "#ff8c3a", dark: "#c2410c", glow: "rgba(255, 140, 58, 0.32)" },
    { light: "#ffc2d4", mid: "#f45b8c", dark: "#9d174d", glow: "rgba(244, 91, 140, 0.3)" }
  ]
] as const;

const FLOOR_RATIO = 0.875;

/** 依据球场物理坐标做轻量 60fps 外推，缓解网络同步间隔 */
function predictScene(scene: VolleyballScene, elapsedMs: number): VolleyballScene {
  if (scene.frozen) return scene;
  const dt = Math.min(0.095, Math.max(0, elapsedMs / 1000));
  if (dt <= 0.001) return scene;

  const halfNet = scene.netWidth / 2;
  const gravity = 2500;

  const players: VolleyballPlayer[] = scene.players.map(player => {
    let x = player.x + player.vx * dt;
    let y = player.y + player.vy * dt + 0.5 * gravity * dt * dt * (player.y < scene.height ? 1 : 0);
    let vy = player.vy + (player.y < scene.height ? gravity * dt : 0);

    if (player.side === 0) {
      x = Math.max(player.radius, Math.min(scene.width / 2 - halfNet - player.radius, x));
    } else {
      x = Math.max(scene.width / 2 + halfNet + player.radius, Math.min(scene.width - player.radius, x));
    }
    if (y > scene.height) {
      y = scene.height;
      vy = 0;
    }
    return { ...player, x, y, vy };
  });

  let bx = scene.ball.x + scene.ball.vx * dt;
  let by = scene.ball.y + scene.ball.vy * dt + 0.5 * gravity * dt * dt;
  if (bx < scene.ball.radius) bx = scene.ball.radius;
  if (bx > scene.width - scene.ball.radius) bx = scene.width - scene.ball.radius;
  if (by > scene.height - scene.ball.radius) by = scene.height - scene.ball.radius;

  return {
    ...scene,
    players,
    ball: { ...scene.ball, x: bx, y: by }
  };
}

/** 绘制柔和云朵与远景流线山峦 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  floorY: number,
  palette: ThemePalette,
  timeSec: number
) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  skyGrad.addColorStop(0, palette.sky[0]);
  skyGrad.addColorStop(0.56, palette.sky[1]);
  skyGrad.addColorStop(1, palette.sky[2]);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, floorY);

  // 太阳或月晕
  const { x: cx, y: cy, r, core, halo } = palette.celestial;
  const haloGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.5);
  haloGrad.addColorStop(0, halo);
  haloGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 缓动矢量云朵
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let i = 0; i < 4; i++) {
    const base = ((i * 340 + timeSec * (10 + i * 3)) % (w + 260)) - 130;
    const cyCloud = 85 + (i % 2) * 58;
    ctx.beginPath();
    ctx.ellipse(base, cyCloud, 72, 20, 0, 0, Math.PI * 2);
    ctx.ellipse(base - 34, cyCloud + 6, 42, 15, 0, 0, Math.PI * 2);
    ctx.ellipse(base + 38, cyCloud + 7, 46, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 远近双层弧形轮廓
  ctx.fillStyle = palette.hills[0];
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.quadraticCurveTo(w * 0.25, floorY - 125, w * 0.52, floorY - 45);
  ctx.quadraticCurveTo(w * 0.8, floorY - 140, w, floorY - 35);
  ctx.lineTo(w, floorY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.hills[1];
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.quadraticCurveTo(w * 0.18, floorY - 58, w * 0.44, floorY - 22);
  ctx.quadraticCurveTo(w * 0.74, floorY - 72, w, floorY - 16);
  ctx.lineTo(w, floorY);
  ctx.closePath();
  ctx.fill();
}

/** 绘制高光质感球场地板与立体球网 */
function drawCourtAndNet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  floorY: number,
  scene: VolleyballScene,
  palette: ThemePalette
) {
  const floorGrad = ctx.createLinearGradient(0, floorY, 0, h);
  floorGrad.addColorStop(0, palette.floorTop);
  floorGrad.addColorStop(1, palette.floorBottom);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorY, w, h - floorY);

  // 左右半场氛围光带
  const leftGlow = ctx.createLinearGradient(0, floorY, w * 0.5, floorY);
  leftGlow.addColorStop(0, "rgba(77, 171, 247, 0.2)");
  leftGlow.addColorStop(1, "rgba(77, 171, 247, 0.03)");
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, floorY, w * 0.5, 10);

  const rightGlow = ctx.createLinearGradient(w * 0.5, floorY, w, floorY);
  rightGlow.addColorStop(0, "rgba(255, 146, 60, 0.03)");
  rightGlow.addColorStop(1, "rgba(255, 146, 60, 0.2)");
  ctx.fillStyle = rightGlow;
  ctx.fillRect(w * 0.5, floorY, w * 0.5, 10);

  ctx.strokeStyle = palette.floorLine;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(w, floorY);
  ctx.stroke();

  // 球网
  const scaleY = floorY / scene.height;
  const netW = scene.netWidth;
  const netH = scene.netHeight * scaleY;
  const netX = w / 2 - netW / 2;
  const netTopY = floorY - netH + netW / 2;

  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.beginPath();
  ctx.ellipse(w / 2, floorY + 8, netW * 1.15, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const postGrad = ctx.createLinearGradient(netX, 0, netX + netW, 0);
  postGrad.addColorStop(0, "rgba(255,255,255,0.68)");
  postGrad.addColorStop(0.45, palette.netPost);
  postGrad.addColorStop(1, "rgba(15, 23, 42, 0.45)");
  ctx.fillStyle = postGrad;
  ctx.fillRect(netX, netTopY, netW, netH - netW / 2);

  // 网面横纹细节
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  for (let y = netTopY + 12; y < floorY - 6; y += 14) {
    ctx.beginPath();
    ctx.moveTo(netX + 2, y);
    ctx.lineTo(netX + netW - 2, y);
    ctx.stroke();
  }

  ctx.fillStyle = palette.netCap;
  ctx.beginPath();
  ctx.arc(w / 2, netTopY, netW / 2, 0, Math.PI * 2);
  ctx.fill();
}

/** 绘制果冻拟态史莱姆与盯球眼睛 */
function drawSlime(
  ctx: CanvasRenderingContext2D,
  player: VolleyballPlayer,
  ball: VolleyballScene["ball"],
  floorY: number,
  scaleY: number,
  frozen: boolean,
  courtHeight: number,
  badge?: string
) {
  const palette = SLIME_STYLES[player.side % 2][player.slot % 2];
  const px = player.x;
  const py = player.y * scaleY;
  const r = player.radius;
  const airRatio = Math.min(1, Math.max(0, (courtHeight - player.y) / 170));

  // 地面柔和影子
  ctx.fillStyle = `rgba(0, 0, 0, ${0.34 * (1 - airRatio * 0.6)})`;
  ctx.beginPath();
  ctx.ellipse(px, floorY + 7, r * (0.94 - airRatio * 0.32), 7 * (1 - airRatio * 0.3), 0, 0, Math.PI * 2);
  ctx.fill();

  // 根据垂直速度产生轻量弹性果冻形变（纯视觉表现）
  const stretch = Math.max(-0.07, Math.min(0.08, -player.vy / 9500));
  const sx = 1 - stretch * 0.65;
  const sy = 1 + stretch;

  ctx.save();
  ctx.translate(px, py);
  ctx.scale(sx, sy);

  // 外缘微光
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 18;

  // 半圆身体径向渐变
  const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.58, r * 0.1, 0, -r * 0.25, r * 1.08);
  grad.addColorStop(0, palette.light);
  grad.addColorStop(0.55, palette.mid);
  grad.addColorStop(1, palette.dark);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.stroke();

  // 果冻顶部玻璃弯月高光
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.24, -r * 0.62, r * 0.32, r * 0.14, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛位置随阵营面向球网方向
  const eyeX = player.side === 0 ? r * 0.44 : -r * 0.44;
  const eyeY = -r * 0.54;
  const startled = frozen && ((player.side === 0 && ball.x < 600) || (player.side === 1 && ball.x >= 600));
  const eyeR = startled ? r * 0.28 : r * 0.23;

  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.48)";
  ctx.stroke();

  // 瞳孔追踪球坐标
  const dx = ball.x - (px + eyeX * sx);
  const dy = ball.y * scaleY - (py + eyeY * sy);
  const dist = Math.hypot(dx, dy) || 1;
  const maxOffset = eyeR * 0.42;
  const pupilX = eyeX + (dx / dist) * maxOffset;
  const pupilY = eyeY + (dy / dist) * maxOffset;
  const pupilR = eyeR * 0.52;

  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(pupilX, pupilY, pupilR, 0, Math.PI * 2);
  ctx.fill();

  // 眼神亮斑
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(pupilX - pupilR * 0.32, pupilY - pupilR * 0.32, pupilR * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // 玩家标签徽章
  if (badge) {
    ctx.save();
    ctx.font = "600 13px system-ui, sans-serif";
    const textW = ctx.measureText(badge).width + 14;
    const tagY = py - r * sy - 20;
    ctx.fillStyle = "rgba(10, 20, 34, 0.72)";
    ctx.beginPath();
    ctx.roundRect(px - textW / 2, tagY - 11, textW, 20, 10);
    ctx.fill();
    ctx.strokeStyle = palette.light;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, px, tagY - 1);
    ctx.restore();
  }
}

/** 绘制发光排球、速度拖尾与超高浮标 */
function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: VolleyballScene["ball"],
  trail: { x: number; y: number }[],
  floorY: number,
  scaleY: number,
  palette: ThemePalette,
  rally: number
) {
  const bx = ball.x;
  const by = ball.y * scaleY;
  const br = ball.radius;

  // 地面投影
  const air = Math.min(1, Math.max(0, (floorY - by) / floorY));
  ctx.fillStyle = `rgba(0, 0, 0, ${0.28 * (1 - air * 0.72)})`;
  ctx.beginPath();
  ctx.ellipse(bx, floorY + 7, br * (0.95 - air * 0.4), 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 速度尾迹
  const hot = rally >= 3;
  for (let i = 0; i < trail.length; i++) {
    const pt = trail[i];
    const ratio = (i + 1) / (trail.length + 1);
    ctx.fillStyle = hot
      ? `rgba(255, 190, 85, ${ratio * 0.34})`
      : `rgba(255, 255, 255, ${ratio * 0.22})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y * scaleY, br * ratio * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  // 若球飞出画面顶部，显示顶部定位浮标
  if (by + br < 0) {
    const depth = Math.min(1, Math.abs(by) / 420);
    const indR = 11 - depth * 4;
    ctx.save();
    ctx.fillStyle = palette.ballEdge;
    ctx.beginPath();
    ctx.moveTo(bx, 6);
    ctx.lineTo(bx - indR * 0.75, 10 + indR * 1.1);
    ctx.lineTo(bx + indR * 0.75, 10 + indR * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(bx, by);
  ctx.shadowColor = hot ? "rgba(255, 180, 70, 0.7)" : "rgba(255, 255, 255, 0.45)";
  ctx.shadowBlur = hot ? 22 : 14;

  const ballGrad = ctx.createRadialGradient(-br * 0.32, -br * 0.35, br * 0.12, 0, 0, br);
  ballGrad.addColorStop(0, palette.ballCore);
  ballGrad.addColorStop(0.75, palette.ballEdge);
  ballGrad.addColorStop(1, "#d97706");

  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(0, 0, br, 0, Math.PI * 2);
  ctx.fill();

  // 排球流线球缝
  ctx.shadowBlur = 0;
  ctx.rotate((bx * 0.015) % (Math.PI * 2));
  ctx.strokeStyle = palette.ballSeam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, br * 0.92, -0.45, Math.PI - 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, br * 0.92, Math.PI + 0.35, Math.PI * 2 - 0.45);
  ctx.stroke();

  // 高光点
  ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
  ctx.beginPath();
  ctx.ellipse(-br * 0.32, -br * 0.34, br * 0.25, br * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function VolleyballCanvas({ scene, members }: { scene: VolleyballScene; members: SideMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRef = useRef<{ scene: VolleyballScene; receivedAt: number }>({
    scene,
    receivedAt: performance.now()
  });
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const prevStateRef = useRef({
    roundSeq: scene.roundSeq,
    rally: scene.rally,
    scores: [scene.scores[0], scene.scores[1]] as [number, number]
  });
  const membersRef = useRef(members);
  membersRef.current = members;

  // 同步最新服务端快照与触发击球/得分特效
  useEffect(() => {
    const now = performance.now();
    const prev = prevStateRef.current;

    if (scene.roundSeq !== prev.roundSeq) {
      trailRef.current = [];
    } else if (scene.rally > prev.rally) {
      ripplesRef.current.push({
        x: scene.ball.x,
        y: scene.ball.y,
        radius: scene.ball.radius * 0.8,
        maxRadius: scene.ball.radius * 3.1,
        life: 0,
        maxLife: 0.32,
        color: scene.rally >= 3 ? "#fbbf24" : "#ffffff"
      });
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
        const speed = 90 + Math.random() * 140;
        particlesRef.current.push({
          x: scene.ball.x,
          y: scene.ball.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 0.35 + Math.random() * 0.15,
          radius: 3 + Math.random() * 2.5,
          color: scene.rally >= 3 ? "#fde047" : "#bae6fd"
        });
      }
    }

    if (scene.scores[0] > prev.scores[0] || scene.scores[1] > prev.scores[1]) {
      const color = scene.lastScorer === 0 ? "#60a5fa" : "#fb923c";
      ripplesRef.current.push({
        x: scene.ball.x,
        y: scene.height,
        radius: 14,
        maxRadius: 110,
        life: 0,
        maxLife: 0.55,
        color
      });
      for (let i = 0; i < 16; i++) {
        const angle = -Math.PI * Math.random();
        const speed = 130 + Math.random() * 220;
        particlesRef.current.push({
          x: scene.ball.x,
          y: scene.height - 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 0.55 + Math.random() * 0.25,
          radius: 3.5 + Math.random() * 3.5,
          color
        });
      }
    }

    prevStateRef.current = {
      roundSeq: scene.roundSeq,
      rally: scene.rally,
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
        const snapshot = latestRef.current;
        const predicted = predictScene(snapshot.scene, now - snapshot.receivedAt);

        if (ctx) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const rect = canvas.getBoundingClientRect();
          const targetW = Math.max(600, Math.round(rect.width * dpr));
          const targetH = Math.max(300, Math.round((rect.width / 2) * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          const logicalW = predicted.width;
          const logicalH = predicted.width / 2;
          const floorY = logicalH * FLOOR_RATIO;
          const scaleY = floorY / predicted.height;
          const palette = THEMES[predicted.theme];

          ctx.save();
          ctx.scale(canvas.width / logicalW, canvas.height / logicalH);

          // 1. 天空与球场背景
          drawBackdrop(ctx, logicalW, floorY, palette, now / 1000);
          drawCourtAndNet(ctx, logicalW, logicalH, floorY, predicted, palette);

          // 2. 更新球尾迹
          if (!predicted.frozen) {
            trailRef.current.push({ x: predicted.ball.x, y: predicted.ball.y });
            if (trailRef.current.length > 7) trailRef.current.shift();
          }

          // 3. 整理同侧成员名称用于多人徽章
          const sideMembers = [
            membersRef.current.filter(m => m.side === 0),
            membersRef.current.filter(m => m.side === 1)
          ];
          const showBadge = predicted.players.length > 2 || membersRef.current.length > 0;
          for (const player of predicted.players) {
            const member = sideMembers[player.side]?.[player.slot];
            const badge = showBadge
              ? member ? `P${member.position}` : `${player.side === 0 ? "藍" : "橙"}${player.slot + 1}`
              : undefined;
            drawSlime(ctx, player, predicted.ball, floorY, scaleY, predicted.frozen, predicted.height, badge);
          }

          // 4. 排球与拖尾
          drawBall(ctx, predicted.ball, trailRef.current, floorY, scaleY, palette, predicted.rally);

          // 5. 击球波纹与得分微粒
          ripplesRef.current = ripplesRef.current.filter(rp => {
            rp.life += frameDt;
            const progress = rp.life / rp.maxLife;
            if (progress >= 1) return false;
            const currentR = rp.radius + (rp.maxRadius - rp.radius) * progress;
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.strokeStyle = rp.color;
            ctx.lineWidth = 3 * (1 - progress * 0.5);
            ctx.beginPath();
            ctx.arc(rp.x, rp.y * scaleY, currentR, 0, Math.PI * 2);
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
            pt.vy += 420 * frameDt;
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y * scaleY, pt.radius * (1 - progress * 0.4), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return true;
          });

          // 6. 得分瞬间浮层提示
          if (predicted.frozen && predicted.lastScorer !== null) {
            const label = predicted.lastScorer === 0 ? "藍方得分！" : "橙方得分！";
            const accent = predicted.lastScorer === 0 ? "#60a5fa" : "#fb923c";
            ctx.save();
            ctx.font = "700 28px system-ui, sans-serif";
            const boxW = ctx.measureText(label).width + 54;
            const boxX = logicalW / 2 - boxW / 2;
            const boxY = 44;
            ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, 50, 25);
            ctx.fill();
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, logicalW / 2, boxY + 25);
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
    <div className="volleyball-stage">
      <div className="volleyball-hud">
        <div className="volleyball-team left" data-side={0}>
          <span className="volleyball-names">{leftNames}</span>
          <strong className="volleyball-score">{scene.scores[0]}</strong>
        </div>
        <div className="volleyball-center-badge">
          {scene.rally >= 2 ? <span className="volleyball-rally">{scene.rally} 連擊</span> : <span>VS</span>}
        </div>
        <div className="volleyball-team right" data-side={1}>
          <strong className="volleyball-score">{scene.scores[1]}</strong>
          <span className="volleyball-names">{rightNames}</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="volleyball-canvas" aria-label="史萊姆排球實況畫面" />
    </div>
  );
}
