import type { CSSProperties } from "react";

const SNOWFLAKES = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  x: `${(i * 4.2 + (i % 4) * 1.8) % 100}%`,
  size: `${5 + (i % 4) * 2.4}px`,
  dur: `${10 + (i % 6) * 2.5}s`,
  delay: `-${(i * 1.3) % 15}s`,
  drift: `${(i % 2 === 0 ? 1 : -1) * (14 + (i % 4) * 9)}px`,
  alpha: 0.36 + (i % 4) * 0.13,
  isStar: i % 8 === 0
}));

const GARLAND_BULBS = [
  { x: 64, y: 18, color: "#e53e3e" },
  { x: 164, y: 26, color: "#f6b73c" },
  { x: 268, y: 20, color: "#229963" },
  { x: 374, y: 28, color: "#38a3e8" },
  { x: 482, y: 18, color: "#e53e3e" },
  { x: 590, y: 27, color: "#f6b73c" },
  { x: 698, y: 19, color: "#229963" },
  { x: 806, y: 28, color: "#e53e3e" },
  { x: 914, y: 18, color: "#38a3e8" },
  { x: 1022, y: 26, color: "#f6b73c" },
  { x: 1130, y: 19, color: "#229963" }
];

/** 全站柔和飘雪与细微星光层（不遮挡交互） */
export function ChristmasSnowfall() {
  return (
    <div className="xmas-snowfall" aria-hidden="true">
      {SNOWFLAKES.map(f => (
        <span
          key={f.id}
          className={"xmas-flake" + (f.isStar ? " star" : "")}
          style={{
            "--flake-x": f.x,
            "--flake-size": f.size,
            "--flake-dur": f.dur,
            "--flake-delay": f.delay,
            "--flake-drift": f.drift,
            "--flake-alpha": f.alpha
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** 顶部柔和圣诞彩灯挂串 */
export function ChristmasGarland({ className = "" }: { className?: string }) {
  return (
    <svg className={"xmas-garland " + className} viewBox="0 0 1200 44" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0,6 Q150,36 300,14 T600,16 T900,14 T1200,8"
        fill="none"
        stroke="#276749"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {GARLAND_BULBS.map((b, idx) => (
        <g key={idx} className="xmas-bulb" style={{ color: b.color }}>
          <rect x={b.x - 3} y={b.y - 6} width="6" height="5" rx="1.5" fill="#2f5233" />
          <ellipse cx={b.x} cy={b.y + 4} rx="6.5" ry="9" fill={b.color} />
          <ellipse cx={b.x - 2} cy={b.y + 1} rx="2" ry="3.2" fill="rgba(255,255,255,0.7)" />
        </g>
      ))}
    </svg>
  );
}

/** 呆萌小雪人（戴圣诞帽 + 红围巾 + 粉色腮红） */
export function KawaiiSnowman({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      {/* 柔和地面雪影 */}
      <ellipse cx="40" cy="73" rx="22" ry="4.5" fill="#d9eaf7" />
      {/* 胖乎乎雪人身体 */}
      <circle cx="40" cy="55" r="18" fill="#ffffff" stroke="#5b4636" strokeWidth="2.8" />
      <circle cx="40" cy="52" r="2.6" fill="#d9383a" />
      <circle cx="40" cy="61" r="2.6" fill="#1d7a52" />
      {/* 树枝小手 */}
      <path d="M22 50 L11 43 M15 46 L13 40" stroke="#7c4f2b" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M58 50 L69 42 M64 46 L67 40" stroke="#7c4f2b" strokeWidth="2.8" strokeLinecap="round" />
      {/* 圆润头部 */}
      <circle cx="40" cy="31" r="14.5" fill="#ffffff" stroke="#5b4636" strokeWidth="2.8" />
      {/* 红围巾 */}
      <rect x="26" y="40" width="28" height="7" rx="3.5" fill="#e03e41" stroke="#5b4636" strokeWidth="2.4" />
      <path d="M46 46 L52 57 L44 58 L41 47 Z" fill="#e03e41" stroke="#5b4636" strokeWidth="2.2" strokeLinejoin="round" />
      {/* 眼睛与腮红 */}
      <circle cx="34.5" cy="30" r="2.3" fill="#3a2a20" />
      <circle cx="45.5" cy="30" r="2.3" fill="#3a2a20" />
      <circle cx="33.8" cy="29.3" r="0.8" fill="#ffffff" />
      <circle cx="44.8" cy="29.3" r="0.8" fill="#ffffff" />
      <ellipse cx="30" cy="33.5" rx="3.2" ry="2" fill="#ff9eb5" opacity="0.72" />
      <ellipse cx="50" cy="33.5" rx="3.2" ry="2" fill="#ff9eb5" opacity="0.72" />
      {/* 胡萝卜小鼻与微笑 */}
      <path d="M39 32 L47 34 L39 35.5 Z" fill="#f97316" stroke="#5b4636" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M36 36.5 Q40 39.5 44 36.5" fill="none" stroke="#5b4636" strokeWidth="2" strokeLinecap="round" />
      {/* 歪戴的可爱圣诞帽 */}
      <path d="M27 21 Q38 4 53 16 L51 22 L27 22 Z" fill="#e03e41" stroke="#5b4636" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="25" y="18" width="29" height="6.5" rx="3.2" fill="#fffdf9" stroke="#5b4636" strokeWidth="2.3" />
      <circle cx="55" cy="17" r="4.5" fill="#fffdf9" stroke="#5b4636" strokeWidth="2.2" />
    </svg>
  );
}

/** 软萌红鼻子小驯鹿 */
export function KawaiiReindeer({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      <ellipse cx="40" cy="73" rx="20" ry="4.5" fill="#eadbcf" />
      {/* 小鹿角 */}
      <path d="M28 24 Q20 12 22 7 M23 15 L16 14 M24 19 L29 14" fill="none" stroke="#8a5634" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M52 24 Q60 12 58 7 M57 15 L64 14 M56 19 L51 14" fill="none" stroke="#8a5634" strokeWidth="3.2" strokeLinecap="round" />
      {/* 软萌耳朵 */}
      <ellipse cx="22" cy="30" rx="7" ry="4.5" transform="rotate(-24 22 30)" fill="#c98b59" stroke="#5b4636" strokeWidth="2.5" />
      <ellipse cx="58" cy="30" rx="7" ry="4.5" transform="rotate(24 58 30)" fill="#c98b59" stroke="#5b4636" strokeWidth="2.5" />
      {/* 身体 + 圣诞绿围巾 */}
      <rect x="26" y="48" width="28" height="22" rx="12" fill="#c98b59" stroke="#5b4636" strokeWidth="2.8" />
      <ellipse cx="40" cy="60" rx="8.5" ry="7.5" fill="#f7e2c8" />
      {/* 圆润小脸 */}
      <circle cx="40" cy="35" r="16" fill="#d49866" stroke="#5b4636" strokeWidth="2.8" />
      <ellipse cx="40" cy="40" rx="10.5" ry="7.5" fill="#f9e6cf" />
      {/* 绿围巾与小金铃 */}
      <rect x="25" y="46" width="30" height="7" rx="3.5" fill="#1d7a52" stroke="#5b4636" strokeWidth="2.3" />
      <circle cx="40" cy="54" r="4.2" fill="#fbbf24" stroke="#5b4636" strokeWidth="2" />
      {/* 大眼睛、腮红、发光草莓红鼻子 */}
      <circle cx="33.5" cy="33" r="2.5" fill="#3a2a20" />
      <circle cx="46.5" cy="33" r="2.5" fill="#3a2a20" />
      <circle cx="32.8" cy="32.2" r="0.9" fill="#ffffff" />
      <circle cx="45.8" cy="32.2" r="0.9" fill="#ffffff" />
      <ellipse cx="28.5" cy="37.5" rx="3.2" ry="2" fill="#ff9eb5" opacity="0.7" />
      <ellipse cx="51.5" cy="37.5" rx="3.2" ry="2" fill="#ff9eb5" opacity="0.7" />
      <circle cx="40" cy="38.5" r="4.3" fill="#e53e3e" stroke="#5b4636" strokeWidth="2" />
      <circle cx="38.6" cy="37.2" r="1.2" fill="#ffffff" />
      <path d="M36.5 43.2 Q40 45.8 43.5 43.2" fill="none" stroke="#5b4636" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 微笑姜饼人小饼干 */
export function KawaiiGingerbread({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      <ellipse cx="40" cy="73" rx="18" ry="4" fill="#eadbcf" />
      {/* 手脚与身体 */}
      <rect x="14" y="40" width="52" height="12" rx="6" fill="#c97d42" stroke="#5b4636" strokeWidth="2.6" />
      <rect x="27" y="42" width="26" height="28" rx="12" fill="#c97d42" stroke="#5b4636" strokeWidth="2.6" />
      {/* 头部 */}
      <circle cx="40" cy="27" r="15" fill="#c97d42" stroke="#5b4636" strokeWidth="2.6" />
      {/* 白色糖霜头顶波浪 */}
      <path d="M29 19 Q34 15 40 18 T51 19" fill="none" stroke="#fffdf9" strokeWidth="3.2" strokeLinecap="round" />
      {/* 眼睛、腮红、甜笑 */}
      <circle cx="34.5" cy="26.5" r="2.3" fill="#3a2a20" />
      <circle cx="45.5" cy="26.5" r="2.3" fill="#3a2a20" />
      <circle cx="33.9" cy="25.9" r="0.8" fill="#ffffff" />
      <circle cx="44.9" cy="25.9" r="0.8" fill="#ffffff" />
      <ellipse cx="29.5" cy="30" rx="2.8" ry="1.8" fill="#ff9eb5" opacity="0.8" />
      <ellipse cx="50.5" cy="30" rx="2.8" ry="1.8" fill="#ff9eb5" opacity="0.8" />
      <path d="M35.5 32 Q40 36 44.5 32" fill="none" stroke="#fffdf9" strokeWidth="2.4" strokeLinecap="round" />
      {/* 红蝴蝶结与糖豆纽扣 */}
      <path d="M33 41 L40 44 L33 47 Z M47 41 L40 44 L47 47 Z" fill="#e03e41" stroke="#5b4636" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="40" cy="44" r="2.4" fill="#fbbf24" />
      <circle cx="40" cy="53" r="3" fill="#229963" stroke="#fffdf9" strokeWidth="1.5" />
      <circle cx="40" cy="61.5" r="3" fill="#e03e41" stroke="#fffdf9" strokeWidth="1.5" />
    </svg>
  );
}

/** 迷你可爱圣诞帽徽章（用于 Brand 标志或标题点缀） */
export function KawaiiSantaHat({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M5 22 Q13 4 26 14 L23 22 Z" fill="#e03e41" stroke="#5b4636" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="3" y="20" width="23" height="6" rx="3" fill="#fffdf9" stroke="#5b4636" strokeWidth="2" />
      <circle cx="27" cy="15" r="3.6" fill="#fffdf9" stroke="#5b4636" strokeWidth="2" />
    </svg>
  );
}

/** 底部雪丘剪影 */
export function SnowHillsFooter() {
  return (
    <svg className="xmas-snowhills" viewBox="0 0 1200 54" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,44 Q180,10 380,36 T820,28 T1200,38 L1200,54 L0,54 Z" fill="#ffffff" opacity="0.92" />
      <path d="M0,50 Q260,26 560,44 T1200,40 L1200,54 L0,54 Z" fill="#eef6ff" opacity="0.85" />
    </svg>
  );
}
