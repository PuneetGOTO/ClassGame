import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Sword } from "@phosphor-icons/react";
import type { Action } from "../shared/protocol";

type MoveDir = "left" | "right";

function keyDirection(event: KeyboardEvent): MoveDir | null {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") return "left";
  if (key === "arrowright" || key === "d") return "right";
  return null;
}

function isJumpKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return key === "arrowup" || key === "w";
}

function isAttackKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return event.code === "Space" || key === "j" || key === "k" || key === "arrowdown" || key === "enter";
}

export function DojoControls({ send }: { send: (action: Action) => Promise<void> }) {
  const sendRef = useRef(send);
  sendRef.current = send;

  const movePointer = useRef<number | null>(null);
  const jumpPointer = useRef<number | null>(null);
  const attackPointer = useRef<number | null>(null);
  const activeDir = useRef<MoveDir | null>(null);
  const heldKeys = useRef<MoveDir[]>([]);

  const [dir, setDir] = useState<MoveDir | null>(null);
  const [jumping, setJumping] = useState(false);
  const [attacking, setAttacking] = useState(false);

  const commitMove = useCallback((next: MoveDir | null) => {
    if (next === activeDir.current) return;
    activeDir.current = next;
    setDir(next);
    void sendRef.current({
      kind: "action",
      action: next === "left" ? "hold-left" : next === "right" ? "hold-right" : "release"
    });
  }, []);

  const triggerJump = useCallback(() => {
    void sendRef.current({ kind: "action", action: "jump" });
  }, []);

  const triggerAttack = useCallback(() => {
    void sendRef.current({ kind: "action", action: "attack" });
  }, []);

  function resolveMoveDir(pad: HTMLElement, clientX: number): MoveDir {
    const rect = pad.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? "left" : "right";
  }

  function startMove(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || movePointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    movePointer.current = event.pointerId;
    commitMove(resolveMoveDir(event.currentTarget, event.clientX));
  }

  function dragMove(event: PointerEvent<HTMLDivElement>) {
    if (movePointer.current !== event.pointerId) return;
    event.preventDefault();
    commitMove(resolveMoveDir(event.currentTarget, event.clientX));
  }

  function endMove(event: PointerEvent<HTMLDivElement>) {
    if (movePointer.current !== event.pointerId) return;
    movePointer.current = null;
    commitMove(null);
  }

  function startJump(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || jumpPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    jumpPointer.current = event.pointerId;
    setJumping(true);
    triggerJump();
  }

  function endJump(event: PointerEvent<HTMLButtonElement>) {
    if (jumpPointer.current !== event.pointerId) return;
    jumpPointer.current = null;
    setJumping(false);
  }

  function startAttack(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || attackPointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    attackPointer.current = event.pointerId;
    setAttacking(true);
    triggerAttack();
  }

  function endAttack(event: PointerEvent<HTMLButtonElement>) {
    if (attackPointer.current !== event.pointerId) return;
    attackPointer.current = null;
    setAttacking(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const d = keyDirection(event);
      if (d) {
        event.preventDefault();
        if (movePointer.current !== null) return;
        const next = heldKeys.current.filter(item => item !== d);
        next.push(d);
        heldKeys.current = next;
        commitMove(d);
      } else if (isJumpKey(event)) {
        event.preventDefault();
        if (event.repeat) return;
        setJumping(true);
        triggerJump();
      } else if (isAttackKey(event)) {
        if (event.code === "Space" && target?.closest("button")) return;
        event.preventDefault();
        if (event.repeat) return;
        setAttacking(true);
        triggerAttack();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      const d = keyDirection(event);
      if (d) {
        heldKeys.current = heldKeys.current.filter(item => item !== d);
        if (movePointer.current === null) {
          commitMove(heldKeys.current[heldKeys.current.length - 1] ?? null);
        }
      } else if (isJumpKey(event) && jumpPointer.current === null) {
        setJumping(false);
      } else if (isAttackKey(event) && attackPointer.current === null) {
        setAttacking(false);
      }
    }

    function reset() {
      movePointer.current = null;
      jumpPointer.current = null;
      attackPointer.current = null;
      heldKeys.current = [];
      setJumping(false);
      setAttacking(false);
      commitMove(null);
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
  }, [commitMove, triggerJump, triggerAttack]);

  return (
    <div className="dojo-controls" aria-label="和風劍道手機手掣">
      <div
        className="dojo-move-pad"
        role="group"
        aria-label="左右移動，按住並滑動切換方向"
        onPointerDown={startMove}
        onPointerMove={dragMove}
        onPointerUp={endMove}
        onPointerCancel={endMove}
        onLostPointerCapture={endMove}
        onContextMenu={event => event.preventDefault()}
      >
        <span className="dojo-move-btn" data-active={dir === "left"} aria-hidden="true">
          <ArrowLeft size={30} weight="bold" />
          <b>左移</b>
        </span>
        <span className="dojo-move-btn" data-active={dir === "right"} aria-hidden="true">
          <ArrowRight size={30} weight="bold" />
          <b>右移</b>
        </span>
      </div>

      <div className="dojo-action-group">
        <button
          type="button"
          className="dojo-jump-btn"
          data-active={jumping}
          aria-label="跳躍"
          onPointerDown={startJump}
          onPointerUp={endJump}
          onPointerCancel={endJump}
          onLostPointerCapture={endJump}
          onClick={event => { if (event.detail === 0) triggerJump(); }}
          onContextMenu={event => event.preventDefault()}
        >
          <ArrowUp size={28} weight="bold" />
          <span>跳躍</span>
        </button>

        <button
          type="button"
          className="dojo-attack-btn"
          data-active={attacking}
          aria-label="斬擊"
          onPointerDown={startAttack}
          onPointerUp={endAttack}
          onPointerCancel={endAttack}
          onLostPointerCapture={endAttack}
          onClick={event => { if (event.detail === 0) triggerAttack(); }}
          onContextMenu={event => event.preventDefault()}
        >
          <Sword size={34} weight="fill" />
          <span>斬擊</span>
        </button>
      </div>
    </div>
  );
}
