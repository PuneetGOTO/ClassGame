import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { DojoFighterScene, DojoSamurai, Member } from "../shared/protocol";

type SideMember = Pick<Member, "id" | "name" | "position" | "side">;

const INK = "#2b1e1a";

interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  tint: string;
}

/** 零外部素材 Web Audio 合成和风剑道音效（破风 / 斩击 / 拼刀金属 / 太鼓 / KO） */
class DojoAudio {
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

  private playTaiko(ctx: AudioContext, start: number, volume = 0.28) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(145, start);
    osc.frequency.exponentialRampToValueAtTime(52, start + 0.34);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  }

  play(sound: DojoFighterScene["lastSound"]) {
    if (sound === "none") return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (sound === "swing") {
      const len = Math.floor(ctx.sampleRate * 0.14);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1600, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.13);
      filter.Q.value = 2.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(now);
      return;
    }

    if (sound === "clash") {
      // 清脆双刀金属交鸣
      [1480, 2260, 3120].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx === 0 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.88, now + 0.24);
        gain.gain.setValueAtTime(0.13 / (idx + 1), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      });
      return;
    }

    if (sound === "hit") {
      // 利刃清脆斩中 + 实体闷响
      const clang = ctx.createOscillator();
      const clangGain = ctx.createGain();
      clang.type = "triangle";
      clang.frequency.setValueAtTime(980, now);
      clang.frequency.exponentialRampToValueAtTime(260, now + 0.11);
      clangGain.gain.setValueAtTime(0.18, now);
      clangGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      clang.connect(clangGain).connect(ctx.destination);
      clang.start(now);
      clang.stop(now + 0.13);
      this.playTaiko(ctx, now, 0.2);
      return;
    }

    if (sound === "ko") {
      this.playTaiko(ctx, now, 0.32);
      this.playTaiko(ctx, now + 0.16, 0.24);
      return;
    }

    if (sound === "taiko") {
      this.playTaiko(ctx, now, 0.28);
      this.playTaiko(ctx, now + 0.18, 0.26);
    }
  }
}

