import { useEffect, useRef, useState } from "react";
import { DeviceRotate } from "@phosphor-icons/react";

const portraitTouchQuery = "(orientation: portrait) and (pointer: coarse)";
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

export function useGameOrientation(active: boolean) {
  const [portrait, setPortrait] = useState(() => matchMedia(portraitTouchQuery).matches);
  const [lockFailed, setLockFailed] = useState(false);
  const wantsLandscape = useRef(active);
  const ownsFullscreen = useRef(false);
  const locking = useRef(false);
  wantsLandscape.current = active;

  useEffect(() => {
    const query = matchMedia(portraitTouchQuery);
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function exitOwnedFullscreen() {
    if (!ownsFullscreen.current) return;
    ownsFullscreen.current = false;
    if (document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }

  useEffect(() => {
    if (!active) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) ownsFullscreen.current = false;
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      wantsLandscape.current = false;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      exitOwnedFullscreen();
    };
  }, [active]);

  const orientation = window.screen.orientation as LockableOrientation | undefined;
  const lockLandscape = !lockFailed && document.fullscreenEnabled && orientation?.lock ? async () => {
    if (locking.current) return;
    locking.current = true;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        ownsFullscreen.current = true;
      }
      if (wantsLandscape.current) await orientation.lock!("landscape");
      else exitOwnedFullscreen();
    } catch {
      exitOwnedFullscreen();
      setLockFailed(true);
    } finally {
      locking.current = false;
    }
  } : undefined;

  return { portrait, lockLandscape };
}

export function RotateGameNotice({ lockLandscape }: { lockLandscape?: () => Promise<void> }) {
  return <div className="rotate-game-notice">
    <DeviceRotate size={32} weight="duotone" aria-hidden="true"/>
    <div role="status">
      <strong>請將手機轉成橫向</strong>
      <p>畫面未轉動時，請關閉手機的直向鎖定。</p>
    </div>
    {lockLandscape && <button type="button" className="button secondary" onClick={() => void lockLandscape()}>切換橫向全螢幕</button>}
  </div>;
}
