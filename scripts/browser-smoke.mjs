import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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

async function openHost(id) {
    const screen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    track(screen);
    await screen.goto(origin + "/host?id=" + id);
    await screen.getByLabel("主機金鑰").fill(hostKey(id));
    await screen.getByRole("button", { name: "連線至站點" }).click();
    await screen.getByAltText("手機入場 QR Code").waitFor();
    return screen;
  }
  const wrongHost = await openHost("HOST-01");
  const host = await openHost("HOST-10");
  const oldEntry = await freshEntry(host);
  const oldImage = await host.getByAltText("手機入場 QR Code").getAttribute("src");
  const wrongEntry = await freshEntry(wrongHost);
  const code = url => new URLSearchParams(new URL(url).hash.slice(1)).get("scan");
  assert.notEqual(code(wrongEntry), code(oldEntry));
  assert.equal(new URL(oldEntry).searchParams.get("station"), "STATION-10");
  await freshEntry(host, oldEntry);
  assert.notEqual(await host.getByAltText("手機入場 QR Code").getAttribute("src"), oldImage);

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  track(phone);
  await phone.goto(oldEntry);
  await phone.getByRole("alert").getByText(/QR Code 已過期/).waitFor();
  await phone.goto(origin + "/controller");
  await phone.getByLabel("玩家名稱").fill("瀏覽器玩家");
  await phone.getByRole("button", { name: "加入活動" }).click();
  await phone.getByRole("heading", { name: "你的下一站" }).waitFor();
  assert.match(await phone.locator(".route-card").innerText(), /0 \/ 20 關/);
  assert.equal(await phone.getByRole("button", { name: "本層遊戲" }).count(), 0);
  const mapLink = await phone.getByRole("link", { name: "查看房間位置" }).getAttribute("href");
  await dashboard.goto(origin + mapLink);
  await dashboard.locator('.map-marker[data-destination="true"]').waitFor();
  for (const width of [390, 320]) {
    await phone.setViewportSize({ width, height: 844 });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "controller overflow at " + width);
  }
  await phone.setViewportSize({ width: 390, height: 844 });

  // Put mental arithmetic first in the isolated database so the touch scenario is deterministic.
  const db = new DatabaseSync(join(temp, "test.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;");
    const playerId = db.prepare("SELECT player_id FROM players WHERE player_name=?").get("瀏覽器玩家").player_id;
    const all = db.prepare("SELECT * FROM player_routes WHERE player_id=? ORDER BY step").all(playerId);
    const first = all.findIndex(row => row.game_id === "game-10");
    [all[0], all[first]] = [all[first], all[0]];
    db.prepare("DELETE FROM player_routes WHERE player_id=?").run(playerId);
    const add = db.prepare("INSERT INTO player_routes(competition_id,player_id,step,game_id,seed) VALUES (?,?,?,?,?)");
    all.forEach((row, index) => add.run(row.competition_id, playerId, index + 1, row.game_id, row.seed));
    db.exec("COMMIT");
  } finally { db.close(); }
  await phone.goto(await freshEntry(wrongHost));
  await phone.getByRole("alert").getByText(/這一關請前往/).waitFor();
  await phone.getByRole("heading", { name: "心算挑戰" }).waitFor();
  assert.equal(await phone.getByRole("button", { name: "我已準備好" }).count(), 0);
  if (process.env.CAMPUS_SCREENSHOTS) {
    await phone.goto(origin + "/controller");
    await phone.getByRole("heading", { name: "你的下一站" }).waitFor();
    await phone.screenshot({ path: "test-results/phone-route.png", animations: "disabled" });
  }

  await phone.goto(await freshEntry(host));
  await phone.getByRole("button", { name: "我已準備好" }).click();
  const prompt = phone.locator(".quiz-prompt");
  await prompt.waitFor();
  await host.getByText("在手機進行個人任務").waitFor();
  assert.equal(await host.locator(".quiz-prompt").count(), 0);
  const question = await prompt.innerText();
  await phone.reload();
  await prompt.waitFor();
  assert.equal(await prompt.innerText(), question);
  await phone.getByText("你抽中了雙倍挑戰").waitFor({ timeout: 18_000 });
  await host.getByText("瀏覽器玩家 抽中雙倍挑戰").waitFor();
  if (process.env.CAMPUS_SCREENSHOTS) {
    await phone.screenshot({ path: "test-results/phone-double.png", animations: "disabled" });
    await host.screenshot({ path: "test-results/host-private.png", animations: "disabled" });
  }
  for (let i = 0; i < 4; i++) {
    await prompt.waitFor();
    const [left, operator, right] = (await prompt.innerText()).split(" ");
    const a = Number(left), b = Number(right);
    const answer = operator === "+" ? a+b : operator === "−" ? a-b : operator === "×" ? a*b : a/b;
    assert.ok(Number.isInteger(answer));
    await phone.getByRole("button", { name: String(answer), exact: true }).tap();
    if (i < 3) await eventually(async () => {
      assert.equal(await phone.locator(".progress strong").innerText(), (i+1) + " / 4");
    });
  }
  await phone.getByRole("heading", { name: "闖關成功" }).waitFor();
  assert.equal((await phone.locator(".result-points").innerText()).trim(), "+4 分");
  await host.getByText("闖關成功", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "查看下一站" }).click();
  assert.match(await phone.locator(".route-card").innerText(), /1 \/ 20 關/);
  assert.match(await phone.locator(".route-card").innerText(), /第 2 關/);
  await phone.getByRole("button", { name: "我的闖關紀錄" }).click();
  await phone.getByRole("dialog").getByText("1 · 心算挑戰").waitFor();

  await dashboard.goto(origin + "/leaderboard");
  await dashboard.getByRole("row", { name: /瀏覽器玩家/ }).waitFor();
  assert.equal(await dashboard.locator(".em-score").first().innerText(), "4");
  await dashboard.getByRole("button", { name: "隊伍排行" }).click();
  assert.equal(await dashboard.locator("tbody tr").count(), 10);

  if (!process.env.SKIP_BROWSER_ADMIN) {
    await dashboard.goto(origin + "/admin");
    await dashboard.getByLabel("管理金鑰").fill(password);
    await dashboard.getByRole("button", { name: "開啟管理後台" }).click();
    await dashboard.getByRole("heading", { name: "管理後台", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "玩家與隊伍" }).click();
    await dashboard.getByRole("rowheader", { name: "瀏覽器玩家", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "場次紀錄" }).click();
    await dashboard.getByRole("button", { name: "查看結算" }).first().click();
    await dashboard.getByRole("dialog").getByRole("rowheader", { name: "瀏覽器玩家", exact: true }).waitFor();
    await dashboard.getByRole("button", { name: "關閉" }).click();
    const downloadPromise = dashboard.waitForEvent("download");
    await dashboard.getByRole("button", { name: "匯出 CSV" }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "campus-scores.csv");
    await dashboard.getByRole("button", { name: "規則與稽核" }).click();
    await dashboard.getByLabel(/每場觸發機率/).fill("20");
    await dashboard.getByRole("button", { name: "儲存遊戲規則" }).click();
    await dashboard.getByText("雙倍挑戰機率已更新").waitFor();
  }
  assert.deepEqual(consoleErrors, []);
  console.log("Browser smoke passed: both clean floor plans, widths 320–1440, QR rotation and expiration, wrong-room rejection, touch input, persistent personal route, private game, double challenge and both rankings."
    + (!process.env.SKIP_BROWSER_ADMIN ? " Admin audit and CSV checked." : ""));
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
async function freshEntry(page, excluded = "") {
  const handle = await page.waitForFunction(previous => {
    const link = document.querySelector(".qr-link");
    if (!(link instanceof HTMLAnchorElement) || link.href === previous || !link.querySelector("img")) return false;
    const code = new URLSearchParams(new URL(link.href).hash.slice(1)).get("scan");
    return code && Number(code.split(".")[0]) - Date.now() > 3500 ? link.href : false;
  }, excluded, { timeout: 15_000 });
  return handle.jsonValue();
}

