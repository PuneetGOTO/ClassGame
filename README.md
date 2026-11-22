# Campus Quest 校園闖關

50 位玩家、10 支五人隊伍、三至四樓的 20 個固定房間和 20 款個人遊戲。伺服器為每位玩家安排不同的 20 關順序和任務配置。玩家用手機操作，大螢幕顯示現場 QR Code、倒數、進度和結算。

## 在 Windows 啟動

需要 **Node.js 24.11.1 或更新的 24.x LTS** 及 npm。從本專案根目錄執行下列 PowerShell 指令。

```powershell
npm.cmd ci
npm.cmd run build
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd start
```

開啟 [校園地圖](http://localhost:3000/) 或 [管理後台](http://localhost:3000/admin)。首次本機啟動會建立 `data/game.sqlite`，自動建立 10 支空隊伍和 20 個站點。若 `.env` 的金鑰欄位留空，程式會在 `data/local-credentials.json` 產生本機金鑰。使用該檔的 `adminKey` 登入後台。Linux 和 macOS 將指令中的 `npm.cmd` 改為 `npm`。

| 入口 | 用途 |
| --- | --- |
| `/`、`/?floor=4` | 三樓及四樓平面圖，點選房號查看本站遊戲 |
| `/controller` | 玩家登記、個人下一站、候場、觸控遊玩與闖關紀錄 |
| `/host?id=HOST-01` | 指定大螢幕的主機登入、入場 QR Code 與即時進度 |
| `/leaderboard` | 個人排名與隊伍排名 |
| `/admin` | 站點與隊伍管理、個人闖關進度、場次、CSV、連線及稽核 |
| `/api/health` | 確認中央伺服器可用 |

## 讓手機和大螢幕加入同一個活動

1. 將中央電腦、玩家手機及主機接入彼此可存取的校園網路。用 `ipconfig` 查中央電腦實際的區網 IPv4 位址，並允許活動網路連到伺服器的 TCP 3000。Wi-Fi 若開啟用戶端隔離，需由校園網路管理員提供可連線的活動網段。
2. 在 `.env` 設定 `PUBLIC_URL=http://192.168.1.20:3000`，把範例 IP 換成中央電腦的 IP，然後重新啟動。使用 `BIND_ADDRESS=0.0.0.0` 供區網裝置連接。先在手機瀏覽器開啟相同網址確認網路。
3. 在後台「站點管理」查看每台主機的專屬金鑰。讓固定大螢幕打開 `/host?id=HOST-01` 至 `/host?id=HOST-20`，各自輸入對應金鑰。登記後可以切換全螢幕。
4. 玩家從 `/controller` 登記後會收到第一個房間。到指定房間，用手機相機掃描大螢幕上的 QR Code，即可入場或排隊。每間房有自己的掃碼連結並每 10 秒換碼。驗證後有 90 秒完成本站入場。管理員也可預先建立玩家身分。
5. 輪到玩家時，按「我已準備好」開始 3 秒倒數，接著在手機上進行 60 秒個人任務。結算後顯示下一個房間。先完成同一樓層的任務，再到另一層。

三樓與四樓按原平面圖重繪，地圖首頁顯示樓層切換、房間輪廓和活動房號。每層配置 10 個站點。後台可更改房號、樓層與座標，也可為各樓層獨立上傳 PNG、JPEG 或 WebP。上傳上限為 1.5 MB。

## 場次與正式積分

每人從 0 分開始。難度按照個人關次提升，對應不同的題目、盤面或任務目標。

| 個人關次 | 難度 | 一般勝利 | 一般失敗 | 雙倍勝利 | 雙倍失敗 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1–5 | 入門 | +2 | +1 | +4 | −2 |
| 6–10 | 進階 | +4 | +2 | +8 | −4 |
| 11–15 | 高難 | +6 | +3 | +12 | −6 |
| 16–20 | 決賽 | +8 | +4 | +16 | −8 |

- 手機只顯示下一站。正式結算一次後才派發下一站，勝利和失敗都累計完成關數。整場未操作會作廢，需重新掃該房的最新 QR Code。20 款全部有正式結果後達成 20/20。
- 每位玩家的關卡順序和個人任務在 SQLite 保存。重連可從上一次的畫面繼續，計時依中央時鐘。活動中作廢的場次可重新挑戰同一道任務。已開始操作而結算時離線的玩家記為失敗。
- 雙倍挑戰預設 20% 機率，於開打後 6 至 16 秒的隨機時間揭曉。該關已結算時直接保留結果。機率可在「規則與稽核」調整，首次啟動後的抽籤安排會隨該個人任務保存。
- 一般規則 20 關全勝為 100 分、全敗為 50 分。隊伍榜以五位成員個人總分的平均排名。排名同分依完成關數、勝利關數、累計完成時間排序。
- 每個房間固定一款遊戲，一次接待一位玩家，其餘玩家依序候補。結果在大螢幕停留 5 秒再叫號。候場保留 90 秒，候補最多保留 20 分鐘。
- 停止或作廢場次會保留紀錄，玩家可重新掃碼挑戰同一任務。管理員重設正式比賽後開啟新一屆並重新派發路線，歷史場次保留。

## 開發與驗證

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:load
npm.cmd run build
npm.cmd run test:browser
```

開發 UI 在 `http://localhost:5173`，開發代理將 API 和 WebSocket 轉給 `PORT` 指定的 Node 伺服器。要在開發環境跨裝置測試，可在 `.env` 將 `PUBLIC_URL` 指向中央電腦的 5173 埠。瀏覽器測試需要 Chrome、Edge，或 `npx playwright install chromium` 安裝的 Chromium。以 `CHROME_PATH` 可指定瀏覽器執行檔。並發測試包含真實 60 秒遊戲，耗時約 65 秒。測試使用隔離的資料庫與環回位址。

## 正式部署

1. 執行 `npm ci` 和 `npm run build`。將 `dist/`、`package.json`、`package-lock.json`、各 workspace 的 `package.json`、遊戲源碼及上游授權檔一同保留。可在執行主機上使用 `npm ci --omit=dev` 安裝執行相依。
2. 在環境變數或 `.env` 設定 `NODE_ENV=production`、兩組不同且至少 24 字元的 `ADMIN_KEY` 和 `HOST_SECRET`，並設定 `PUBLIC_URL` 為玩家實際使用的活動入口。下列指令可為兩組金鑰各產生一次隨機值。

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

3. 在專案根目錄啟動 `npm start`。將 `DB_PATH` 指到可持久化的本機磁碟，並讓單一 Node 程序管理該活動資料庫。以服務管理器設定自動重啟時，工作目錄仍需是專案根目錄。
4. 若使用 HTTPS 入口，可把 Node 綁在 `127.0.0.1:3000`，交由反向代理對外提供 HTTPS。將 `TRUST_PROXY` 設為實際可信代理跳數，並把 `PUBLIC_URL` 設為 HTTPS 網址。Caddy 的單代理配置如下。

   ```caddyfile
   campus.example.edu {
       reverse_proxy 127.0.0.1:3000
   }
   ```

5. 活動結束後匯出成績。實體備份可在伺服器正常停止後複製 `data/game.sqlite`，連同有效的環境設定保存在受控位置。還原時先停止伺服器，再把備份放到 `DB_PATH` 後啟動。

## 專案導覽

| 目錄 | 內容 |
| --- | --- |
| `apps/server` | 權威遊戲時鐘、站點排程、管理 API、SQLite 遷移及結算 |
| `apps/controller` | 手機控制器 |
| `apps/host` | 固定主機畫面及 QR Code |
| `apps/dashboard` | 地圖、管理後台與排行榜 |
| `local-games/game-01` 至 `game-20` | 20 款可獨立登錄的伺服器遊戲插件 |
| `packages/game-sdk` | 插件生命週期、狀態存檔與共用遊戲工具 |
| `packages/shared` | 關卡目錄、限制常數及 WebSocket 型別 |
| `packages/ui` | 控制器、遊戲畫面、導覽與連線元件 |
| `tests`、`scripts` | 計分、玩法、WebSocket、負載、斷線、遷移與瀏覽器測試 |

查看 [GitHub 來源與授權](docs/sources.md)、[資料庫及通訊協定](docs/protocol.md)、[實作計畫與測試結果](docs/implementation.md)。

