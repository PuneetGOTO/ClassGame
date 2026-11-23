import { useEffect, useRef } from "react";

interface SnowFlake {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  phase: number;
  alpha: number;
  warm: boolean;
}

const MAX_FLAKES = 40;

function isGameRunningInDom(): boolean {
  if (typeof document === "undefined") return false;
  if (document.hidden) return true;
  return Boolean(
    document.querySelector(".host-display[data-playing='true'], .controller-match[data-round='running']")
  );
}

/**
 * 轻量级 Canvas 柔焦飘雪背景（上限 40 片雪花）：
 * - 当小游戏或对局正在运行时自动暂停 requestAnimationFrame 并隐藏画布，把 100% 性能留给游戏
 * - 零外部资源、支持 prefers-reduced-motion
 */
export function ChristmasSnowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let paused = false;
    let lastTs = 0;

    const flakes: SnowFlake[] = Array.from({ length: MAX_FLAKES }, (_, i) => ({
      x: Math.random() * (window.innerWidth || 1280),
      y: Math.random() * (window.innerHeight || 720),
      r: 1.8 + (i % 5) * 0.95,
      vy: 18 + (i % 6) * 7,
      vx: ((i % 2 === 0 ? 1 : -1) * (5 + (i % 4) * 3)),
      phase: i * 0.65,
      alpha: 0.28 + (i % 5) * 0.12,
      warm: i % 9 === 0
    }));

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    }

    function stopLoop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      ctx?.clearRect(0, 0, canvas!.width, canvas!.height);
    }

    function frame(ts: number) {
      if (paused) {
        rafId = 0;
        return;
      }
      const dt = lastTs > 0 ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;

      ctx!.save();
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);

      for (const f of flakes) {
        f.phase += dt * 0.9;
        f.y += f.vy * dt;
        f.x += (f.vx + Math.sin(f.phase) * 14) * dt;
        if (f.y > height + 12) {
          f.y = -12;
          f.x = Math.random() * width;
        }
        if (f.x < -12) f.x = width + 12;
        if (f.x > width + 12) f.x = -12;

        // 柔焦径向渐变雪花粒子（无阴影开销，帧率极高）
        const grad = ctx!.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 2.1);
        if (f.warm) {
          grad.addColorStop(0, `rgba(255, 232, 163, ${f.alpha})`);
          grad.addColorStop(1, "rgba(244, 193, 80, 0)");
        } else {
          grad.addColorStop(0, `rgba(255, 253, 247, ${f.alpha})`);
          grad.addColorStop(0.55, `rgba(220, 240, 255, ${f.alpha * 0.55})`);
          grad.addColorStop(1, "rgba(220, 240, 255, 0)");
        }
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(f.x, f.y, f.r * 2.1, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.restore();
      rafId = requestAnimationFrame(frame);
    }

    function syncPauseState() {
      const shouldPause = isGameRunningInDom();
      if (shouldPause === paused) return;
      paused = shouldPause;
      if (canvas) canvas.style.display = paused ? "none" : "block";
      if (paused) {
        stopLoop();
      } else {
        lastTs = 0;
        if (!rafId) rafId = requestAnimationFrame(frame);
      }
    }

    resize();
    paused = isGameRunningInDom();
    canvas.style.display = paused ? "none" : "block";
    if (!paused) rafId = requestAnimationFrame(frame);

    const observer = new MutationObserver(syncPauseState);
    const root = document.getElementById("root") ?? document.body;
    observer.observe(root, { attributes: true, subtree: true, childList: true, attributeFilter: ["data-playing", "data-round"] });

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncPauseState);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", syncPauseState);
      stopLoop();
    };
  }, []);

  return <canvas ref={canvasRef} className="xmas-snowfall xmas-snow-canvas" aria-hidden="true" />;
}
