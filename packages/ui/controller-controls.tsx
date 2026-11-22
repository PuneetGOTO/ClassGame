import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp } from "@phosphor-icons/react";
import type { Action, Direction } from "../shared/protocol";

type Send = (action: Action) => Promise<void>;
type Movement = "hold" | "move" | "cursor";
type StickTouch = { id: number; x: number; y: number; travel: number };

const directions: Partial<Record<string, Direction>> = {
  arrowleft: "left", a: "left", arrowright: "right", d: "right",
  arrowup: "up", w: "up", arrowdown: "down", s: "down"
};
const directionLabels = { left: "向左", right: "向右", up: "向上", down: "向下" };
const firstRepeatMs = 230;
const repeatIntervals = { move: 130, cursor: 165 };

function gameKey(event: KeyboardEvent) {
  return !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey &&
    !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"));
}

function dragDirection(x: number, y: number, previous: Direction | null) {
  const distance = Math.hypot(x, y);
  if (distance < (previous ? 0.15 : 0.24)) return null;
  // Keep the current axis near a diagonal so small thumb movements don't flip directions.
  const margin = 0.16 * distance;
  const horizontal = previous === "left" || previous === "right";
  const vertical = previous === "up" || previous === "down";
  if (Math.abs(x) + (horizontal ? margin : 0) >= Math.abs(y) + (vertical ? margin : 0)) {
    return x < 0 ? "left" : "right";
  }
  return y < 0 ? "up" : "down";
}

export function DirectionStick({ movement, horizontal = false, send }: {
  movement: Movement; horizontal?: boolean; send: Send;
}) {
  const latest = useRef(send);
  latest.current = send;
  const touch = useRef<StickTouch | null>(null);
  const keys = useRef(new Map<string, Direction>());
  const active = useRef<Direction | null>(null);
  const repeat = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  const changeDirection = useCallback((next: Direction | null) => {
    if (active.current === next) return;
    active.current = next;
    setDirection(next);
    clearTimeout(repeat.current);
    if (movement === "hold") {
      void latest.current({ kind: "action", action: next ? `hold-${next}` : "release" });
      return;
    }
    if (!next) return;
    const interval = repeatIntervals[movement];
    const step = () => void latest.current({ kind: movement, direction: next });
    function pulse() {
      step();
      repeat.current = setTimeout(pulse, interval);
    }
    step();
    repeat.current = setTimeout(pulse, firstRepeatMs);
  }, [movement]);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || touch.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: element.clientWidth * 0.28 };
    changeDirection(null);
    setOffset({ x: 0, y: 0 });
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const pointer = touch.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const x = event.clientX - pointer.x;
    const y = horizontal ? 0 : event.clientY - pointer.y;
    const scale = pointer.travel / Math.max(pointer.travel, Math.hypot(x, y));
    setOffset({ x: x * scale, y: y * scale });
    changeDirection(dragDirection(x / pointer.travel, y / pointer.travel, active.current));
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    if (touch.current?.id !== event.pointerId) return;
    touch.current = null;
    setOffset(null);
    changeDirection([...keys.current.values()].at(-1) ?? null);
  }

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (!gameKey(event)) return;
      const key = event.key.toLowerCase();
      const next = directions[key];
      if (!next || (horizontal && (next === "up" || next === "down"))) return;
      event.preventDefault();
      if (keys.current.has(key) || event.repeat) return;
      keys.current.set(key, next);
      if (!touch.current) changeDirection(next);
    }

    function keyUp(event: KeyboardEvent) {
      if (keys.current.delete(event.key.toLowerCase()) && !touch.current) {
        changeDirection([...keys.current.values()].at(-1) ?? null);
      }
    }

    function reset() {
      touch.current = null;
      keys.current.clear();
      setOffset(null);
      changeDirection(null);
    }

    function onVisibility() {
      if (document.hidden) reset();
    }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", reset);
    window.addEventListener("pagehide", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", reset);
      window.removeEventListener("pagehide", reset);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(repeat.current);
      if (movement === "hold" && active.current) void latest.current({ kind: "action", action: "release" });
      active.current = null;
    };
  }, [changeDirection, horizontal, movement]);

  const style = offset ? { "--stick-x": offset.x + "px", "--stick-y": offset.y + "px" } as CSSProperties : undefined;
  const value = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  return <div className="stick-control">
    <div className="direction-stick" role={horizontal ? "slider" : "application"} tabIndex={0}
      aria-label={movement === "cursor" ? "游標搖桿" : "移動搖桿"}
      aria-valuemin={horizontal ? -1 : undefined} aria-valuemax={horizontal ? 1 : undefined}
      aria-valuenow={horizontal ? value : undefined} aria-valuetext={horizontal ? direction ? directionLabels[direction] : "置中" : undefined}
      aria-keyshortcuts={horizontal ? "ArrowLeft ArrowRight A D" : "ArrowUp ArrowDown ArrowLeft ArrowRight W A S D"}
      data-dragging={offset !== null} data-direction={direction ?? undefined} style={style}
      onPointerDown={start} onPointerMove={drag} onPointerUp={release} onPointerCancel={release}
      onLostPointerCapture={release} onContextMenu={event => event.preventDefault()}>
      <CaretLeft className="stick-left" aria-hidden="true" size={18} weight="bold"/>
      <CaretRight className="stick-right" aria-hidden="true" size={18} weight="bold"/>
      {!horizontal && <>
        <CaretUp className="stick-up" aria-hidden="true" size={18} weight="bold"/>
        <CaretDown className="stick-down" aria-hidden="true" size={18} weight="bold"/>
      </>}
      <span className="direction-stick-thumb" aria-hidden="true"/>
    </div>
    <span className="stick-hint" aria-hidden="true">{movement === "cursor" ? "拖曳移動游標" : "拖曳移動"}</span>
  </div>;
}

export function ActionButton({ action, send, children, label, className = "", keys, repeatMs }: {
  action: Action; send: Send; children: ReactNode; label: string;
  className?: string; keys?: readonly string[]; repeatMs?: number;
}) {
  const press = useRef<number | string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ action, send, keys, repeatMs });
  latest.current = { action, send, keys, repeatMs };
  const [pressed, setPressed] = useState(false);

  const trigger = useCallback(() => void latest.current.send(latest.current.action), []);

  const begin = useCallback((source: number | string) => {
    if (press.current !== null) return;
    press.current = source;
    setPressed(true);
    const interval = latest.current.repeatMs;
    function pulse() {
      trigger();
      if (interval) timer.current = setTimeout(pulse, interval);
    }
    pulse();
  }, [trigger]);

  const stop = useCallback(() => {
    press.current = null;
    clearTimeout(timer.current);
    setPressed(false);
  }, []);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (!gameKey(event)) return;
      const key = event.key.toLowerCase();
      if (!latest.current.keys?.includes(key)) return;
      if ((key === " " || key === "enter") && event.target instanceof Element && event.target.closest("button,a")) return;
      event.preventDefault();
      if (!event.repeat) begin(key);
    }
    function keyUp(event: KeyboardEvent) {
      if (press.current === event.key.toLowerCase()) stop();
    }
    function onVisibility() {
      if (document.hidden) stop();
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(timer.current);
    };
  }, [begin, stop]);

  function release(event: PointerEvent<HTMLButtonElement>) {
    if (press.current === event.pointerId) stop();
  }

  return <button type="button" className={"handset-action " + className} aria-label={label} data-active={pressed}
    onPointerDown={event => {
      if (event.button !== 0 || press.current !== null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      begin(event.pointerId);
    }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) trigger(); }}>
    {children}
  </button>;
}
