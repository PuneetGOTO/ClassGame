import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { BombermanScene, Member } from "../shared/protocol";
import { sideLabels } from "../shared/route";

type SideMember = Pick<Member, "id" | "name" | "position" | "side">;

/** 四大阵营霓虹配色（蓝 / 橙 / 绿 / 紫） */
const SIDE_PALETTE = [
  { main: "#38bdf8", glow: "rgba(56, 189, 248, 0.72)", dark: "#0c4a6e", rim: "#bae6fd" },
  { main: "#fb923c", glow: "rgba(251, 146, 60, 0.72)", dark: "#7c2d12", rim: "#fed7aa" },
  { main: "#34d399", glow: "rgba(52, 211, 153, 0.72)", dark: "#064e3b", rim: "#a7f3d0" },
  { main: "#c084fc", glow: "rgba(192, 132, 252, 0.72)", dark: "#581c87", rim: "#e9d5ff" }
] as const;

const CELL_PX = 64;

/** 零外部素材 Web Audio 合成音效引擎（放弹 / 爆炸 / 道具 / 淘汰 / 缩圈） */
class BomberAudio {
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

  play(event: BombermanScene["lastEvent"]) {
    if (event === "none") return;
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (event === "bomb") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.11);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
      return;
    }

    if (event === "explode") {
      // 白噪爆裂 + 低频重击
      const length = Math.floor(ctx.sampleRate * 0.28);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.28));
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.26);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(now);

      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = "triangle";
      sub.frequency.setValueAtTime(128, now);
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.24);
      subGain.gain.setValueAtTime(0.22, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(now);
      sub.stop(now + 0.26);
      return;
    }

    if (event === "powerup") {
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        const t = now + idx * 0.055;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      });
      return;
    }

    if (event === "ko") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.3);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.33);
      return;
    }

    if (event === "shrink") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(68, now + 0.09);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  }
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

