import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowUp, CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { Action } from "../shared/protocol";

type Horizontal = "left" | "right";
type StickPress = { id: number; origin: number; travel: number };

function keyDirection(event: KeyboardEvent): Horizontal | null {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") return "left";
  if (key === "arrowright" || key === "d") return "right";
  return null;
}

function jumpKey(event: KeyboardEvent) {
  return event.code === "Space" || event.key === "ArrowUp" || event.key.toLowerCase() === "w";
}

export function VolleyballControls({ send }: { send: (action: Action) => Promise<void> }) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const stickPointer = useRef<StickPress | null>(null);
  const jumpPointer = useRef<number | null>(null);
  const activeDirection = useRef<Horizontal | null>(null);
  const [direction, setDirection] = useState<Horizontal | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [jumping, setJumping] = useState(false);

  const move = useCallback((next: Horizontal | null) => {
    if (next === activeDirection.current) return;
    activeDirection.current = next;
    setDirection(next);
    void sendRef.current({ kind: "action", action: next === "left" ? "hold-left" : next === "right" ? "hold-right" : "release" });
  }, []);

  const jump = useCallback(() => {
    void sendRef.current({ kind: "action", action: "jump" });
  }, []);

  function startStick(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || stickPointer.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    stickPointer.current = { id: event.pointerId, origin: event.clientX, travel: target.clientWidth * 0.25 };
    setDragging(true);
    setOffset(0);
    move(null);
  }

  function dragStick(event: PointerEvent<HTMLDivElement>) {
    const pointer = stickPointer.current;
    if (!pointer || event.pointerId !== pointer.id) return;
    const distance = event.clientX - pointer.origin;
    setOffset(Math.max(-pointer.travel, Math.min(pointer.travel, distance)));

    // A smaller return threshold keeps the player steady near the centre.
    const engage = pointer.travel * 0.26;
    const release = pointer.travel * 0.16;
    if (distance <= -engage) move("left");
    else if (distance >= engage) move("right");
    else if ((activeDirection.current === "left" && distance >= -release) ||
      (activeDirection.current === "right" && distance <= release)) move(null);
  }

  function endStick(event: PointerEvent<HTMLDivElement>) {
    if (stickPointer.current?.id !== event.pointerId) return;
    stickPointer.current = null;
    setDragging(false);
    setOffset(0);
    move(null);
  }

  function startJump(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || jumpPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    jumpPointer.current = event.pointerId;
    setJumping(true);
    jump();
  }

  function endJump(event: PointerEvent<HTMLButtonElement>) {
    if (jumpPointer.current !== event.pointerId) return;
    jumpPointer.current = null;
    setJumping(false);
  }

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const next = keyDirection(event);
      if (next) {
        event.preventDefault();
        if (!event.repeat && !stickPointer.current) move(next);
      } else if (jumpKey(event)) {
        if (event.code === "Space" && target?.closest("button")) return;
        event.preventDefault();
        if (event.repeat) return;
        setJumping(true);
        jump();
      }
    }
    function keyUp(event: KeyboardEvent) {
      if (!stickPointer.current && keyDirection(event) === activeDirection.current && activeDirection.current) move(null);
      if (jumpPointer.current === null && jumpKey(event)) setJumping(false);
    }
    function reset() {
      stickPointer.current = null;
      jumpPointer.current = null;
      setDragging(false);
      setOffset(0);
      setJumping(false);
      move(null);
    }
    function visibility() {
      if (document.hidden) reset();
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", reset);
    window.addEventListener("pagehide", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", reset);
      window.removeEventListener("pagehide", reset);
      document.removeEventListener("visibilitychange", visibility);
      if (activeDirection.current !== null) {
        activeDirection.current = null;
        void sendRef.current({ kind: "action", action: "release" });
      }
    };
  }, [jump, move]);

  const value = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const stickStyle = {
    "--stick-offset": dragging ? offset + "px" : value * 24 + "px"
  } as CSSProperties;

  return <div className="volleyball-controls" role="group" aria-label="排球手掣">
    <div className="volleyball-movement">
      <div className="volleyball-stick" role="slider" tabIndex={0} aria-label="移動搖桿"
        aria-valuemin={-1} aria-valuemax={1} aria-valuenow={value}
        aria-valuetext={direction === "left" ? "向左" : direction === "right" ? "向右" : "置中"}
        aria-keyshortcuts="ArrowLeft ArrowRight A D" data-dragging={dragging}
        data-direction={direction ?? undefined} style={stickStyle}
        onPointerDown={startStick} onPointerMove={dragStick} onPointerUp={endStick}
        onPointerCancel={endStick} onLostPointerCapture={endStick}
        onContextMenu={event => event.preventDefault()}>
        <CaretLeft className="volleyball-stick-left" aria-hidden="true" size={18} weight="bold"/>
        <CaretRight className="volleyball-stick-right" aria-hidden="true" size={18} weight="bold"/>
        <span className="volleyball-stick-thumb" aria-hidden="true"/>
      </div>
      <span className="volleyball-move-label" aria-hidden="true">拖曳移動</span>
    </div>
    <button type="button" className="volleyball-jump" aria-label="跳躍擊球" data-active={jumping}
      onPointerDown={startJump} onPointerUp={endJump} onPointerCancel={endJump}
      onLostPointerCapture={endJump} onContextMenu={event => event.preventDefault()}
      onClick={event => { if (event.detail === 0) jump(); }}>
      <ArrowUp aria-hidden="true" size={32} weight="bold"/>
      <span>跳躍</span>
    </button>
  </div>;
}
