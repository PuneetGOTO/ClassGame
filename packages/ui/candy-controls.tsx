import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowClockwise, ArrowDown, ArrowFatLineDown, ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import type { Action } from "../shared/protocol";

type HoldState = "left" | "right" | "down" | null;

export function CandyTetrisControls({ send }: { send: (action: Action) => Promise<void> }) {
  const sendRef = useRef(send);
  sendRef.current = send;

  const holdPointer = useRef<number | null>(null);
  const rotatePointer = useRef<number | null>(null);
  const dropPointer = useRef<number | null>(null);
  const activeHold = useRef<HoldState>(null);

  const [held, setHeld] = useState<HoldState>(null);
  const [rotating, setRotating] = useState(false);
  const [dropping, setDropping] = useState(false);

  const commitHold = useCallback((next: HoldState) => {
    if (next === activeHold.current) return;
    activeHold.current = next;
    setHeld(next);
    if (next === "left") void sendRef.current({ kind: "action", action: "hold-left" });
    else if (next === "right") void sendRef.current({ kind: "action", action: "hold-right" });
    else if (next === "down") void sendRef.current({ kind: "action", action: "duck" });
    else void sendRef.current({ kind: "action", action: "release" });
  }, []);

  const triggerRotate = useCallback(() => {
    void sendRef.current({ kind: "action", action: "rotate" });
  }, []);

  const triggerHardDrop = useCallback(() => {
    void sendRef.current({ kind: "action", action: "hard-drop" });
  }, []);

  function startHold(next: Exclude<HoldState, null>, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || holdPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    holdPointer.current = event.pointerId;
    commitHold(next);
  }

  function endHold(event: PointerEvent<HTMLButtonElement>) {
    if (holdPointer.current !== event.pointerId) return;
    holdPointer.current = null;
    commitHold(null);
  }

  function startRotate(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || rotatePointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rotatePointer.current = event.pointerId;
    setRotating(true);
    triggerRotate();
  }

  function endRotate(event: PointerEvent<HTMLButtonElement>) {
    if (rotatePointer.current !== event.pointerId) return;
    rotatePointer.current = null;
    setRotating(false);
  }

  function startDrop(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || dropPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dropPointer.current = event.pointerId;
    setDropping(true);
    triggerHardDrop();
  }

  function endDrop(event: PointerEvent<HTMLButtonElement>) {
    if (dropPointer.current !== event.pointerId) return;
    dropPointer.current = null;
    setDropping(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        if (!event.repeat && holdPointer.current === null) commitHold("left");
      } else if (key === "arrowright" || key === "d") {
        event.preventDefault();
        if (!event.repeat && holdPointer.current === null) commitHold("right");
      } else if (key === "arrowdown" || key === "s") {
        event.preventDefault();
        if (!event.repeat && holdPointer.current === null) commitHold("down");
      } else if (key === "arrowup" || key === "w") {
        event.preventDefault();
        if (event.repeat) return;
        setRotating(true);
        triggerRotate();
      } else if (event.code === "Space" || key === "enter") {
        if (event.code === "Space" && target?.closest("button")) return;
        event.preventDefault();
        if (event.repeat) return;
        setDropping(true);
        triggerHardDrop();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (holdPointer.current === null) {
        if ((key === "arrowleft" || key === "a") && activeHold.current === "left") commitHold(null);
        else if ((key === "arrowright" || key === "d") && activeHold.current === "right") commitHold(null);
        else if ((key === "arrowdown" || key === "s") && activeHold.current === "down") commitHold(null);
      }
      if ((key === "arrowup" || key === "w") && rotatePointer.current === null) setRotating(false);
      if ((event.code === "Space" || key === "enter") && dropPointer.current === null) setDropping(false);
    }

    function reset() {
      holdPointer.current = null;
      rotatePointer.current = null;
      dropPointer.current = null;
      setRotating(false);
      setDropping(false);
      commitHold(null);
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
  }, [commitHold, triggerRotate, triggerHardDrop]);

  return (
    <div className="candy-controls" aria-label="馬卡龍消行手機手掣">
      <div className="candy-move-group" role="group" aria-label="移動與軟降">
        <button
          type="button"
          className="candy-btn candy-btn-move"
          data-active={held === "left"}
          aria-label="左移"
          onPointerDown={e => startHold("left", e)}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onLostPointerCapture={endHold}
          onClick={e => { if (e.detail === 0) void send({ kind: "move", direction: "left" }); }}
          onContextMenu={e => e.preventDefault()}
        >
          <ArrowLeft size={28} weight="bold" />
          <span>左移</span>
        </button>

        <button
          type="button"
          className="candy-btn candy-btn-soft"
          data-active={held === "down"}
          aria-label="軟降"
          onPointerDown={e => startHold("down", e)}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onLostPointerCapture={endHold}
          onClick={e => { if (e.detail === 0) void send({ kind: "move", direction: "down" }); }}
          onContextMenu={e => e.preventDefault()}
        >
          <ArrowDown size={28} weight="bold" />
          <span>軟降</span>
        </button>

        <button
          type="button"
          className="candy-btn candy-btn-move"
          data-active={held === "right"}
          aria-label="右移"
          onPointerDown={e => startHold("right", e)}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onLostPointerCapture={endHold}
          onClick={e => { if (e.detail === 0) void send({ kind: "move", direction: "right" }); }}
          onContextMenu={e => e.preventDefault()}
        >
          <ArrowRight size={28} weight="bold" />
          <span>右移</span>
        </button>
      </div>

      <div className="candy-action-group">
        <button
          type="button"
          className="candy-btn candy-btn-rotate"
          data-active={rotating}
          aria-label="旋轉"
          onPointerDown={startRotate}
          onPointerUp={endRotate}
          onPointerCancel={endRotate}
          onLostPointerCapture={endRotate}
          onClick={e => { if (e.detail === 0) triggerRotate(); }}
          onContextMenu={e => e.preventDefault()}
        >
          <ArrowClockwise size={30} weight="bold" />
          <span>旋轉</span>
        </button>

        <button
          type="button"
          className="candy-btn candy-btn-drop"
          data-active={dropping}
          aria-label="一鍵瞬降"
          onPointerDown={startDrop}
          onPointerUp={endDrop}
          onPointerCancel={endDrop}
          onLostPointerCapture={endDrop}
          onClick={e => { if (e.detail === 0) triggerHardDrop(); }}
          onContextMenu={e => e.preventDefault()}
        >
          <ArrowFatLineDown size={32} weight="fill" />
          <span>瞬降</span>
        </button>
      </div>
    </div>
  );
}