function createInitialPetals(): Petal[] {
  const tints = ["#ffb7c5", "#ffc8d6", "#ffe0e9", "#ff9eb5"];
  return Array.from({ length: 28 }, (_, i) => ({
    x: (i * 47) % 1200,
    y: (i * 83) % 520,
    vx: -42 - (i % 5) * 14,
    vy: 26 + (i % 4) * 11,
    size: 5 + (i % 4) * 2,
    angle: (i * 0.7) % (Math.PI * 2),
    spin: (i % 2 === 0 ? 1 : -1) * (1.2 + (i % 3) * 0.5),
    tint: tints[i % tints.length]
  }));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function labelForFighter(fighter: DojoSamurai, members: SideMember[]) {
  const sameSide = members.filter(m => m.side === fighter.side);
  const matched = sameSide[fighter.slot] ?? sameSide[0];
  return matched ? `P${matched.position}` : fighter.side === 0 ? `藍${fighter.slot + 1}` : `紅${fighter.slot + 1}`;
}

/** 绘制明亮日系和风道场背景（夕阳天空 + 富士山 + 鸟居 + 木质演武台） */
function drawDojoBackground(ctx: CanvasRenderingContext2D, scene: DojoFighterScene) {
  const { width, height, groundY, phase } = scene;
  const isOverdrive = phase === "overdrive";
  const isSudden = phase === "sudden-death";

  // 1. 暖色调夕阳天空（第 40 秒渐变深橙黄昏，一击必杀进入绯红决战霞光）
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  if (isSudden) {
    sky.addColorStop(0, "#b91c1c");
    sky.addColorStop(0.45, "#ea580c");
    sky.addColorStop(1, "#fde047");
  } else if (isOverdrive) {
    sky.addColorStop(0, "#e85d04");
    sky.addColorStop(0.5, "#f48c06");
    sky.addColorStop(1, "#ffd166");
  } else {
    sky.addColorStop(0, "#ff9e7d");
    sky.addColorStop(0.42, "#ffc6a5");
    sky.addColorStop(0.82, "#ffe8c2");
    sky.addColorStop(1, "#fff6dc");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);

  // 2. 暖色大夕阳与柔和光晕
  const sunX = width * 0.5;
  const sunY = isOverdrive || isSudden ? 235 : 205;
  const sunR = isOverdrive || isSudden ? 112 : 94;
  const sunHalo = ctx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, sunR * 2.1);
  sunHalo.addColorStop(0, isSudden ? "rgba(254, 240, 138, 0.72)" : "rgba(255, 250, 224, 0.65)");
  sunHalo.addColorStop(1, "rgba(255, 210, 150, 0)");
  ctx.fillStyle = sunHalo;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isSudden ? "#fef08a" : "#fff7d6";
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // 3. 柔和浮云
  ctx.fillStyle = isOverdrive || isSudden ? "rgba(255, 237, 213, 0.34)" : "rgba(255, 255, 255, 0.55)";
  const drift = (scene.elapsedMs * 0.015) % 1400;
  [
    [160, 118, 130, 24],
    [940, 102, 150, 26],
    [620, 148, 110, 20]
  ].forEach(([cx, cy, rw, rh]) => {
    const x = ((cx + drift) % 1360) - 80;
    roundedRect(ctx, x, cy, rw, rh, rh / 2);
    ctx.fill();
  });

  // 4. 远山与富士山剪影
  ctx.fillStyle = isSudden ? "#7c2d12" : isOverdrive ? "#9a3412" : "#c08497";
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(140, 340);
  ctx.lineTo(310, 405);
  ctx.lineTo(600, 265);
  ctx.lineTo(890, 405);
  ctx.lineTo(1060, 330);
  ctx.lineTo(width, groundY);
  ctx.closePath();
  ctx.fill();

  // 富士山雪冠
  ctx.fillStyle = isSudden ? "#fed7aa" : "#fff7ed";
  ctx.beginPath();
  ctx.moveTo(600, 265);
  ctx.lineTo(548, 308);
  ctx.lineTo(572, 300);
  ctx.lineTo(600, 315);
  ctx.lineTo(628, 300);
  ctx.lineTo(652, 308);
  ctx.closePath();
  ctx.fill();

  // 5. 远景朱红鸟居
  const toriiX = width * 0.5;
  ctx.save();
  ctx.fillStyle = "#c83e37";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  // 柱子
  ctx.fillRect(toriiX - 72, 355, 16, 137);
  ctx.strokeRect(toriiX - 72, 355, 16, 137);
  ctx.fillRect(toriiX + 56, 355, 16, 137);
  ctx.strokeRect(toriiX + 56, 355, 16, 137);
  // 下横梁
  ctx.fillRect(toriiX - 96, 386, 192, 13);
  ctx.strokeRect(toriiX - 96, 386, 192, 13);
  // 顶笠木
  ctx.beginPath();
  ctx.moveTo(toriiX - 116, 344);
  ctx.quadraticCurveTo(toriiX, 362, toriiX + 116, 344);
  ctx.lineTo(toriiX + 108, 366);
  ctx.quadraticCurveTo(toriiX, 376, toriiX - 108, 366);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 6. 两侧和风道场木柱 + 挂灯笼 + 樱花枝
  for (const sideX of [24, width - 52]) {
    ctx.fillStyle = "#7c4a2d";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.fillRect(sideX, 0, 28, groundY);
    ctx.strokeRect(sideX, 0, 28, groundY);

    // 摇曳和风红灯笼
    const lanternX = sideX < 200 ? sideX + 46 : sideX - 18;
    const sway = Math.sin(scene.elapsedMs / 550 + sideX) * 4;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lanternX, 42);
    ctx.lineTo(lanternX + sway, 84);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.ellipse(lanternX + sway, 108, 17, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.ellipse(lanternX + sway, 108, 7, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 顶部和风檐梁
  ctx.fillStyle = "#5c3317";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.fillRect(0, 0, width, 24);
  ctx.strokeRect(0, 0, width, 24);

  // 7. 明亮木质演武台（温暖木纹 + 粗漫画描边）
  const deckGrad = ctx.createLinearGradient(0, groundY, 0, height);
  deckGrad.addColorStop(0, "#e7b97d");
  deckGrad.addColorStop(0.28, "#d49a57");
  deckGrad.addColorStop(1, "#a66c34");
  ctx.fillStyle = deckGrad;
  ctx.fillRect(0, groundY, width, height - groundY);

  // 木板透视接缝
  ctx.strokeStyle = "rgba(92, 51, 23, 0.35)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 12; i++) {
    const x = (width / 12) * i;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + (x - width / 2) * 0.14, height);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, groundY + 34);
  ctx.lineTo(width, groundY + 34);
  ctx.stroke();

  // 演武台顶边粗描边与和风边饰
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // 中央演武线
  ctx.strokeStyle = "rgba(185, 28, 28, 0.35)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(width / 2, groundY + 6);
  ctx.lineTo(width / 2, height - 8);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 绘制粗描边扁平卡通武士（蓝/红队配色 + 飘动头带 + 动态表情 + 弧形刀光） */
function drawSamurai(
  ctx: CanvasRenderingContext2D,
  fighter: DojoSamurai,
  scene: DojoFighterScene,
  tag: string
) {
  const isBlue = fighter.side === 0;
  const robeMain = isBlue ? "#2563eb" : "#dc2626";
  const robeLight = isBlue ? "#60a5fa" : "#f87171";
  const bandColor = isBlue ? "#0ea5e9" : "#ef4444";
  const bandStripe = fighter.slot === 1 ? "#fde047" : "#ffffff";
  const hitFlash = fighter.hurtMs > 0 && Math.floor(fighter.hurtMs / 55) % 2 === 0;

  ctx.save();
  ctx.translate(fighter.x, fighter.y);

  // 演武台地面椭圆形投影
  const airRatio = Math.max(0.35, 1 - (scene.groundY - fighter.y) / 280);
  ctx.fillStyle = "rgba(43, 30, 26, 0.24)";
  ctx.beginPath();
  ctx.ellipse(0, scene.groundY - fighter.y + 4, 34 * airRatio, 9 * airRatio, 0, 0, Math.PI * 2);
  ctx.fill();

  // 淘汰倒地姿态
  if (!fighter.alive) {
    ctx.save();
    ctx.translate(0, -18);
    ctx.rotate(-fighter.facing * (Math.PI / 2 - 0.12));
    drawSamuraiBody(ctx, fighter, scene, robeMain, robeLight, bandColor, bandStripe, false);
    ctx.restore();
    // 晕眩小星星
    const spin = scene.elapsedMs / 240;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3;
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 20, -48 + Math.sin(a) * 7, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // 根据朝向水平翻转（先画头顶正字标签前翻转身体）
  ctx.save();
  ctx.scale(fighter.facing, 1);

  // 轻度跑动上下起伏与受击后仰
  const bob = fighter.anim === "run"
    ? Math.abs(Math.sin(scene.elapsedMs / 85)) * -7
    : fighter.anim === "idle"
      ? Math.sin(scene.elapsedMs / 260 + fighter.slot) * -2
      : 0;
  const tilt = fighter.anim === "hurt" ? -0.18 : fighter.anim === "run" ? 0.08 : fighter.anim === "attack" ? 0.14 : 0;
  ctx.translate(0, bob);
  ctx.rotate(tilt);

  drawSamuraiBody(ctx, fighter, scene, robeMain, robeLight, bandColor, bandStripe, hitFlash);

  // 挥刀水墨 / 金色弧形刀光
  if (fighter.anim === "attack" && fighter.attackProgress >= 0.16 && fighter.attackProgress <= 0.88) {
    const p = (fighter.attackProgress - 0.16) / 0.72;
    const isEnhanced = scene.phase !== "normal";
    ctx.save();
    ctx.translate(22, -62);
    const startAngle = -Math.PI * 0.78;
    const endAngle = startAngle + Math.PI * 1.15 * Math.min(1, p * 1.35);
    const fade = 1 - Math.max(0, (p - 0.55) / 0.45);
    ctx.globalAlpha = fade;

    // 外层水墨或金红剑气
    ctx.strokeStyle = isEnhanced ? "#f59e0b" : isBlue ? "#38bdf8" : "#f43f5e";
    ctx.lineWidth = isEnhanced ? 24 : 18;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 96, startAngle, endAngle);
    ctx.stroke();

    // 内层雪白高光刀弧
    ctx.strokeStyle = "#fffbeb";
    ctx.lineWidth = isEnhanced ? 11 : 8;
    ctx.beginPath();
    ctx.arc(0, 0, 98, startAngle + 0.08, endAngle);
    ctx.stroke();

    // 粗漫画黑墨飞白
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 107, startAngle + 0.18, endAngle);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // 头顶独立血条 + 玩家徽章（不随角色翻转）
  const topY = -138;
  ctx.font = "800 13px 'Microsoft YaHei', system-ui, sans-serif";
  const badgeW = Math.max(40, ctx.measureText(tag).width + 14);
  roundedRect(ctx, -badgeW / 2, topY - 22, badgeW, 19, 8);
  ctx.fillStyle = isBlue ? "#1d4ed8" : "#b91c1c";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = "#fffbeb";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tag, 0, topY - 12);

  // 角色头顶小血条（2v2 时一眼分辨谁血残）
  const barW = 58;
  roundedRect(ctx, -barW / 2, topY + 2, barW, 8, 4);
  ctx.fillStyle = "#fef3c7";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  const ratio = Math.max(0, Math.min(1, fighter.hp / fighter.maxHp));
  if (ratio > 0) {
    roundedRect(ctx, -barW / 2 + 1.5, topY + 3.5, (barW - 3) * ratio, 5, 2.5);
    ctx.fillStyle = ratio > 0.35 ? (isBlue ? "#38bdf8" : "#ef4444") : "#f59e0b";
    ctx.fill();
  }

  ctx.restore();
}

