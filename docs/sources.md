# 遊戲來源、授權與相依套件

已下載並檢查下列七個 GitHub 專案的固定提交。校園版擷取所需的程式邏輯，透過伺服器插件統一處理手機操作、五人房間、60 秒時計及正式積分。關卡圖形、版面及場景由校園版繪製。

| 校園關卡 | 固定提交的來源檔 | 程式碼授權 | 融入校園版的部分 |
| --- | --- | --- | --- |
| [01 推箱子](../local-games/game-01/index.ts) | [sokoban/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/sokoban/index.html) | MIT | 推箱與格子阻擋 |
| [02 關燈解謎](../local-games/game-02/index.ts) | [lights-out/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/lights-out/index.html) | MIT | 反向洗牌與四鄰翻轉 |
| [03 水管拼接](../local-games/game-03/index.ts) | [pipe-connect/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/pipe-connect/index.html) | MIT | 樹狀管線、旋轉與連通檢查 |
| [04 交通解困](../local-games/game-04/index.ts) | [rush-hour/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/rush-hour/index.html) | MIT | 車體佔位及車輛碰撞 |
| [05 試管分色](../local-games/game-05/index.ts) | [water-sort/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/water-sort/index.html) | MIT | 試管容量及同色連續傾倒 |
| [06 號站點 · 霓虹炸彈人](../local-games/game-23/index.ts) | [ClassGame 投稿 PR #3](https://github.com/PuneetGOTO/ClassGame/pull/3) | ClassGame 貢獻程式碼 | 四人共用迷宮、縮圈、手機方向鍵與練習房 AI 補位 |
| [07 號站點 · 霓虹氣墊球](../local-games/game-22/index.ts) | [ClassGame 投稿提交 7172ac8](https://github.com/qt1988117-debug/ClassGame/commit/7172ac8f0492c1855c56a5c7e70685f1f62207d5) | ClassGame 貢獻程式碼 | 共用球桌、冰球物理、手機搖桿與 60 秒結算 |
| [08 太空守衛](../local-games/game-08/index.ts) | [star-defender/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/star-defender/index.html) | MIT | 飛船波次與彈道碰撞 |
| [09 恐龍逃亡](../local-games/game-09/index.ts) | [dino-run/index.html](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/dino-run/index.html) | MIT | 障礙時間間距、跳蹲及碰撞盒 |
| [10 心算挑戰](../local-games/game-10/index.ts) | [src/games/brain/MathChallenge.jsx](https://github.com/hajunho/zeli-web-games/blob/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c/src/games/brain/MathChallenge.jsx) | Apache-2.0 | 運算題及干擾選項，增加整數除法 |
| [11 二十四點](../local-games/game-11/index.ts) | [src/games/brain/Game24.jsx](https://github.com/hajunho/zeli-web-games/blob/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c/src/games/brain/Game24.jsx) | Apache-2.0 | 可解題組生成，以有理數運算驗證四個數字 |
| [12 質數判斷](../local-games/game-12/index.ts) | [src/games/brain/PrimeCheck.jsx](https://github.com/hajunho/zeli-web-games/blob/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c/src/games/brain/PrimeCheck.jsx) | Apache-2.0 | 試除判斷及答對門檻 |
| [13 分數比較](../local-games/game-13/index.ts) | [src/games/brain/FractionCompare.jsx](https://github.com/hajunho/zeli-web-games/blob/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c/src/games/brain/FractionCompare.jsx) | Apache-2.0 | 分數出題，增加精確相等判斷 |
| [14 迷宮尋路](../local-games/game-14/index.ts) | [server/maze.js](https://github.com/tristanbudd/minigames/blob/910480b009cf4a8f730e88ba5009d06f5187a899/server/maze.js) | MIT | 深度優先生成個人迷宮，訊號數隨難度調整 |
| [15 地圖探險](../local-games/game-15/index.ts) | [server/engine/utils.js](https://github.com/goddtriffin/Oasis/blob/e9a5edc6bffb93967bda0325bdd7e79b95fdfe01/server/engine/utils.js) | BSD-3-Clause | 平滑高度地圖及地形，個人搜尋與交付信標 |
| [16 勇者冒險](../local-games/game-16/index.ts) | [server/js/formulas.js](https://github.com/matheopalmier/browserquest/blob/69d9fc179d0c1ea012079b69bbccf7698bfd2982/server/js/formulas.js) | MPL-2.0 | 採用 MPL 戰鬥數值公式，調整短地圖的守衛與出口任務 |
| [17 號站點 · 和風劍道對決](../local-games/game-24/index.ts) | [ClassGame 投稿 PR #4](https://github.com/PuneetGOTO/ClassGame/pull/4) | ClassGame 貢獻程式碼 | 雙人與 2 對 2 共用演武場、手機跳躍與斬擊、限時血量結算 |
| [18 數學快答](../local-games/game-18/index.ts) | [games/mathduel.js](https://github.com/assishmoncs/battlebox/blob/072659ace68261e05ce0d7b8f3d4e2fc2c9970a7/games/mathduel.js) | MIT | 沿用限時算術概念，個人題流與數字輸入 |
| [19 號站點 · 史萊姆排球](../local-games/game-21/index.ts) | [ClassGame 投稿 PR #1](https://github.com/PuneetGOTO/ClassGame/pull/1) | ClassGame 貢獻程式碼 | 共用球場、排球物理及即時畫面，整合正式配對和 60 秒結算 |
| [20 數學破磚](../local-games/game-20/index.ts) | [src/games/brain/MathBreakout.jsx](https://github.com/hajunho/zeli-web-games/blob/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c/src/games/brain/MathBreakout.jsx) | Apache-2.0 | 個人題流與答題破磚，磚數隨難度提升 |

## 上游可執行性與相依

| 專案 | 上游主要相依 | 本機檢查 |
| --- | --- | --- |
| [Web Games](https://github.com/mashukui/web-games/tree/2770860c6e2b3ab8144a56462d8178fe7e3445c7) | 獨立 HTML、Canvas、共用 `i18n.js` | 9 個 HTML 入口以 Chromium 開啟，頁面腳本可執行 |
| [Zeli Web Games](https://github.com/hajunho/zeli-web-games/tree/ba9938eb222cb588ae7b0a6056ba6bdda89dcd9c) | React 18、Vite 5 | 上游鎖定相依安裝及正式建置通過，建置包含指定的五個遊戲元件 |
| [Minigames](https://github.com/tristanbudd/minigames/tree/910480b009cf4a8f730e88ba5009d06f5187a899) | Node.js、`ws` | `server/maze.js` 啟動並接受 WebSocket，原本以五人輪流淘汰為主 |
| [Oasis](https://github.com/goddtriffin/Oasis/tree/e9a5edc6bffb93967bda0325bdd7e79b95fdfe01) | Express、Socket.IO、SQLite3、bcryptjs、Axios、Sentry | 鎖定相依安裝成功。原伺服器缺少 `SENTRY_DSN` 時退出。有關地形程式已在校園插件測試 |
| [BrowserQuest](https://github.com/matheopalmier/browserquest/tree/69d9fc179d0c1ea012079b69bbccf7698bfd2982) | Socket.IO、Express、underscore、bison、log、sanitizer、memcache | 依上游相依宣告在本機安裝後，原伺服器以 Node 24 啟動時遇到路徑型別錯誤。程式碼與美術的授權分開處理 |
| [WebCraft](https://github.com/simon-borjeson/WebCraft/tree/8854deafc80e535d2580835786b18269c8eb3bc9) | Express 4、Socket.IO 4、前端 Three.js CDN | 上游伺服器啟動且回應 HTTP。校園版本採輕量的二維格子場景 |
| [BattleBox](https://github.com/assishmoncs/battlebox/tree/072659ace68261e05ce0d7b8f3d4e2fc2c9970a7) | Node.js 22+、Express、Socket.IO、Helmet、Jest | 上游伺服器啟動且回應 HTTP，Number Hunt 的 5 個上游測試通過 |

校園版只需要根目錄 [package.json](../package.json) 中的依賴，完整版本由 [package-lock.json](../package-lock.json) 定位。伺服器使用 Express、Socket.IO、Zod 與 Node 的 `node:sqlite`。介面使用 React、Vite、QRCode、Phosphor Icons 和 Geist。正式部署將所有前端資產從中央伺服器送出，遊玩期間可以使用無外網的區網。

史萊姆排球取自 [投稿提交 97e71b6](https://github.com/qt1988117-debug/ClassGame/commit/97e71b60a5303b2663623ecb7907d42dd821acd6)，不增加執行相依。已下架的數字推理仍以原遊戲 ID 保留成績，歷史程式碼保有 [BattleBox 的 MIT 來源](https://github.com/assishmoncs/battlebox/blob/072659ace68261e05ce0d7b8f3d4e2fc2c9970a7/games/numberhunt.js)。

霓虹氣墊球使用現有的瀏覽器和伺服器相依套件。已下架的穿越馬路仍以原遊戲 ID 保留成績，歷史程式碼保有 [Web Games 的 MIT 來源](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/cross-road/index.html)。

兩款新遊戲的圖形和音效由投稿程式透過 Canvas 與 Web Audio 繪製及產生，沿用原有相依套件。迷宮吃豆和龍之遠征以原 ID 保留成績。歷史程式碼分別保有 [Web Games 的 MIT 來源](https://github.com/mashukui/web-games/blob/2770860c6e2b3ab8144a56462d8178fe7e3445c7/maze-muncher/index.html)及 [WebCraft 的 MIT 來源](https://github.com/simon-borjeson/WebCraft/blob/8854deafc80e535d2580835786b18269c8eb3bc9/server/src/index.js)。

上游授權全文在 [LICENSES](../local-games/LICENSES/) 中。BrowserQuest 的 MPL-2.0 改編程式保持為獨立的 [upstream-combat.ts](../local-games/game-16/upstream-combat.ts)，附授權全文及固定來源。校園版遊戲畫面與地圖為原創，BrowserQuest 的原作美術、音訊與內容授權資料請見上游的 [授權說明](https://github.com/matheopalmier/browserquest/blob/69d9fc179d0c1ea012079b69bbccf7698bfd2982/LICENSE)。

