import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Action } from "../shared/protocol";
import { STICK_DEADZONE } from "../shared/rules";

const SEND_INTERVAL_MS = 85;

type StickPress = { id: number; cx: number; cy: number; maxRadius: number };

/** 将摇杆输入量化为 1 位小数并应用死区，避免高频微抖动占用速率配额 */
function quantizeStick(rawX: number, rawY: number): [number, number] {
  const mag = Math.hypot(rawX, rawY);
  if (mag < STICK_DEADZONE) return [0, 0];
  const scale = mag > 1 ? 1 / mag : 1;
  const x = Math.round(rawX * scale * 10) / 10;
  const y = Math.round(rawY * scale * 10) / 10;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}

export function AirHockeyControls({ send }: { send: (action: Action) => Promise<void> }) {
  const sendRef = useRef(send);
  sendRef.current = send;

  const stickPointer = useRef<StickPress | null>(null);
  const lastSent = useRef<{ x: number; y: number; at: number }>({ x: 0, y: 0, at: 0 });
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const targetVec = useRef<[number, number]>([0, 0]);
  const pressedKeys = useRef(new Set<string>());

  const [thumbOffset, setThumbOffset] = useState<[number, number]>([0, 0]);
  const [dragging, setDragging] = useState(false);

  const flushVector = useCallback((x: number, y: number, forceImmediate = false) => {
    targetVec.current = [x, y];
    const [qx, qy] = quantizeStick(x, y);
    const prev = lastSent.current;
    if (qx === prev.x && qy === prev.y) {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        pendingTimer.current = undefined;
      }
      return;
    }

    const now = performance.now();
    const elapsed = now - prev.at;
    const isZero = qx === 0 && qy === 0;

    if (forceImmediate || isZero || elapsed >= SEND_INTERVAL_MS) {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        pendingTimer.current = undefined;
      }
      lastSent.current = { x: qx, y: qy, at: now };
      void sendRef.current({ kind: "stick", x: qx, y: qy });
      return;
    }

    if (!pendingTimer.current) {
      pendingTimer.current = setTimeout(() => {
        pendingTimer.current = undefined;
        const [latestX, latestY] = quantizeStick(targetVec.current[0], targetVec.current[1]);
        if (latestX === lastSent.current.x && latestY === lastSent.current.y) return;
        lastSent.current = { x: latestX, y: latestY, at: performance.now() };
        void sendRef.current({ kind: "stick", x: latestX, y: latestY });
      }, SEND_INTERVAL_MS - elapsed);
    }
  }, []);

  function updateFromPointer(clientX: number, clientY: number, press: StickPress) {
    const dx = clientX - press.cx;
    const dy = clientY - press.cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(press.maxRadius, dist);
    const angle = Math.atan2(dy, dx);
    const ox = dist > 0 ? Math.cos(angle) * clamped : 0;
    const oy = dist > 0 ? Math.sin(angle) * clamped : 0;
    setThumbOffset([ox, oy]);
    flushVector(ox / press.maxRadius, oy / press.maxRadius);
  }

  function startStick(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (stickPointer.current) return;
    event.preventDefault();
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const rect = el.getBoundingClientRect();
    const press: StickPress = {
      id: event.pointerId,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      maxRadius: rect.width * 0.34
    };
    stickPointer.current = press;
    setDragging(true);
    updateFromPointer(event.clientX, event.clientY, press);
  }

  function dragStick(event: PointerEvent<HTMLDivElement>) {
    const press = stickPointer.current;
    if (!press || event.pointerId !== press.id) return;
    updateFromPointer(event.clientX, event.clientY, press);
  }

  function endStick(event: PointerEvent<HTMLDivElement>) {
    if (stickPointer.current?.id !== event.pointerId) return;
    stickPointer.current = null;
    setDragging(false);
    setThumbOffset([0, 0]);
    flushVector(0, 0, true);
  }

  useEffect(() => {
    const syncKeys = () => {
      if (stickPointer.current) return;
      const keys = pressedKeys.current;
      let kx = 0;
      let ky = 0;
      if (keys.has("left")) kx -= 1;
      if (keys.has("right")) kx += 1;
      if (keys.has("up")) ky -= 1;
      if (keys.has("down")) ky += 1;
      const mag = Math.hypot(kx, ky);
      const nx = mag > 1 ? kx / mag : kx;
      const ny = mag > 1 ? ky / mag : ky;
      setThumbOffset([nx * 44, ny * 44]);
      flushVector(nx, ny, true);
    };

    const mapKey = (key: string) => {
      const k = key.toLowerCase();
      if (k === "arrowleft" || k === "a") return "left";
      if (k === "arrowright" || k === "d") return "right";
      if (k === "arrowup" || k === "w") return "up";
      if (k === "arrowdown" || k === "s") return "down";
      return null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const dir = mapKey(event.key);
      if (!dir) return;
      event.preventDefault();
      if (event.repeat || pressedKeys.current.has(dir)) return;
      pressedKeys.current.add(dir);
      syncKeys();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const dir = mapKey(event.key);
      if (!dir || !pressedKeys.current.has(dir)) return;
      pressedKeys.current.delete(dir);
      syncKeys();
    };

    const reset = () => {
      stickPointer.current = null;
      pressedKeys.current.clear();
      setDragging(false);
      setThumbOffset([0, 0]);
      flushVector(0, 0, true);
    };

    const onVisibility = () => {
      if (document.hidden) reset();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    window.addEventListener("pagehide", reset);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
      window.removeEventListener("pagehide", reset);
      document.removeEventListener("visibilitychange", onVisibility);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      if (lastSent.current.x !== 0 || lastSent.current.y !== 0) {
        void sendRef.current({ kind: "stick", x: 0, y: 0 });
      }
    };
  }, [flushVector]);

  const stickStyle = {
    "--stick-x": `${thumbOffset[0]}px`,
    "--stick-y": `${thumbOffset[1]}px`
  } as CSSProperties;

  return (
    <div className="airhockey-controls" role="group" aria-label="氣墊球搖桿">
      <div
        className="airhockey-stick"
        role="application"
        tabIndex={0}
        aria-label="球拍搖桿"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight W A S D"
        data-dragging={dragging}
        style={stickStyle}
        onPointerDown={startStick}
        onPointerMove={dragStick}
        onPointerUp={endStick}
        onPointerCancel={endStick}
        onLostPointerCapture={endStick}
        onContextMenu={event => event.preventDefault()}
      >
        <span className="airhockey-stick-ring" aria-hidden="true" />
        <span className="airhockey-stick-cross" aria-hidden="true" />
        <span className="airhockey-stick-thumb" aria-hidden="true" />
      </div>
      <span className="airhockey-stick-hint">拖曳搖桿移動球拍</span>
    </div>
  );
}
