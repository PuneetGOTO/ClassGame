import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";

const password = "standalone-browser-test-admin-key";
const hostSecret = "standalone-browser-test-host-key";
const hostKey = id => createHmac("sha256", hostSecret).update("campus-host:" + id).digest("base64url");
const temp = await mkdtemp(join(tmpdir(), "campus-browser-"));
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["dist/server.mjs"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), BIND_ADDRESS: "127.0.0.1", ADMIN_KEY: password, NODE_ENV: "production",
    HOST_SECRET: hostSecret, DB_PATH: join(temp, "test.sqlite"), PUBLIC_URL: origin }
});
let output = "";
child.stdout.on("data", value => output += value);
child.stderr.on("data", value => output += value);
let browser;
try {
  await eventually(async () => {
    assert.equal((await fetch(origin + "/api/health")).ok, true);
  });
  const managed = process.env.CHROME_PATH || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].find(path => existsSync(path));
  browser = await chromium.launch({ executablePath: managed, headless: true });
  const consoleErrors = [];
  function track(page) {
    page.on("pageerror", error => consoleErrors.push(error.message));
    page.on("console", entry => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
  }
  const dashboard = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  track(dashboard);
  await dashboard.goto(origin);
  await dashboard.getByRole("heading", { name: "樓層地圖", exact: true }).waitFor({ state: "attached" });
  await eventually(async () => assert.equal(await dashboard.locator(".map-marker").count(), 10));
  await dashboard.getByRole("img",{ name: "三樓平面圖" }).waitFor();
  await dashboard.getByRole("button", { name: "4 樓", exact: true }).click();
  await dashboard.getByRole("img",{ name: "四樓平面圖" }).waitFor();
  assert.equal(await dashboard.getByRole("img",{ name: "四樓平面圖" }).evaluate(canvas => canvas.getContext("2d").getImageData(450,850,1,1).data[3]),255);
  assert.equal(await dashboard.locator(".map-marker").count(),10);
  await dashboard.getByRole("button", { name: /414 室 · 史萊姆排球/ }).waitFor();
  await dashboard.getByRole("button", { name: /415 室 · 數學破磚/ }).click();
  await dashboard.getByRole("heading", { name: "四樓 415 室" }).waitFor();
  assert.equal(await dashboard.getByRole("dialog").getByRole("link").count(),0);
  await dashboard.getByRole("button", { name: "關閉" }).click();
  assert.doesNotMatch(await dashboard.locator("main").innerText(),/澳門坊|逃生|走火|掃碼入場/);
  for (const width of [1440,1024,820,768,390,320]) {
    await dashboard.setViewportSize({ width, height: 900 });
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "map overflow at " + width);
  }
  await dashboard.setViewportSize({ width: 1440, height: 900 });
  if (process.env.CAMPUS_SCREENSHOTS) {
    await mkdir("test-results", { recursive: true });
    await dashboard.screenshot({ path: "test-results/floor-4.png", animations: "disabled" });
  }
  await dashboard.getByRole("button", { name: "3 樓", exact: true }).click();
  await dashboard.getByRole("img",{ name: "三樓平面圖" }).waitFor();
  if (process.env.CAMPUS_SCREENSHOTS) {
    await dashboard.screenshot({ path: "test-results/floor-3.png", animations: "disabled" });
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await dashboard.screenshot({ path: "test-results/floor-3-mobile.png", animations: "disabled" });
  }
  async function setChance(doubleChance) {
    const update = await fetch(origin + "/api/admin/rules", {
      method: "PUT", headers: { Authorization: "Bearer " + password, "Content-Type": "application/json" },
      body: JSON.stringify({ doubleChance })
    });
    assert.equal(update.ok,true);
  }
  await setChance(100);

  async function openHost(id, onPage) {
    const screen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    track(screen);
    onPage?.(screen);
    await screen.goto(origin + "/host?id=" + id);
    await screen.getByLabel("主機金鑰").fill(hostKey(id));
    await screen.getByRole("button", { name: "連線至站點" }).click();
    await screen.getByAltText("手機入場 QR Code").waitFor();
    return screen;
  }
  const host = await openHost("HOST-10");
  const oldEntry = await freshEntry(host);
  const oldImage = await host.getByAltText("手機入場 QR Code").getAttribute("src");
  assert.equal(new URL(oldEntry).searchParams.get("station"), "STATION-10");
  await freshEntry(host, oldEntry);
  assert.notEqual(await host.getByAltText("手機入場 QR Code").getAttribute("src"), oldImage);

  const players = await Promise.all(Array.from({ length: 4 }, (_, index) => browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true
  }).then(page => {
    track(page);
    return { name: index ? "測試玩家 " + index : "瀏覽器玩家", page, actions: watchActions(page, "game:input") };
  })));
  await players[0].page.goto(oldEntry);
  await players[0].page.getByRole("alert").getByText(/QR Code 已過期/).waitFor();
  await Promise.all(players.map(async ({ name, page }) => {
    await page.goto(origin + "/controller");
    await page.getByRole("button", { name: "暱稱登記", exact: true }).click();
    await page.getByLabel("玩家名稱").fill(name);
    await page.getByRole("button", { name: "加入活動" }).click();
    await page.getByRole("heading", { name: "準備下一關" }).waitFor();
    assert.match(await page.locator(".route-card").innerText(), /0 \/ 10 關/);
  }));
  await Promise.all(players.map(({ page }) => page.getByRole("button", { name: "尋找對手" }).click()));
  await Promise.all(players.map(({ page }) => page.getByRole("heading", { name: "前往對戰房間" }).waitFor()));
  const phone = players[0].page;
  const mapLink = await phone.getByRole("link", { name: "查看房間位置" }).getAttribute("href");
  assert.match(mapLink, /station=STATION-10/);
  await dashboard.goto(origin + mapLink);
  await dashboard.locator('.map-marker[data-destination="true"]').waitFor();
  const wrongHost = await openHost("HOST-01");
  const code = url => new URLSearchParams(new URL(url).hash.slice(1)).get("scan");
  assert.notEqual(code(await freshEntry(wrongHost)), code(await freshEntry(host)));
  await phone.goto(await freshEntry(wrongHost));
  await phone.getByRole("alert").getByText(/本場請前往/).waitFor();
  assert.equal(await phone.getByRole("button", { name: "我已準備好" }).count(), 0);
  for (const { page } of players) {
    await page.goto(await freshEntry(host));
    await page.getByRole("button", { name: "我已準備好" }).click();
  }
  const panels = host.locator(".arena-panel");
  await panels.nth(1).getByRole("heading").waitFor();
  await host.getByText("2 對 2", { exact: true }).waitFor();
  await Promise.all(players.map(async ({ page }) => {
    await page.getByRole("button", { name: "A", exact: true }).waitFor();
    assert.equal(await page.locator(".quiz-prompt, .board, .arcade, .arena-panel").count(), 0);
  }));
  assert.equal(await panels.count(), 2);
  assert.equal(await panels.nth(0).locator(".arena-side-names span").count(), 2);
  assert.equal(await panels.nth(1).locator(".arena-side-names span").count(), 2);
  for (const width of [390, 320]) {
    await phone.setViewportSize({ width, height: 844 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "controller overflow at " + width);
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  for (const [width, height] of [[1440,900],[1024,768],[768,768]]) {
    await host.setViewportSize({ width, height });
    assert.equal(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "host overflow at " + width);
  }
  await host.setViewportSize({ width: 1440, height: 900 });

  const originalSeat = await phone.locator(".remote-player strong").innerText();
  await phone.reload();
  await phone.getByRole("button", { name: "A", exact: true }).waitFor();
  assert.equal(await phone.locator(".remote-player strong").innerText(), originalSeat);
  const sides = [[], []];
  for (const player of players) {
    const side = Number(await player.page.locator(".remote-player").getAttribute("data-side"));
    sides[side].push(player);
  }
  const firstSide = Number(await phone.locator(".remote-player").getAttribute("data-side"));
  const winners = sides[firstSide], losers = sides[1-firstSide];
  const winnerBoard = panels.nth(firstSide), loserBoard = panels.nth(1-firstSide);
  const attempted = async (panel, count) => eventually(async () => assert.equal(await panel.locator(".quiz-meta strong").first().innerText(), String(count)));
  async function tapAnswer(player, panel, correct = true) {
    const text = await panel.locator(".quiz-prompt").innerText();
    const [left, operator, right] = text.split(" ");
    const a = Number(left), b = Number(right);
    const answer = operator === "+" ? a + b : operator === "−" ? a - b : operator === "×" ? a * b : a / b;
    assert.ok(Number.isInteger(answer));
    const options = await panel.locator(".arena-options > div span").allInnerTexts();
    const index = options.findIndex(value => Number(value) === answer);
    assert.ok(index >= 0);
    const letter = "ABCD"[correct ? index : (index + 1) % options.length];
    await player.page.getByRole("button", { name: letter, exact: true }).tap();
  }
  if (process.env.CAMPUS_SCREENSHOTS) {
    await phone.screenshot({ path: "test-results/phone-remote.png", animations: "disabled" });
    await host.screenshot({ path: "test-results/host-doubles.png", animations: "disabled" });
  }
  for (const [index, player] of losers.entries()) {
    await tapAnswer(player, loserBoard, false);
    await attempted(loserBoard, index + 1);
  }
  await tapAnswer(winners[0], winnerBoard);
  await attempted(winnerBoard, 1);
  await phone.getByText(/請等候 [12] 秒再作答/).waitFor();
  assert.equal(await phone.getByRole("button", { name: "A", exact: true }).isDisabled(), true);
  assert.equal(await winners[1].page.getByRole("button", { name: "A", exact: true }).isEnabled(), true);
  await host.getByText(/抽中雙倍挑戰/).waitFor({ timeout: 18_000 });
  for (let i = 1; i < 4; i++) {
    await tapAnswer(winners[i % 2], winnerBoard);
    if (i < 3) await attempted(winnerBoard, i + 1);
  }
  await host.getByText(firstSide === 0 ? "藍方獲勝" : "橙方獲勝", { exact: true }).waitFor();
  await Promise.all(winners.map(({ page }) => page.getByRole("heading", { name: "闖關成功" }).waitFor()));
  await Promise.all(losers.map(({ page }) => page.getByRole("heading", { name: "挑戰失敗" }).waitFor()));
  assert.match(await phone.locator(".result-points").innerText(), /\+[24] 分/);
  await phone.getByRole("button", { name: "繼續闖關" }).click();
  assert.match(await phone.locator(".route-card").innerText(), /1 \/ 10 關/);
  await phone.getByRole("button", { name: "我的闖關紀錄" }).click();
  await phone.getByRole("dialog").getByText("1 · 心算挑戰").waitFor();

  await dashboard.goto(origin + "/leaderboard");
  assert.match(await dashboard.getByRole("row", { name: /瀏覽器玩家/ }).innerText(), /1 \/ 10/);
  await dashboard.getByRole("button", { name: "隊伍排行" }).click();
  assert.equal(await dashboard.locator("tbody tr").count(), 10);

  await wrongHost.close();
  let pipeHost = await openHost("HOST-03");
  const rival = losers[0].page;
  await Promise.all([phone, rival].map(async page => {
    await page.goto(origin + "/controller");
    await page.getByRole("button", { name: "繼續闖關" }).click();
    await page.getByRole("button", { name: "尋找對手" }).click();
    await page.getByRole("heading", { name: "前往對戰房間" }).waitFor({ timeout: 15_000 });
    assert.match(await page.locator(".route-card").innerText(), /水管拼接/);
    await page.goto(await freshEntry(pipeHost));
    await page.getByRole("button", { name: "我已準備好" }).click();
  }));
  const direction = phone.getByRole("button", { name: "向下" });
  await direction.waitFor();
  const pipeSide = Number(await phone.locator(".remote-player").getAttribute("data-side"));
  const activePipe = pipeHost.locator(".arena-panel").nth(pipeSide);
  const cursorIndex = () => activePipe.locator(".arena-cursor").evaluate(tile => Array.from(tile.parentElement.children).indexOf(tile));
  const before = await cursorIndex();
  const bounds = await direction.boundingBox();
  await phone.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await phone.mouse.down();
  await eventually(async () => assert.equal(await cursorIndex(), before + 6));
  await phone.mouse.up();
  await phone.getByRole("button", { name: "確認", exact: true }).tap();
  assert.equal(await phone.locator(".board").count(), 0);
  if (process.env.CAMPUS_SCREENSHOTS) {
    await pipeHost.screenshot({ path: "test-results/host-pipe-duel.png", animations: "disabled" });
    await phone.screenshot({ path: "test-results/phone-direction.png", animations: "disabled" });
  }
  const volunteer = losers[1].page;
  await volunteer.goto(origin + "/controller");
  await volunteer.getByRole("button", { name: "繼續闖關" }).click();
  await volunteer.getByRole("button", { name: "報名陪打" }).tap();
  await volunteer.getByRole("heading", { name: "等候陪打配對" }).waitFor();
  await volunteer.getByRole("button", { name: "取消陪打" }).tap();
  await volunteer.getByRole("button", { name: "尋找對手" }).waitFor();

  await pipeHost.close();
  const paused = phone.getByText(/大螢幕連線中斷，遊戲已暫停/);
  await paused.waitFor();
  const frozenTime = await phone.locator(".play-clock").innerText();
  await direction.waitFor({ state: "hidden" });
  await wait(1100);
  assert.equal(await phone.locator(".play-clock").innerText(), frozenTime);
  pipeHost = await openHost("HOST-03");
  await direction.waitFor();
  await paused.waitFor({ state: "hidden" });
  assert.equal(await pipeHost.locator(".arena-panel .board").count(), 2);

  if (!process.env.SKIP_BROWSER_ADMIN) {
    await dashboard.goto(origin + "/admin");
    await dashboard.getByLabel("管理金鑰").fill(password);
    await dashboard.getByRole("button", { name: "開啟管理後台" }).click();
    await dashboard.getByRole("heading", { name: "管理後台", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "玩家與隊伍" }).click();
    await dashboard.getByRole("rowheader", { name: "瀏覽器玩家", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "批量新增", exact: true }).click();
    const importDialog = dashboard.getByRole("dialog");
    await importDialog.getByLabel("學生名單").fill("00123\t林同學\n00124,陳同學");
    await importDialog.getByRole("button", { name: "匯入名單並產生登入碼" }).click();
    const credentialsDialog = dashboard.getByRole("dialog").filter({ hasText: "學生登入資料" });
    await credentialsDialog.getByRole("rowheader", { name: "林同學", exact: true }).waitFor();
    const studentCode = await credentialsDialog.getByRole("row").filter({ hasText: "林同學" }).locator(".issued-code").innerText();
    assert.match(studentCode, /^\d{8}$/);
    await credentialsDialog.getByRole("button", { name: "關閉", exact: true }).click();
    await dashboard.getByLabel("搜尋玩家").fill("00123");
    await dashboard.getByRole("row").filter({ hasText: "00123" }).waitFor();
    assert.equal(await dashboard.getByRole("row").filter({ hasText: "00124" }).count(), 0);
    await dashboard.getByRole("button", { name: "關閉暱稱登記" }).click();
    await dashboard.getByRole("button", { name: "開放暱稱登記" }).waitFor();
    const studentPhone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    track(studentPhone);
    await studentPhone.goto(origin + "/controller");
    await studentPhone.getByLabel("學生證號碼").waitFor();
    const loginButton = studentPhone.getByRole("button", { name: "登入活動", exact: true });
    assert.equal(await studentPhone.getByRole("button", { name: "暱稱登記", exact: true }).count(), 0);
    assert.equal(await studentPhone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CAMPUS_SCREENSHOTS) await studentPhone.screenshot({ path: "test-results/student-login.png", animations: "disabled" });
    await studentPhone.getByLabel("學生證號碼").fill("00123");
    await studentPhone.getByLabel("登入碼").fill(studentCode);
    await loginButton.click();
    await studentPhone.getByText("林同學", { exact: true }).waitFor();
    assert.equal(await studentPhone.getByText("00123", { exact: true }).count(), 0);
    await studentPhone.reload();
    await studentPhone.getByText("林同學", { exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "場次紀錄" }).click();
    await dashboard.getByRole("button", { name: "查看結算" }).first().click();
    await dashboard.getByRole("dialog").getByRole("rowheader", { name: "瀏覽器玩家", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "撤銷成績", exact: true }).click();
    await dashboard.getByLabel("撤銷原因").fill("瀏覽器驗證原始成績的撤銷");
    await dashboard.getByRole("button", { name: "確認撤銷成績" }).click();
    await dashboard.getByText("已撤銷場次成績，排行榜已更新").waitFor();
    await dashboard.getByText("成績已撤銷", { exact: true }).waitFor();
    await eventually(async () => {
      const campus = await (await fetch(origin + "/api/campus")).json();
      assert.ok(campus.leaderboard.players.every(player => player.totalScore === 0));
    });
    const downloadPromise = dashboard.waitForEvent("download");
    await dashboard.getByRole("button", { name: "匯出 CSV" }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "campus-scores.csv");
    await dashboard.getByRole("button", { name: "排行榜管理" }).click();
    const oldEdition = await dashboard.getByLabel("比賽屆別").locator("option").first().innerText();
    const oldId = oldEdition.match(/\d+/)[0];
    const reset = dashboard.getByRole("button", { name: "重置第 " + oldId + " 屆", exact: true });
    await reset.click();
    const resetDialog = dashboard.getByRole("dialog");
    assert.equal(await resetDialog.getByRole("button", { name: "確認重置排行榜" }).isDisabled(), true);
    await resetDialog.getByLabel("重置原因").fill("瀏覽器封存測試");
    await resetDialog.getByLabel("輸入 RESET 確認").fill("RESET");
    await resetDialog.getByRole("button", { name: "確認重置排行榜" }).click();
    await dashboard.getByText("已封存舊屆並開啟新一屆", { exact: true }).waitFor();
    await dashboard.getByLabel("比賽屆別").selectOption(oldId);
    await dashboard.getByText("封存原因 · 瀏覽器封存測試", { exact: true }).waitFor();
    await dashboard.getByRole("rowheader", { name: "林同學", exact: true }).waitFor();
    const archiveDownload = dashboard.waitForEvent("download");
    await dashboard.getByRole("button", { name: "匯出個人 CSV", exact: true }).click();
    assert.equal((await archiveDownload).suggestedFilename(), "campus-scores-edition-" + oldId + ".csv");
    if (process.env.CAMPUS_SCREENSHOTS) {
      await dashboard.screenshot({ path: "test-results/admin-leaderboard-editions.png", animations: "disabled" });
      await dashboard.setViewportSize({ width: 390, height: 844 });
      assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await dashboard.setViewportSize({ width: 1440, height: 900 });
    }
    await dashboard.getByRole("button", { name: "規則與稽核" }).click();
    await dashboard.getByLabel(/每場觸發機率/).fill("20");
    await dashboard.getByRole("button", { name: "儲存遊戲規則" }).click();
    await dashboard.getByText("雙倍挑戰機率已更新").waitFor();

    await dashboard.getByRole("button", { name: "測試遊戲" }).click();
    let practiceCourt;
    dashboard.context().once("page", page => { practiceCourt = watchVolleyballCourt(page, "practice:state"); });
    const [practiceScreen] = await Promise.all([
      dashboard.waitForEvent("popup"),
      dashboard.getByRole("link", { name: "開啟測試大螢幕" }).click()
    ]);
    track(practiceScreen);
    await practiceScreen.getByText("等待手機掃碼連線").waitFor();
    const practiceActions = new Map();
    const practicePhones = await Promise.all(["P1", "P2"].map(async role => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      track(page);
      practiceActions.set(page, watchActions(page, "practice:input"));
      const fresh = await practiceScreen.waitForFunction(seat => {
        const link = document.querySelector('.practice-seat a[href*="role=' + seat + '"]');
        if (!link?.querySelector("img")) return false;
        const key = new URLSearchParams(new URL(link.href).hash.slice(1)).get("key");
        return key && Number(key.split(".")[0]) > Date.now() + 2500 ? link.href : false;
      }, role, { timeout: 15_000 });
      await page.goto(await fresh.jsonValue());
      await page.locator(".remote-player").getByText(role, { exact: false }).waitFor();
      return page;
    }));
    await practiceScreen.getByText("兩支手掣已連線").waitFor();
    assert.equal(await practicePhones[0].locator("select option").count(), 20);
    assert.equal(await practicePhones[0].locator("option[value='game-19']").count(), 0);
    await practiceScreen.getByRole("heading", { name: "史萊姆排球", exact: true }).waitFor();
    await practiceScreen.getByRole("button", { name: "開始測試" }).click();
    await practiceScreen.getByLabel("史萊姆排球實況畫面").waitFor();
    assert.equal(await practiceScreen.locator(".volleyball-score").count(), 2);
    await checkVolleyballRemote(practicePhones[0], practiceActions.get(practicePhones[0]), practiceCourt);
    await practicePhones[1].getByRole("button", { name: "跳躍擊球" }).tap();
    await eventually(() => assert.deepEqual(practiceActions.get(practicePhones[1]), ["jump"]));
    if (process.env.CAMPUS_SCREENSHOTS) {
      await practiceScreen.screenshot({ path: "test-results/volleyball-screen.png", animations: "disabled" });
      await practicePhones[0].screenshot({ path: "test-results/volleyball-controller.png", animations: "disabled" });
    }
    await practiceScreen.getByRole("button", { name: "結束這局" }).click();
    await practicePhones[0].getByLabel("選擇遊戲").selectOption("game-10");
    await practiceScreen.getByRole("heading", { name: "心算挑戰", exact: true }).waitFor();
    await practicePhones[1].getByRole("heading", { name: "心算挑戰", exact: true }).waitFor();
    await practicePhones[1].getByRole("button", { name: "開始測試" }).tap();
    await practiceScreen.locator(".arena-panel").nth(1).waitFor();
    await practicePhones[0].getByRole("button", { name: "A", exact: true }).tap();
    await eventually(async () => assert.equal(await practiceScreen.locator(".arena-panel").first()
      .locator(".quiz-meta strong").first().innerText(), "1"));
    await practicePhones[0].getByText(/請等候 [12] 秒再作答/).waitFor();
    assert.equal(await practicePhones[0].getByRole("button", { name: "A", exact: true }).isDisabled(), true);
    assert.equal(await practicePhones[1].getByRole("button", { name: "A", exact: true }).isEnabled(), true);
    await practicePhones[1].getByRole("button", { name: "A", exact: true }).tap();
    await attempted(practiceScreen.locator(".arena-panel").nth(1), 1);
    assert.equal(await practicePhones[0].locator(".quiz-prompt, .board, .arena-panel").count(), 0);
    if (process.env.CAMPUS_SCREENSHOTS) {
      await practiceScreen.screenshot({ path: "test-results/practice-screen.png", animations: "disabled" });
      await practicePhones[0].screenshot({ path: "test-results/practice-controller.png", animations: "disabled" });
    }
    await practicePhones[0].getByRole("button", { name: "結束這局" }).tap();
    await practicePhones[0].getByLabel("選擇遊戲").selectOption("game-11");
    await practicePhones[1].getByRole("heading", { name: "二十四點", exact: true }).waitFor();
    await practiceScreen.getByRole("button", { name: "開始測試" }).click();
    const expression = practicePhones[0].getByRole("textbox", { name: "輸入算式" });
    await practicePhones[0].setViewportSize({ width: 320, height: 568 });
    await practicePhones[0].getByRole("button", { name: "1", exact: true }).tap();
    assert.equal(await expression.inputValue(), "1");
    const confirmOnScreen = await practicePhones[0].getByRole("button", { name: "確認答案" }).evaluate(button => {
      const rect = button.getBoundingClientRect();
      return scrollY === 0 && rect.top >= 0 && rect.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
    });
    assert.equal(confirmOnScreen, true, "expression submit must fit at 320 × 568");
    if (process.env.CAMPUS_SCREENSHOTS) {
      await practicePhones[0].screenshot({ path: "test-results/game24-compact.png", animations: "disabled" });
    }
    await practicePhones[0].getByRole("button", { name: "確認答案" }).tap();
    await practicePhones[0].getByText(/請等候 [12] 秒再作答/).waitFor();
    assert.equal(await expression.isDisabled(), true);
    assert.equal(await practicePhones[0].getByRole("button", { name: "+", exact: true }).isDisabled(), true);
    assert.equal(await practicePhones[1].getByRole("textbox", { name: "輸入算式" }).isEnabled(), true);
    if (process.env.CAMPUS_SCREENSHOTS) {
      await practicePhones[0].screenshot({ path: "test-results/practice-answer-wait.png", animations: "disabled" });
    }
    await expression.fill("2");
    await practicePhones[0].getByRole("button", { name: "確認答案" }).tap();
    await attempted(practiceScreen.locator(".arena-panel").first(), 2);
    await practicePhones[0].setViewportSize({ width: 390, height: 844 });
    await practicePhones[0].getByRole("button", { name: "結束這局" }).tap();
    await practicePhones[1].getByLabel("選擇遊戲").selectOption("game-03");
    await practiceScreen.getByRole("heading", { name: "水管拼接", exact: true }).waitFor();
    await practiceScreen.getByRole("button", { name: "開始測試" }).click();
    await practicePhones[0].getByRole("button", { name: "向下" }).waitFor();
    assert.equal(await practiceScreen.locator(".arena-panel .board").count(), 2);
    for (const width of [1440, 1024, 768, 390]) {
      await practiceScreen.setViewportSize({ width, height: 900 });
      assert.equal(await practiceScreen.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await practiceScreen.setViewportSize({ width: 1440, height: 900 });
    await practicePhones[0].getByRole("button", { name: "結束這局" }).tap();
    await practicePhones[0].getByLabel("選擇遊戲").selectOption("game-13");
    await practicePhones[1].getByRole("heading", { name: "分數比較", exact: true }).waitFor();
    await practicePhones[1].getByRole("button", { name: "開始測試" }).tap();
    const practicePanels = practiceScreen.locator(".arena-panel");
    await practicePanels.nth(1).waitFor();
    for (const [side, correctCount] of [[0, 1], [1, 3]]) {
      const panel = practicePanels.nth(side);
      for (let i = 0; i < 5; i++) {
        const [a, b, c, d] = (await panel.locator(".quiz-prompt").innerText()).match(/\d+/g).map(Number);
        const correct = a * d > c * b ? 0 : a * d === c * b ? 1 : 2;
        const option = "ABC"[i < correctCount ? correct : (correct + 1) % 3];
        await practicePhones[side].getByRole("button", { name: option, exact: true }).tap();
        if (side === 0 || i < 4) await attempted(panel, i + 1);
      }
      if (side === 0) {
        await panel.getByText("本方已完成題組", { exact: true }).waitFor({ timeout: 2500 });
        await practicePhones[side].getByText("本方已完成題組，等候本場結果。").waitFor({ timeout: 2500 });
      }
    }
    await practiceScreen.getByText("橙方獲勝", { exact: true }).waitFor({ timeout: 2500 });
    await practicePhones[0].getByText("本場落敗", { exact: true }).waitFor({ timeout: 2500 });
    await practicePhones[1].getByText("本場獲勝", { exact: true }).waitFor({ timeout: 2500 });
    if (process.env.CAMPUS_SCREENSHOTS) {
      await practiceScreen.screenshot({ path: "test-results/practice-fraction-result.png", animations: "disabled" });
      await practicePhones[1].screenshot({ path: "test-results/practice-win-controller.png", animations: "disabled" });
    }
    assert.equal((await (await fetch(origin + "/api/campus")).json()).leaderboard.players.length, 6);

    // The same control surface must work in an actual, QR-gated station match.
    await Promise.all([host.close(), pipeHost.close()]);
    let stationCourt;
    const volleyballHost = await openHost("HOST-19", page => { stationCourt = watchVolleyballCourt(page, "game:state"); });
    await eventually(async () => {
      const campus = await (await fetch(origin + "/api/campus")).json();
      assert.deepEqual(campus.stations.filter(station => station.online).map(station => station.hostId), ["HOST-19"]);
    });
    await Promise.all([phone, rival].map(async page => {
      await page.goto(origin + "/controller");
      await page.getByRole("button", { name: "尋找對手" }).tap();
      await page.getByRole("heading", { name: "前往對戰房間" }).waitFor({ timeout: 15_000 });
      await page.goto(await freshEntry(volleyballHost));
      await page.getByRole("button", { name: "我已準備好" }).tap();
    }));
    await volleyballHost.getByLabel("史萊姆排球實況畫面").waitFor();
    await checkVolleyballRemote(phone, players[0].actions, stationCourt);
    if (process.env.CAMPUS_SCREENSHOTS) {
      await phone.screenshot({ path: "test-results/volleyball-station-controller.png", animations: "disabled" });
    }
  }
  assert.deepEqual(consoleErrors, []);
  console.log("Browser smoke passed: both floors, QR rotation, wrong-room rejection, 2 vs 2 with four mobile remotes, split-screen questions, reconnect, weighted result and rankings."
    + (!process.env.SKIP_BROWSER_ADMIN ? " Admin audit, CSV, practice and station volleyball multitouch checked." : ""));
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const ended = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await ended;
  }
  await rm(temp, { recursive: true, force: true });
}
async function eventually(check) {
  let failure;
  for (let attempt = 0; attempt < 70; attempt++) {
    try { await check(); return; } catch (error) { failure = error; await wait(100); }
  }
  throw failure;
}

function watchSocketEvent(page, frameEvent, expectedEvent, onEvent) {
  page.on("websocket", socket => {
    socket.on(frameEvent, ({ payload }) => {
      if (typeof payload !== "string" || !payload.startsWith("42")) return;
      const start = payload.indexOf("[");
      if (start === -1) return;
      const [event, data] = JSON.parse(payload.slice(start));
      if (event === expectedEvent) onEvent(data);
    });
  });
}

function watchActions(page, event) {
  const actions = [];
  watchSocketEvent(page, "framesent", event, data => {
    if (data.action.kind === "action") actions.push(data.action.action);
  });
  return actions;
}

function watchVolleyballCourt(page, event) {
  let latest;
  watchSocketEvent(page, "framereceived", event, data => {
    const scene = (data.panels ?? data.match?.panels)?.[0]?.scene;
    if (scene?.kind === "volleyball") latest = scene;
  });
  return side => latest?.players.find(player => player.side === side);
}

async function checkVolleyballRemote(page, actions, court) {
  const stick = page.getByRole("slider", { name: "移動搖桿" });
  const jump = page.getByRole("button", { name: "跳躍擊球" });
  await stick.waitFor();
  const side = Number(await page.locator(".remote-player").getAttribute("data-side"));
  for (const [width, height] of [[320, 568], [844, 390], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const [left, right] = await Promise.all([stick.boundingBox(), jump.boundingBox()]);
    assert.ok(left.x + left.width < right.x, "movement must be left of jump");
    assert.ok(left.y >= 0 && right.y >= 0 && left.y + left.height <= height && right.y + right.height <= height,
      "both controls must fit in the viewport at " + width + " × " + height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(await page.locator("canvas").count(), 0);
  const [left, right] = await Promise.all([stick.boundingBox(), jump.boundingBox()]);
  const first = { x: Math.round(left.x + left.width / 2), y: Math.round(left.y + left.height / 2), id: 0 };
  const second = { x: Math.round(right.x + right.width / 2), y: Math.round(right.y + right.height / 2), id: 1 };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, ...touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const index = actions.length;
  try {
    await touch("touchStart", first);
    await touch("touchMove", { ...first, x: first.x + 3 });
    assert.equal(await stick.getAttribute("aria-valuenow"), "0");
    const holdingRight = { ...first, x: first.x + 27 };
    await touch("touchMove", holdingRight);
    await eventually(async () => assert.equal(await stick.getAttribute("aria-valuenow"), "1"));
    await eventually(() => assert.equal(court(side)?.moveDir, 1));
    await touch("touchStart", holdingRight, second);
    await eventually(async () => assert.equal(await jump.getAttribute("data-active"), "true"));
    assert.equal(await stick.getAttribute("aria-valuenow"), "1");
    await touch("touchMove", { ...first, x: first.x - 27 }, second);
    await eventually(async () => assert.equal(await stick.getAttribute("aria-valuenow"), "-1"));
    await eventually(() => assert.equal(court(side)?.moveDir, -1));
    await touch("touchCancel");
    await eventually(async () => assert.equal(await stick.getAttribute("aria-valuenow"), "0"));
    assert.equal(await jump.getAttribute("data-active"), "false");
    await eventually(() => assert.deepEqual(actions.slice(index), ["hold-right", "jump", "hold-left", "release"]));
    await eventually(() => assert.equal(court(side)?.moveDir, 0));
    await touch("touchStart", first);
    await touch("touchMove", holdingRight);
    await eventually(async () => assert.equal(await stick.getAttribute("aria-valuenow"), "1"));
    await touch("touchEnd");
    await eventually(async () => assert.equal(await stick.getAttribute("aria-valuenow"), "0"));
    await eventually(() => assert.deepEqual(actions.slice(index + 4), ["hold-right", "release"]));
  } finally {
    await cdp.detach();
  }
}

async function freshEntry(page, excluded = "") {
  const handle = await page.waitForFunction(previous => {
    const link = document.querySelector(".qr-link");
    if (!(link instanceof HTMLAnchorElement) || link.href === previous || !link.querySelector("img")) return false;
    const code = new URLSearchParams(new URL(link.href).hash.slice(1)).get("scan");
    return code && Number(code.split(".")[0]) - Date.now() > 3500 ? link.href : false;
  }, excluded, { timeout: 15_000 });
  return handle.jsonValue();
}

