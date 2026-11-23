import type { CSSProperties } from "react";

const FAIRY_BULBS = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  tone: (["gold", "red", "mint", "ice"] as const)[i % 4]
}));

const CONFETTI_PIECES = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  x: `${4 + ((i * 4.4) % 92)}%`,
  delay: `-${(i * 0.28) % 3.2}s`,
  dur: `${2.8 + (i % 4) * 0.55}s`,
  color: ["#F4C150", "#D9383A", "#2A9DDF", "#34D399", "#FFFDF7"][i % 5],
  rot: `${(i * 37) % 360}deg`
}));

/** 屏幕最顶部极简纯 CSS 圣诞小彩灯（暖黄/浆果红/薄荷绿/冰蓝呼吸闪烁，不挡点击） */
export function TopFairyLights() {
  return (
    <div className="xmas-top-lights" aria-hidden="true">
      {FAIRY_BULBS.map(b => (
        <span key={b.id} className={"xmas-fairy-bulb tone-" + b.tone} />
      ))}
    </div>
  );
}

/** 卡片顶部光滑圆润白色积雪盖顶 SVG */
export function CardSnowCap({ className = "" }: { className?: string }) {
  return (
    <svg
      className={"xmas-snow-cap " + className}
      viewBox="0 0 320 26"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0,0 L320,0 L320,10 Q296,22 268,12 Q242,4 218,15 Q190,26 156,12 Q128,4 98,17 Q68,26 40,12 Q18,4 0,14 Z"
        fill="#FFFDF7"
      />
      <path
        d="M0,14 Q18,4 40,12 Q68,26 98,17 Q128,4 156,12 Q190,26 218,15 Q242,4 268,12 Q296,22 320,10"
        fill="none"
        stroke="rgba(167, 212, 245, 0.72)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 极简圣诞金铃铛 + 冬青叶角落点缀 SVG */
export function HollyBellCorner({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={"xmas-holly-bell " + className} aria-hidden="true">
      {/* 两片森林松木绿冬青叶 */}
      <path d="M18 12 Q8 5 4 14 Q10 18 18 15 Z" fill="#1E7A56" stroke="#125239" strokeWidth="1.6" />
      <path d="M22 12 Q32 5 36 14 Q30 18 22 15 Z" fill="#1E7A56" stroke="#125239" strokeWidth="1.6" />
      {/* 香槟金铃铛 */}
      <path
        d="M14 25 Q14 14 20 14 Q26 14 26 25 L29 29 L11 29 Z"
        fill="#F4C150"
        stroke="#9A6B11"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="31" r="2.8" fill="#D99B26" stroke="#9A6B11" strokeWidth="1.4" />
      <path d="M16.5 19 Q17.5 16.5 19.5 16.5" fill="none" stroke="#FFFDF7" strokeWidth="1.8" strokeLinecap="round" />
      {/* 浆果红小浆果 */}
      <circle cx="18" cy="12" r="2.6" fill="#D9383A" stroke="#9E1F22" strokeWidth="1.2" />
      <circle cx="22.5" cy="12" r="2.6" fill="#D9383A" stroke="#9E1F22" strokeWidth="1.2" />
      <circle cx="20.2" cy="9.5" r="2.5" fill="#EF4444" stroke="#9E1F22" strokeWidth="1.2" />
    </svg>
  );
}

/** 胜利结算弹窗顶部「圣诞红金丝带横幅」SVG */
export function VictoryRibbonBanner({ text = "MERRY VICTORY" }: { text?: string }) {
  return (
    <div className="xmas-victory-ribbon" aria-hidden="true">
      <svg viewBox="0 0 360 66" className="xmas-ribbon-svg">
        {/* 左侧折角飘带 */}
        <path d="M12 24 L56 24 L56 54 L12 54 L26 39 Z" fill="#9E1F22" />
        {/* 右侧折角飘带 */}
        <path d="M348 24 L304 24 L304 54 L348 54 L334 39 Z" fill="#9E1F22" />
        {/* 中央主丝带 */}
        <path
          d="M44 12 Q180 4 316 12 L316 46 Q180 38 44 46 Z"
          fill="#D9383A"
          stroke="#F4C150"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text
          x="180"
          y="33"
          textAnchor="middle"
          fill="#FFFDF7"
          fontSize="16"
          fontWeight="900"
          letterSpacing="2.5"
        >
          {text}
        </text>
      </svg>
    </div>
  );
}

/** 结算弹窗纯 CSS 庆贺飘落彩纸与雪星 */
export function VictoryConfetti() {
  return (
    <div className="xmas-confetti" aria-hidden="true">
      {CONFETTI_PIECES.map(p => (
        <span
          key={p.id}
          className="xmas-confetti-piece"
          style={{
            "--cf-x": p.x,
            "--cf-delay": p.delay,
            "--cf-dur": p.dur,
            "--cf-color": p.color,
            "--cf-rot": p.rot
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** 呆萌小雪人（戴圣诞帽 + 浆果红围巾 + 粉色腮红） */
export function KawaiiSnowman({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      <ellipse cx="40" cy="73" rx="22" ry="4.5" fill="rgba(42, 157, 223, 0.24)" />
      <circle cx="40" cy="55" r="18" fill="#FFFDF7" stroke="#24384E" strokeWidth="2.8" />
      <circle cx="40" cy="52" r="2.6" fill="#D9383A" />
      <circle cx="40" cy="61" r="2.6" fill="#1E7A56" />
      <path d="M22 50 L11 43 M15 46 L13 40" stroke="#7C4F2B" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M58 50 L69 42 M64 46 L67 40" stroke="#7C4F2B" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="40" cy="31" r="14.5" fill="#FFFDF7" stroke="#24384E" strokeWidth="2.8" />
      <rect x="26" y="40" width="28" height="7" rx="3.5" fill="#D9383A" stroke="#24384E" strokeWidth="2.4" />
      <path d="M46 46 L52 57 L44 58 L41 47 Z" fill="#D9383A" stroke="#24384E" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="34.5" cy="30" r="2.3" fill="#1D2C3C" />
      <circle cx="45.5" cy="30" r="2.3" fill="#1D2C3C" />
      <circle cx="33.8" cy="29.3" r="0.8" fill="#FFFDF7" />
      <circle cx="44.8" cy="29.3" r="0.8" fill="#FFFDF7" />
      <ellipse cx="30" cy="33.5" rx="3.2" ry="2" fill="#FF9EB5" opacity="0.72" />
      <ellipse cx="50" cy="33.5" rx="3.2" ry="2" fill="#FF9EB5" opacity="0.72" />
      <path d="M39 32 L47 34 L39 35.5 Z" fill="#F97316" stroke="#24384E" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M36 36.5 Q40 39.5 44 36.5" fill="none" stroke="#24384E" strokeWidth="2" strokeLinecap="round" />
      <path d="M27 21 Q38 4 53 16 L51 22 L27 22 Z" fill="#D9383A" stroke="#24384E" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="25" y="18" width="29" height="6.5" rx="3.2" fill="#FFFDF7" stroke="#24384E" strokeWidth="2.3" />
      <circle cx="55" cy="17" r="4.5" fill="#FFFDF7" stroke="#24384E" strokeWidth="2.2" />
    </svg>
  );
}

/** 软萌红鼻子小驯鹿 */
export function KawaiiReindeer({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      <ellipse cx="40" cy="73" rx="20" ry="4.5" fill="rgba(11, 29, 58, 0.24)" />
      <path d="M28 24 Q20 12 22 7 M23 15 L16 14 M24 19 L29 14" fill="none" stroke="#9B663B" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M52 24 Q60 12 58 7 M57 15 L64 14 M56 19 L51 14" fill="none" stroke="#9B663B" strokeWidth="3.2" strokeLinecap="round" />
      <ellipse cx="22" cy="30" rx="7" ry="4.5" transform="rotate(-24 22 30)" fill="#C98B59" stroke="#24384E" strokeWidth="2.5" />
      <ellipse cx="58" cy="30" rx="7" ry="4.5" transform="rotate(24 58 30)" fill="#C98B59" stroke="#24384E" strokeWidth="2.5" />
      <rect x="26" y="48" width="28" height="22" rx="12" fill="#C98B59" stroke="#24384E" strokeWidth="2.8" />
      <ellipse cx="40" cy="60" rx="8.5" ry="7.5" fill="#F7E2C8" />
      <circle cx="40" cy="35" r="16" fill="#D49866" stroke="#24384E" strokeWidth="2.8" />
      <ellipse cx="40" cy="40" rx="10.5" ry="7.5" fill="#F9E6CF" />
      <rect x="25" y="46" width="30" height="7" rx="3.5" fill="#1E7A56" stroke="#24384E" strokeWidth="2.3" />
      <circle cx="40" cy="54" r="4.2" fill="#F4C150" stroke="#24384E" strokeWidth="2" />
      <circle cx="33.5" cy="33" r="2.5" fill="#1D2C3C" />
      <circle cx="46.5" cy="33" r="2.5" fill="#1D2C3C" />
      <circle cx="32.8" cy="32.2" r="0.9" fill="#FFFDF7" />
      <circle cx="45.8" cy="32.2" r="0.9" fill="#FFFDF7" />
      <ellipse cx="28.5" cy="37.5" rx="3.2" ry="2" fill="#FF9EB5" opacity="0.7" />
      <ellipse cx="51.5" cy="37.5" rx="3.2" ry="2" fill="#FF9EB5" opacity="0.7" />
      <circle cx="40" cy="38.5" r="4.3" fill="#D9383A" stroke="#24384E" strokeWidth="2" />
      <circle cx="38.6" cy="37.2" r="1.2" fill="#FFFDF7" />
      <path d="M36.5 43.2 Q40 45.8 43.5 43.2" fill="none" stroke="#24384E" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 微笑姜饼人小饼干 */
export function KawaiiGingerbread({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className={"kawaii-mascot " + className} aria-hidden="true">
      <ellipse cx="40" cy="73" rx="18" ry="4" fill="rgba(11, 29, 58, 0.22)" />
      <rect x="14" y="40" width="52" height="12" rx="6" fill="#C97D42" stroke="#24384E" strokeWidth="2.6" />
      <rect x="27" y="42" width="26" height="28" rx="12" fill="#C97D42" stroke="#24384E" strokeWidth="2.6" />
      <circle cx="40" cy="27" r="15" fill="#C97D42" stroke="#24384E" strokeWidth="2.6" />
      <path d="M29 19 Q34 15 40 18 T51 19" fill="none" stroke="#FFFDF7" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="34.5" cy="26.5" r="2.3" fill="#1D2C3C" />
      <circle cx="45.5" cy="26.5" r="2.3" fill="#1D2C3C" />
      <circle cx="33.9" cy="25.9" r="0.8" fill="#FFFDF7" />
      <circle cx="44.9" cy="25.9" r="0.8" fill="#FFFDF7" />
      <ellipse cx="29.5" cy="30" rx="2.8" ry="1.8" fill="#FF9EB5" opacity="0.8" />
      <ellipse cx="50.5" cy="30" rx="2.8" ry="1.8" fill="#FF9EB5" opacity="0.8" />
      <path d="M35.5 32 Q40 36 44.5 32" fill="none" stroke="#FFFDF7" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M33 41 L40 44 L33 47 Z M47 41 L40 44 L47 47 Z" fill="#D9383A" stroke="#24384E" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="40" cy="44" r="2.4" fill="#F4C150" />
      <circle cx="40" cy="53" r="3" fill="#1E7A56" stroke="#FFFDF7" strokeWidth="1.5" />
      <circle cx="40" cy="61.5" r="3" fill="#D9383A" stroke="#FFFDF7" strokeWidth="1.5" />
    </svg>
  );
}

/** 迷你可爱圣诞帽徽章 */
export function KawaiiSantaHat({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M5 22 Q13 4 26 14 L23 22 Z" fill="#D9383A" stroke="#24384E" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="3" y="20" width="23" height="6" rx="3" fill="#FFFDF7" stroke="#24384E" strokeWidth="2" />
      <circle cx="27" cy="15" r="3.6" fill="#FFFDF7" stroke="#24384E" strokeWidth="2" />
    </svg>
  );
}

/** 底部冬夜雪丘剪影 */
export function SnowHillsFooter() {
  return (
    <svg className="xmas-snowhills" viewBox="0 0 1200 54" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,44 Q180,10 380,36 T820,28 T1200,38 L1200,54 L0,54 Z" fill="rgba(255,253,247,0.16)" />
      <path d="M0,50 Q260,26 560,44 T1200,40 L1200,54 L0,54 Z" fill="rgba(255,253,247,0.26)" />
    </svg>
  );
}