function drawSamuraiBody(
  ctx: CanvasRenderingContext2D,
  fighter: DojoSamurai,
  scene: DojoFighterScene,
  robeMain: string,
  robeLight: string,
  bandColor: string,
  bandStripe: string,
  hitFlash: boolean
) {
  const legSwing = fighter.anim === "run" ? Math.sin(scene.elapsedMs / 70) * 14 : fighter.anim === "jump" ? 10 : 0;

  // 双脚木屐/草鞋
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.fillStyle = "#fef3c7";
  roundedRect(ctx, -18 - legSwing * 0.6, -18, 15, 16, 5);
  ctx.fill();
  ctx.stroke();
  roundedRect(ctx, 4 + legSwing * 0.6, -18, 15, 16, 5);
  ctx.fill();
  ctx.stroke();

  // 宽大剑道袴（下裳）
  ctx.fillStyle = hitFlash ? "#ffffff" : "#fffbeb";
  ctx.beginPath();
  ctx.moveTo(-22, -52);
  ctx.lineTo(22, -52);
  ctx.lineTo(28, -14);
  ctx.lineTo(-28, -14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 羽织上衣（蓝/红队主色）
  ctx.fillStyle = hitFlash ? "#ffffff" : robeMain;
  roundedRect(ctx, -25, -86, 50, 40, 12);
  ctx.fill();
  ctx.stroke();

  // 羽织亮色斜领高光
  ctx.fillStyle = hitFlash ? "#ffffff" : robeLight;
  ctx.beginPath();
  ctx.moveTo(-10, -86);
  ctx.lineTo(14, -86);
  ctx.lineTo(4, -50);
  ctx.lineTo(-10, -50);
  ctx.closePath();
  ctx.fill();

  // 黑色腰带
  ctx.fillStyle = "#2b1e1a";
  ctx.fillRect(-24, -55, 48, 8);

  // 飘动头带双尾（脑后）
  const wave = Math.sin(scene.elapsedMs / 110 + fighter.slot) * 6;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.fillStyle = bandColor;
  ctx.beginPath();
  ctx.moveTo(-22, -104);
  ctx.quadraticCurveTo(-40, -108 + wave, -52, -96 + wave);
  ctx.lineTo(-47, -88 + wave);
  ctx.quadraticCurveTo(-36, -98 + wave, -20, -96);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 卡通圆润武士头部
  ctx.fillStyle = hitFlash ? "#ffffff" : "#ffe0bd";
  ctx.beginPath();
  ctx.arc(0, -102, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // 黑色武士发髻
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(-4, -125, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -106, 23, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();

  // 额头头带（2v2 队友配金纹区分）
  ctx.fillStyle = bandColor;
  roundedRect(ctx, -23, -112, 46, 10, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = bandStripe;
  ctx.fillRect(-6, -110, 12, 6);

  // 动态表情（受击 >< / 获胜 ^^ / 淘汰 xx / 正常坚定眼）
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.8;
  ctx.lineCap = "round";
  if (fighter.anim === "hurt") {
    // 受击皱眉 > <
    ctx.beginPath();
    ctx.moveTo(-2, -100); ctx.lineTo(4, -96); ctx.lineTo(-2, -92);
    ctx.moveTo(15, -100); ctx.lineTo(9, -96); ctx.lineTo(15, -92);
    ctx.stroke();
  } else if (fighter.anim === "win") {
    // 获胜眯眼笑 ^ ^
    ctx.beginPath();
    ctx.arc(2, -95, 4.5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(13, -95, 4.5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(7.5, -89, 5, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  } else if (!fighter.alive) {
    // 淘汰 x x
    ctx.beginPath();
    ctx.moveTo(-1, -99); ctx.lineTo(5, -93); ctx.moveTo(5, -99); ctx.lineTo(-1, -93);
    ctx.moveTo(10, -99); ctx.lineTo(16, -93); ctx.moveTo(16, -99); ctx.lineTo(10, -93);
    ctx.stroke();
  } else {
    // 坚定眼神 + 剑道热血眉
    ctx.beginPath();
    ctx.arc(3, -96, 3.2, 0, Math.PI * 2);
    ctx.arc(14, -96, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-1, -102); ctx.lineTo(7, -100);
    ctx.moveTo(18, -102); ctx.lineTo(10, -100);
    ctx.stroke();
  }

  // 武士刀姿态（待机斜举 / 挥刀劈斩 / 获胜高举）
  ctx.save();
  ctx.translate(14, -68);
  let swordAngle = -0.58;
  if (fighter.anim === "attack") {
    swordAngle = -1.65 + fighter.attackProgress * 2.65;
  } else if (fighter.anim === "win") {
    swordAngle = -1.35 + Math.sin(scene.elapsedMs / 160) * 0.15;
  } else if (fighter.anim === "hurt") {
    swordAngle = -2.1;
  }
  ctx.rotate(swordAngle);
  // 刀柄与护手
  ctx.fillStyle = INK;
  ctx.fillRect(-10, -4, 18, 8);
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(6, -10, 6, 20);
  ctx.strokeRect(6, -10, 6, 20);
  // 亮银刀身
  ctx.fillStyle = scene.phase === "normal" ? "#f8fafc" : "#fef08a";
  ctx.beginPath();
  ctx.moveTo(12, -5);
  ctx.lineTo(84, -3);
  ctx.lineTo(94, 1);
  ctx.lineTo(84, 5);
  ctx.lineTo(12, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 漫画感放射碰撞火花与伤害飘字 */
function drawSpark(ctx: CanvasRenderingContext2D, spark: DojoFighterScene["spark"]) {
  if (!spark) return;
  const ratio = Math.max(0, Math.min(1, spark.ttlMs / 380));
  const scale = 0.65 + (1 - ratio) * 0.6;
  ctx.save();
  ctx.translate(spark.x, spark.y);
  ctx.globalAlpha = Math.min(1, ratio * 1.4);

  // 放射状漫画尖刺星形
  const spikes = spark.kind === "clash" ? 10 : 8;
  const outerR = (spark.kind === "ko" ? 64 : 46) * scale;
  const innerR = outerR * 0.42;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / spikes;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = spark.kind === "clash" ? "#fef08a" : spark.kind === "ko" ? "#fb7185" : "#fde047";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 漫画飘字
  const text = spark.kind === "clash"
    ? "拼刀!"
    : spark.damage >= 900
      ? "一擊必殺!"
      : spark.kind === "ko"
        ? "K.O.!"
        : `-${spark.damage}`;
  ctx.font = "900 28px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  const floatY = -(1 - ratio) * 34;
  ctx.strokeText(text, 0, floatY);
  ctx.fillStyle = spark.kind === "clash" ? "#fef9c3" : spark.kind === "ko" ? "#ffe4e6" : "#ffffff";
  ctx.fillText(text, 0, floatY);
  ctx.restore();
}

export function DojoFighterCanvas({ scene, members }: { scene: DojoFighterScene; members: SideMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<DojoAudio | null>(null);
  const petalsRef = useRef<Petal[]>(createInitialPetals());
  const lastSoundRef = useRef<number>(scene.soundSeq);
  const lastFrameTimeRef = useRef<number>(0);
  const [muted, setMuted] = useState(false);

  if (!audioRef.current) audioRef.current = new DojoAudio();
  audioRef.current.muted = muted;

  useEffect(() => {
    if (scene.soundSeq > lastSoundRef.current) {
      audioRef.current?.play(scene.lastSound);
    }
    lastSoundRef.current = scene.soundSeq;
  }, [scene.soundSeq, scene.lastSound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== scene.width * dpr || canvas.height !== scene.height * dpr) {
      canvas.width = scene.width * dpr;
      canvas.height = scene.height * dpr;
    }

    // 推进樱花瓣飘落（第 40 秒决胜时刻加速飞舞）
    const dtSec = lastFrameTimeRef.current > 0
      ? Math.min(0.08, Math.max(0.016, (scene.elapsedMs - lastFrameTimeRef.current) / 1000))
      : 0.02;
    lastFrameTimeRef.current = scene.elapsedMs;
    const speedBoost = scene.phase === "normal" ? 1 : scene.phase === "overdrive" ? 2.1 : 2.8;
    for (const petal of petalsRef.current) {
      petal.x += petal.vx * speedBoost * dtSec;
      petal.y += petal.vy * speedBoost * dtSec;
      petal.angle += petal.spin * speedBoost * dtSec;
      if (petal.x < -20) petal.x = scene.width + 20;
      if (petal.y > scene.groundY + 10) {
        petal.y = -15;
        petal.x = (petal.x + 317) % (scene.width + 40);
      }
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 命中微震屏
    if (scene.shakeMs > 0) {
      const mag = (scene.shakeMs / 150) * 7;
      ctx.translate(Math.sin(scene.elapsedMs * 0.9) * mag, Math.cos(scene.elapsedMs * 1.1) * mag * 0.6);
    }

    drawDojoBackground(ctx, scene);

    // 飘落樱花瓣（背景层）
    for (const petal of petalsRef.current) {
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.angle);
      ctx.fillStyle = petal.tint;
      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size, petal.size * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 绘制所有和风武士（活着的画在倒地的上面）
    const ordered = [...scene.fighters].sort((a, b) => Number(a.alive) - Number(b.alive));
    for (const fighter of ordered) {
      drawSamurai(ctx, fighter, scene, labelForFighter(fighter, members));
    }

    // 漫画感碰撞火花与伤害飘字
    drawSpark(ctx, scene.spark);

    ctx.restore();
  }, [scene, members]);

  const bluePct = Math.max(0, Math.min(100, (scene.teamHp[0] / Math.max(1, scene.teamMaxHp[0])) * 100));
  const redPct = Math.max(0, Math.min(100, (scene.teamHp[1] / Math.max(1, scene.teamMaxHp[1])) * 100));
  const blueNames = scene.fighters.filter(f => f.side === 0).map(f => labelForFighter(f, members)).join(" · ");
  const redNames = scene.fighters.filter(f => f.side === 1).map(f => labelForFighter(f, members)).join(" · ");
  const isDoubles = scene.fighters.length > 2;

  return (
    <div className="dojo-stage">
      <div className="dojo-hud">
        <div className="dojo-team left">
          <div className="dojo-team-top">
            <span className="dojo-team-name blue">藍隊 {blueNames}</span>
            <strong className="dojo-hp-num">{scene.teamHp[0]}</strong>
          </div>
          <div className="dojo-hp-track">
            <div className="dojo-hp-fill blue" style={{ width: `${bluePct}%` }} />
          </div>
        </div>

        <div className="dojo-center">
          {scene.phase === "sudden-death" ? (
            <span className="dojo-phase-badge sudden">一擊必殺！</span>
          ) : scene.phase === "overdrive" ? (
            <span className="dojo-phase-badge overdrive">雙倍傷害 2×</span>
          ) : (
            <span className="dojo-phase-badge">{isDoubles ? "2v2 隊友免傷" : "1v1 劍道對決"}</span>
          )}
          <button
            type="button"
            className="dojo-mute"
            aria-label={muted ? "開啟音效" : "靜音"}
            onClick={() => setMuted(v => !v)}
          >
            {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          </button>
        </div>

        <div className="dojo-team right">
          <div className="dojo-team-top">
            <strong className="dojo-hp-num">{scene.teamHp[1]}</strong>
            <span className="dojo-team-name red">{redNames} 紅隊</span>
          </div>
          <div className="dojo-hp-track">
            <div className="dojo-hp-fill red" style={{ width: `${redPct}%` }} />
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="dojo-canvas"
        aria-label="和風劍道對決即時演武場"
      />
    </div>
  );
}
