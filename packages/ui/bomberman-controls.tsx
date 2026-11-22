import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bomb } from "@phosphor-icons/react";
import type { Action, Direction } from "../shared/protocol";

function keyToDirection(event: KeyboardEvent): Direction | null {
  const key = event.key.toLowerCase();
  if (key === "arrowup" || key === "w") return "up";
  if (key === "arrowdown" || key === "s") return "down";
  if (key === "arrowleft" || key === "a") return "left";
  if (key === "arrowright" || key === "d") return "right";
  return null;
}

function isBombKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return event.code === "Space" || key === "v" || key === "j" || key === "p" || key === "enter";
}

function directionAction(dir: Direction | null): Action {
  if (dir === "up") return { kind: "action", action: "hold-up" };
  if (dir === "down") return { kind: "action", action: "hold-down" };
  if (dir === "left") return { kind: "action", action: "hold-left" };
  if (dir === "right") return { kind: "action", action: "hold-right" };
  return { kind: "action", action: "release" };
}

/** 根据触点相对十字方向盘中心坐标判定四向方向（支持滑屏无极切方向） */
function pointerToDirection(pad: HTMLElement, clientX: number, clientY: number): Direction | null {
  const rect = pad.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const deadZone = Math.min(rect.width, rect.height) * 0.12;
  if (Math.hypot(dx, dy) < deadZone) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function BombermanControls({ send }: { send: (action: Action) => Promise<void> }) {
  const sendRef = useRef(send);
  sendRef.current = send;

  const padPointer = useRef<number | null>(null);
  const bombPointer = useRef<number | null>(null);
  const activeDir = useRef<Direction | null>(null);
  const heldKeys = useRef<Direction[]>([]);

  const [dir, setDir] = useState<Direction | null>(null);
  const [bombing, setBombing] = useState(false);

  const commitDirection = useCallback((next: Direction | null) => {
    if (next === activeDir.current) return;
    activeDir.current = next;
    setDir(next);
    void sendRef.current(directionAction(next));
  }, []);

  const dropBomb = useCallback(() => {
    void sendRef.current({ kind: "action", action: "bomb" });
  }, []);

  function startPad(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || padPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    padPointer.current = event.pointerId;
    commitDirection(pointerToDirection(event.currentTarget, event.clientX, event.clientY));
  }

  function movePad(event: PointerEvent<HTMLDivElement>) {
    if (padPointer.current !== event.pointerId) return;
    event.preventDefault();
    commitDirection(pointerToDirection(event.currentTarget, event.clientX, event.clientY));
  }

  function endPad(event: PointerEvent<HTMLDivElement>) {
    if (padPointer.current !== event.pointerId) return;
    padPointer.current = null;
    commitDirection(null);
  }

  function startBomb(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || bombPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    bombPointer.current = event.pointerId;
    setBombing(true);
    dropBomb();
  }

  function endBomb(event: PointerEvent<HTMLButtonElement>) {
    if (bombPointer.current !== event.pointerId) return;
    bombPointer.current = null;
    setBombing(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const d = keyToDirection(event);
      if (d) {
        event.preventDefault();
        if (padPointer.current !== null) return;
        const list = heldKeys.current.filter(item => item !== d);
        list.push(d);
        heldKeys.current = list;
        commitDirection(d);
      } else if (isBombKey(event)) {
        if (event.code === "Space" && target?.closest("button")) return;
        event.preventDefault();
        if (event.repeat) return;
        setBombing(true);
        dropBomb();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const d = keyToDirection(event);
      if (d) {
        heldKeys.current = heldKeys.current.filter(item => item !== d);
        if (padPointer.current === null) {
          commitDirection(heldKeys.current[heldKeys.current.length - 1] ?? null);
        }
      } else if (isBombKey(event) && bombPointer.current === null) {
        setBombing(false);
      }
    }

    function reset() {
      padPointer.current = null;
      bombPointer.current = null;
      heldKeys.current = [];
      setBombing(false);
      commitDirection(null);
    }

    function onVisibility() {
      if (document.hidden) reset();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onVisibility);
      reset();
    };
  }, [commitDirection, dropBomb]);

  return (
    <div className="bomberman-controls" aria-label="炸彈人手機手掣">
      <div
        className="bomberman-dpad"
        role="group"
        aria-label="四向方向鍵，按住並滑動控制走位"
        onPointerDown={startPad}
        onPointerMove={movePad}
        onPointerUp={endPad}
        onPointerCancel={endPad}
        onLostPointerCapture={endPad}
        onContextMenu={event => event.preventDefault()}
      >
        <span className="bomberman-key bomberman-key-up" data-active={dir === "up"} aria-hidden="true">
          <ArrowUp size={26} weight="bold" />
        </span>
        <span className="bomberman-key bomberman-key-left" data-active={dir === "left"} aria-hidden="true">
          <ArrowLeft size={26} weight="bold" />
        </span>
        <span className="bomberman-key-center" aria-hidden="true" />
        <span className="bomberman-key bomberman-key-right" data-active={dir === "right"} aria-hidden="true">
          <ArrowRight size={26} weight="bold" />
        </span>
        <span className="bomberman-key bomberman-key-down" data-active={dir === "down"} aria-hidden="true">
          <ArrowDown size={26} weight="bold" />
        </span>
      </div>

      <button
        type="button"
        className="bomberman-bomb-btn"
        data-active={bombing}
        aria-label="放炸彈"
        onPointerDown={startBomb}
        onPointerUp={endBomb}
        onPointerCancel={endBomb}
        onLostPointerCapture={endBomb}
        onClick={event => { if (event.detail === 0) dropBomb(); }}
        onContextMenu={event => event.preventDefault()}
      >
        <Bomb size={34} weight="fill" />
        <span>放炸彈</span>
      </button>
    </div>
  );
}