/** 将服务端玩家槽位对应到展示名称 */
function labelForPlayer(player: BombermanScene["players"][number], members: SideMember[]) {
  if (player.isBot) return "AI";
  const sameSide = members.filter(m => m.side === player.side);
  const slotMatch = player.id.match(/#(\d+)$/);
  const idx = slotMatch ? Number(slotMatch[1]) : 0;
  const matched = sameSide[idx] ?? sameSide[0];
  return matched ? `P${matched.position}` : `P${player.slot + 1}`;
}

export function BombermanCanvas({ scene, members }: { scene: BombermanScene; members: SideMember[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<BomberAudio | null>(null);
  const lastSeqRef = useRef<number>(scene.eventSeq);
  const [muted, setMuted] = useState(false);

  if (!audioRef.current) audioRef.current = new BomberAudio();
  audioRef.current.muted = muted;

  useEffect(() => {
    if (scene.eventSeq > lastSeqRef.current) {
      audioRef.current?.play(scene.lastEvent);
    }
    lastSeqRef.current = scene.eventSeq;
  }, [scene.eventSeq, scene.lastEvent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = scene.cols * CELL_PX;
    const height = scene.rows * CELL_PX;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. 深空霓虹迷宫地板
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#090f24");
    bgGrad.addColorStop(0.5, "#0d1633");
    bgGrad.addColorStop(1, "#0a1026");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 细微赛博网格线
    ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= scene.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL_PX, 0);
      ctx.lineTo(c * CELL_PX, height);
      ctx.stroke();
    }
    for (let r = 0; r <= scene.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL_PX);
      ctx.lineTo(width, r * CELL_PX);
      ctx.stroke();
    }

    // 2. 绘制格子：固定立柱(#) / 软砖(B) / 缩圈死墙(S)
    const pulse = 0.5 + 0.5 * Math.sin(scene.elapsedMs / 160);
    for (let r = 0; r < scene.rows; r++) {
      for (let c = 0; c < scene.cols; c++) {
        const ch = scene.tiles[r * scene.cols + c];
        const x = c * CELL_PX;
        const y = r * CELL_PX;
        if (ch === ".") {
          if ((c + r) % 2 === 0) {
            ctx.fillStyle = "rgba(148, 163, 184, 0.03)";
            ctx.fillRect(x + 2, y + 2, CELL_PX - 4, CELL_PX - 4);
          }
          continue;
        }
        if (ch === "#") {
          // 固定霓虹金属立柱
          const grad = ctx.createLinearGradient(x, y, x + CELL_PX, y + CELL_PX);
          grad.addColorStop(0, "#1e293b");
          grad.addColorStop(1, "#0f172a");
          roundedRect(ctx, x + 3, y + 3, CELL_PX - 6, CELL_PX - 6, 10);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = "rgba(96, 165, 250, 0.42)";
          ctx.lineWidth = 2;
          ctx.stroke();
          // 内框科技切角
          roundedRect(ctx, x + 13, y + 13, CELL_PX - 26, CELL_PX - 26, 6);
          ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (ch === "B") {
          // 可破坏霓虹能量软砖
          const grad = ctx.createLinearGradient(x, y, x, y + CELL_PX);
          grad.addColorStop(0, "#312e81");
          grad.addColorStop(1, "#1e1b4b");
          roundedRect(ctx, x + 4, y + 4, CELL_PX - 8, CELL_PX - 8, 9);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = "rgba(129, 140, 248, 0.72)";
          ctx.lineWidth = 2;
          ctx.stroke();
          // 能量晶体交叉纹路
          ctx.strokeStyle = "rgba(165, 180, 252, 0.35)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x + 12, y + CELL_PX / 2);
          ctx.lineTo(x + CELL_PX - 12, y + CELL_PX / 2);
          ctx.moveTo(x + CELL_PX / 2, y + 12);
          ctx.lineTo(x + CELL_PX / 2, y + CELL_PX - 12);
          ctx.stroke();
        } else if (ch === "S") {
          // 缩圈高能死墙
          const grad = ctx.createLinearGradient(x, y, x + CELL_PX, y + CELL_PX);
          grad.addColorStop(0, "#881337");
          grad.addColorStop(1, "#4c0519");
          roundedRect(ctx, x + 2, y + 2, CELL_PX - 4, CELL_PX - 4, 8);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = `rgba(251, 113, 133, ${0.65 + pulse * 0.35})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          // 警示斜叉
          ctx.strokeStyle = "rgba(253, 164, 175, 0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 14, y + 14);
          ctx.lineTo(x + CELL_PX - 14, y + CELL_PX - 14);
          ctx.moveTo(x + CELL_PX - 14, y + 14);
          ctx.lineTo(x + 14, y + CELL_PX - 14);
          ctx.stroke();
        }
      }
    }

    // 3. 下一格落墙红框预警
    if (scene.nextShrink) {
      const { col, row, warnRatio } = scene.nextShrink;
      const x = col * CELL_PX;
      const y = row * CELL_PX;
      ctx.save();
      ctx.fillStyle = `rgba(244, 63, 94, ${0.14 + warnRatio * 0.28})`;
      roundedRect(ctx, x + 4, y + 4, CELL_PX - 8, CELL_PX - 8, 8);
      ctx.fill();
      ctx.strokeStyle = `rgba(251, 113, 133, ${0.6 + warnRatio * 0.4})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.restore();
    }

    // 4. 地面强化道具
    for (const pu of scene.powerups) {
      const cx = (pu.col + 0.5) * CELL_PX;
      const cy = (pu.row + 0.5) * CELL_PX;
      const bob = Math.sin(scene.elapsedMs / 180 + pu.col + pu.row) * 3;
      const color = pu.kind === "flame" ? "#f97316" : pu.kind === "bomb" ? "#38bdf8" : "#facc15";
      const label = pu.kind === "flame" ? "火" : pu.kind === "bomb" ? "彈" : "速";
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
      ctx.beginPath();
      ctx.arc(cx, cy + bob, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.font = "900 18px 'Microsoft YaHei', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy + bob + 1);
      ctx.restore();
    }

    // 5. 脉冲等离子炸弹
    for (const bomb of scene.bombs) {
      const cx = (bomb.col + 0.5) * CELL_PX;
      const cy = (bomb.row + 0.5) * CELL_PX;
      const palette = SIDE_PALETTE[bomb.ownerSide % SIDE_PALETTE.length];
      const urgency = 1 - Math.max(0, Math.min(1, bomb.fuseLeftMs / 2_000));
      const beat = 1 + Math.sin(scene.elapsedMs / (110 - urgency * 60)) * (0.06 + urgency * 0.08);
      const radius = 19 * beat;

      ctx.save();
      ctx.shadowColor = urgency > 0.72 ? "#f43f5e" : palette.main;
      ctx.shadowBlur = 14 + urgency * 12;
      const orb = ctx.createRadialGradient(cx - 5, cy - 5, 3, cx, cy, radius);
      orb.addColorStop(0, "#ffffff");
      orb.addColorStop(0.35, urgency > 0.75 ? "#fb7185" : palette.main);
      orb.addColorStop(1, "#0f172a");
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // 引信倒计时弧
      ctx.shadowBlur = 0;
      ctx.strokeStyle = urgency > 0.7 ? "#fda4af" : palette.rim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - urgency));
      ctx.stroke();
      ctx.restore();
    }

    // 6. 十字等离子爆炸火焰
    for (const flame of scene.flames) {
      const cx = (flame.col + 0.5) * CELL_PX;
      const cy = (flame.row + 0.5) * CELL_PX;
      const alpha = Math.max(0.15, Math.min(1, flame.ttlMs / 450));
      const palette = SIDE_PALETTE[flame.ownerSide % SIDE_PALETTE.length];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = palette.main;
      ctx.shadowBlur = 20;

      if (flame.kind === "center") {
        ctx.fillStyle = palette.main;
        ctx.beginPath();
        ctx.arc(cx, cy, CELL_PX * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, CELL_PX * 0.24, 0, Math.PI * 2);
        ctx.fill();
      } else if (flame.kind === "h") {
        roundedRect(ctx, flame.col * CELL_PX + 2, cy - 16, CELL_PX - 4, 32, 12);
        ctx.fillStyle = palette.main;
        ctx.fill();
        roundedRect(ctx, flame.col * CELL_PX + 2, cy - 7, CELL_PX - 4, 14, 6);
        ctx.fillStyle = "#fff7ed";
        ctx.fill();
      } else {
        roundedRect(ctx, cx - 16, flame.row * CELL_PX + 2, 32, CELL_PX - 4, 12);
        ctx.fillStyle = palette.main;
        ctx.fill();
        roundedRect(ctx, cx - 7, flame.row * CELL_PX + 2, 14, CELL_PX - 4, 6);
        ctx.fillStyle = "#fff7ed";
        ctx.fill();
      }
      ctx.restore();
    }

    // 7. 高颜值霓虹机甲角色
    for (const player of scene.players) {
      const cx = player.x * CELL_PX;
      const cy = player.y * CELL_PX;
      const palette = SIDE_PALETTE[player.side % SIDE_PALETTE.length];

      if (!player.alive) {
        // 淘汰后的半透明微弱残影标记
        ctx.save();
        ctx.globalAlpha = 0.26;
        ctx.strokeStyle = palette.main;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy - 10);
        ctx.lineTo(cx + 10, cy + 10);
        ctx.moveTo(cx + 10, cy - 10);
        ctx.lineTo(cx - 10, cy + 10);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const radius = 21;
      ctx.save();
      // 脚下阵营光环
      ctx.strokeStyle = palette.glow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.stroke();

      // 机体发光圆球
      ctx.shadowColor = palette.main;
      ctx.shadowBlur = 16;
      const bodyGrad = ctx.createRadialGradient(cx - 6, cy - 6, 3, cx, cy, radius);
      bodyGrad.addColorStop(0, "#ffffff");
      bodyGrad.addColorStop(0.28, palette.rim);
      bodyGrad.addColorStop(0.75, palette.main);
      bodyGrad.addColorStop(1, palette.dark);
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 方向护目镜
      const vx = player.dir === "left" ? -7 : player.dir === "right" ? 7 : 0;
      const vy = player.dir === "up" ? -7 : player.dir === "down" ? 7 : 0;
      ctx.fillStyle = "#0f172a";
      roundedRect(ctx, cx + vx - 10, cy + vy - 5, 20, 10, 5);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(cx + vx - 4, cy + vy, 2.5, 0, Math.PI * 2);
      ctx.arc(cx + vx + 4, cy + vy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 头顶玩家编号胶囊
      const tag = labelForPlayer(player, members);
      ctx.font = "800 12px 'Microsoft YaHei', system-ui, sans-serif";
      const tagW = Math.max(28, ctx.measureText(tag).width + 10);
      roundedRect(ctx, cx - tagW / 2, cy - radius - 18, tagW, 16, 6);
      ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
      ctx.fill();
      ctx.strokeStyle = palette.main;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tag, cx, cy - radius - 9.5);
      ctx.restore();
    }

    ctx.restore();
  }, [scene, members]);

  const shrinkActive = scene.elapsedMs >= scene.shrinkStartMs;
  const shrinkCountdown = Math.max(0, Math.ceil((scene.shrinkStartMs - scene.elapsedMs) / 1000));
  const sides = scene.mode === "2v2" ? [0, 1] : [0, 1, 2, 3];

  return (
    <div className="bomberman-stage">
      <div className="bomberman-hud">
        <div className="bomberman-mode-badge">
          <strong>{scene.mode === "2v2" ? "2v2 團隊戰 · 隊友不互傷" : "1v1v1v1 四人混戰"}</strong>
          <span className={shrinkActive ? "bomberman-shrink-alert active" : "bomberman-shrink-alert"}>
            {shrinkActive ? "高能死牆螺旋縮圈中！" : `距縮圈落牆 ${shrinkCountdown} 秒`}
          </span>
        </div>

        <div className="bomberman-sides" data-mode={scene.mode}>
          {sides.map(side => {
            const sidePlayers = scene.players.filter(p => p.side === side);
            const aliveCount = sidePlayers.filter(p => p.alive).length;
            const kills = sidePlayers.reduce((sum, p) => sum + p.kills, 0);
            const names = sidePlayers.map(p => labelForPlayer(p, members)).join(" / ");
            return (
              <div className={"bomberman-side-chip" + (aliveCount === 0 ? " eliminated" : "")} key={side} data-side={side}>
                <span className="bomberman-side-name">{sideLabels[side]}</span>
                <span className="bomberman-side-meta">
                  {names} · 存活 {aliveCount}/{sidePlayers.length} · 擊殺 {kills}
                </span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="bomberman-mute"
          aria-label={muted ? "開啟音效" : "靜音"}
          onClick={() => setMuted(v => !v)}
        >
          {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          <span>{muted ? "靜音" : "音效"}</span>
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="bomberman-canvas"
        aria-label="霓虹炸彈人即時戰場"
      />
    </div>
  );
}
