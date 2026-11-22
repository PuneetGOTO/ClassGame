import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { GAMES, gameById } from "../../../packages/shared/catalog";
import {
  type Ack, type ClientEvents, type ServerEvents, floorSchema, hostIdSchema, inputSchema, keySchema, nameSchema, registrationSchema,
  sessionIdSchema, stationIdSchema, stationQrSchema, teamIdSchema
} from "../../../packages/shared/protocol";
import type { PluginFactory } from "../../../packages/game-sdk";
import { HOST_SCREEN_VERSION } from "../../../packages/shared/rules";
import { Campus, type PeerData } from "./campus";
import { entryUrl, hostKey, matchesSecret, webOrigin, type Configuration } from "./config";
import { Practice } from "./practice";
import { RequestError, Store } from "./store";

const maxMapBytes = 1_500_000;
const stationSettings = z.object({
  name: nameSchema, floor: floorSchema.optional(), x: z.number().min(0).max(100), y: z.number().min(0).max(100),
  hostId: hostIdSchema, gameId: z.string().refine(id => gameById.has(id)), open: z.boolean()
});
const stationAction = z.object({ action: z.enum(["start", "stop", "reset", "clear-queue"]) });
const mapBody = z.object({ image: z.string().max(2_010_000).nullable() });
function validation<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body);
  if (!value.success) throw new RequestError("資料格式有誤，請確認輸入內容", "validation");
  return value.data;
}
function errorValue(error: unknown) {
  return error instanceof RequestError ? { error: error.message, code: error.code } : { error: "伺服器未能完成操作", code: "internal" };
}

function parseMap(image: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) throw new RequestError("只接受 PNG、JPEG 或 WebP 圖片");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > maxMapBytes) throw new RequestError("圖片不可超過 1.5 MB");
  const kind = match[1];
  const valid = kind === "png" ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
    : kind === "jpeg" ? bytes.subarray(0, 3).toString("hex") === "ffd8ff"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new RequestError("圖片內容與格式不符");
  return { bytes, mime: "image/" + kind };
}
function csvField(value: string | number) {
  const text = String(value);
  const safe = typeof value === "string" && /^[\s]*[=+@\-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function sendCsv(res: express.Response, filename: string, rows: (string | number)[][]) {
  res.type("text/csv; charset=utf-8").attachment(filename)
    .send("\uFEFF" + rows.map(row => row.map(csvField).join(",")).join("\r\n"));
}

export function createService(config: Configuration, plugins: ReadonlyMap<string, PluginFactory>, options: {
  now?: () => number; autoTick?: boolean
} = {}) {
  const now = options.now ?? Date.now;
  const store = new Store(config.dbPath, now());
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    next();
  });
  app.use(express.json({ limit: "2050kb" }));
  const http = createServer(app);
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, PeerData>(http, {
    maxHttpBufferSize: 16 * 1024,
    perMessageDeflate: false,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      let allowed = !origin;
      if (origin) {
        const parsed = webOrigin(origin);
        const forwardedHost = config.trustProxy && typeof request.headers["x-forwarded-host"] === "string"
          ? request.headers["x-forwarded-host"].split(",")[0].trim() : undefined;
        allowed = !!parsed && (parsed === config.publicUrl || new URL(parsed).host === (forwardedHost ?? request.headers.host));
      }
      callback(null, allowed);
    }
  });
  const entry = (origin?: string, station?: string) =>
    entryUrl(config, () => "http://127.0.0.1:" + ((http.address() as AddressInfo | null)?.port ?? 3000), origin, station);
  const campus = new Campus(store, io, plugins, entry, config.hostSecret, now);
  const practice = new Practice(plugins, config.hostSecret, entry, now);
  const refresh = () => {
    try { campus.step(); }
    catch (error) { campus.recordError(error, "tick"); }
    try { practice.step(); }
    catch (error) { campus.recordError(error, "practice"); }
  };
  const interval = options.autoTick === false ? undefined : setInterval(refresh, 80);

  const registrationLimits = new Map<string, { until: number; count: number }>();
  io.on("connection", socket => {
    campus.mark();
    let attempts = 0;
    let eventWindow = now();
    let events = 0;
    const accept = <T, R>(schema: z.ZodType<T>, body: unknown, ack: ((data: Ack<R>) => void) | undefined, run: (payload: T) => R) => {
      try {
        const timestamp = now();
        if (timestamp - eventWindow >= 1000) {
          eventWindow = timestamp;
          events = 0;
        }
        if (++events > 45) throw new RequestError("事件太密集，請稍後再試", "rate", 429);
        const result = run(validation(schema, body));
        if (typeof ack === "function") ack({ ok: true, data: result });
      } catch (error) {
        if (!(error instanceof RequestError)) campus.recordError(error, "socket " + socket.id);
        const value = errorValue(error);
        if (typeof ack === "function") ack({ ok: false, ...value });
        else if (!["rate", "not-running", "answer-cooldown"].includes(value.code)) socket.emit("system:error", value);
        if (error instanceof RequestError && error.status === 401 && ++attempts > 8) socket.disconnect(true);
      }
    };

    socket.on("campus:watch", (body, ack) => accept(z.null(), body, ack, () => {
      socket.join("campus");
      return campus.snapshot();
    }));
    socket.on("clock:sync", (body, ack) => accept(z.null(), body, ack, () => now()));
    socket.on("player:join", (body, ack) => accept(registrationSchema, body, ack, data => {
      const ip = socket.handshake.address;
      const current = Date.now();
      if (registrationLimits.size > 500) {
        for (const [address, item] of registrationLimits) if (item.until <= current) registrationLimits.delete(address);
      }
      let limit = registrationLimits.get(ip);
      if (!limit || limit.until <= current) {
        limit = { count: 0, until: current + 60_000 };
        registrationLimits.set(ip, limit);
      }
      if (++limit.count > 120) throw new RequestError("註冊操作太快，請稍候再試", "rate", 429);
      return campus.joinPlayer(socket, data.name, data.teamId);
    }));
    socket.on("player:reconnect", (body, ack) => accept(z.object({ token: keySchema }), body, ack, data => campus.reconnect(socket, data.token)));
    socket.on("player:leave", (body, ack) => accept(z.null(), body, ack, () => { campus.leavePlayer(socket); return null; }));
    socket.on("team:join", (body, ack) => accept(z.object({ teamId: teamIdSchema }), body, ack,
      data => campus.changeTeam(campus.playerId(socket), data.teamId)));
    socket.on("match:find", (body, ack) => accept(z.null(), body, ack, () => campus.findMatch(campus.playerId(socket))));
    socket.on("match:cancel", (body, ack) => accept(z.null(), body, ack, () => campus.leaveStation(campus.playerId(socket))));
    socket.on("station:scan", (body, ack) => accept(z.object({ stationId: stationIdSchema, code: stationQrSchema }), body, ack,
      data => campus.scanStation(socket, data.stationId, data.code)));
    socket.on("station:join", (body, ack) => accept(z.object({ stationId: stationIdSchema }), body, ack,
      data => campus.enterStation(socket, data.stationId)));
    socket.on("station:leave", (body, ack) => accept(z.null(), body, ack, () => campus.leaveStation(campus.playerId(socket))));
    socket.on("game:ready", (body, ack) => accept(z.object({ sessionId: sessionIdSchema, ready: z.boolean() }), body, ack,
      data => campus.ready(campus.playerId(socket), data.sessionId, data.ready)));
    socket.on("game:input", (body, ack) => accept(inputSchema, body, ack, data => campus.input(campus.playerId(socket), data)));
    socket.on("practice:join", (body, ack) => accept(z.object({
      role: z.enum(["screen", "P1", "P2"]), credential: keySchema, entryOrigin: z.string().max(200).optional()
    }), body, ack, data => practice.join(socket, data.role, data.credential,
      webOrigin(data.entryOrigin ?? socket.handshake.headers.origin ?? ""))));
    socket.on("practice:select", (body, ack) => accept(z.object({ gameId: z.string().max(32) }),
      body, ack, data => practice.select(socket, data.gameId)));
    socket.on("practice:start", (body, ack) => accept(z.null(), body, ack, () => practice.start(socket)));
    socket.on("practice:stop", (body, ack) => accept(z.null(), body, ack, () => practice.stop(socket)));
    socket.on("practice:input", (body, ack) => accept(inputSchema, body, ack, data => practice.input(socket, data)));
    socket.on("host:register", (body, ack) => accept(z.object({
      hostId: hostIdSchema, key: keySchema, entryOrigin: z.string().max(200).optional(), screenVersion: z.number().int().optional()
    }),
      body, ack, data => {
        if (!matchesSecret(data.key, hostKey(config.hostSecret, data.hostId))) throw new RequestError("主機金鑰不正確", "unauthorized", 401);
        if (data.screenVersion !== HOST_SCREEN_VERSION) {
          throw new RequestError("請重新整理大螢幕頁面，載入新版對戰畫面", "host-refresh", 409);
        }
        return campus.registerHost(socket, data.hostId, webOrigin(data.entryOrigin ?? socket.handshake.headers.origin ?? ""));
      }));
    socket.on("admin:watch", (body, ack) => accept(z.object({ key: keySchema }), body, ack, data => {
      if (!matchesSecret(data.key, config.adminKey)) throw new RequestError("管理金鑰不正確", "unauthorized", 401);
      socket.join("admin");
      return campus.adminView();
    }));
    socket.on("disconnect", () => {
      practice.disconnect(socket);
      campus.disconnect(socket);
    });
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, now: now() }));
  app.get("/api/entry", (req, res) => {
    const origin = req.query.origin;
    res.json({ url: entry(typeof origin === "string" ? webOrigin(origin) : undefined) });
  });
  app.get("/api/campus", (_req, res) => { res.set("Cache-Control", "no-store").json(campus.snapshot()); });
  app.get("/api/map/:floor", (req, res) => {
    const floor = validation(floorSchema, Number(req.params.floor));
    const map = store.get<{ image: Uint8Array | null; mime: string | null }>("SELECT mime,image FROM floor_maps WHERE floor=?", floor);
    if (!map?.image || !map.mime) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-cache").type(map.mime).send(Buffer.from(map.image));
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    const key = req.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
    if (!matchesSecret(key, config.adminKey)) {
      res.status(401).json({ ok: false, error: "請輸入正確的管理金鑰", code: "unauthorized" });
      return;
    }
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/admin", admin);
  const send = <T>(res: express.Response, data: T) => { res.json({ ok: true, data }); };
  admin.get("/state", (_req, res) => send(res, campus.adminView()));
  admin.get("/practice", (_req, res) => send(res, { screenKey: practice.key("screen") }));
  admin.get("/hosts/:id/key", (req, res) => {
    const id = validation(hostIdSchema, req.params.id);
    send(res, { key: hostKey(config.hostSecret, id) });
  });
  admin.post("/players", (req, res) => {
    const { name, teamId } = validation(registrationSchema, req.body);
    const player = store.addPlayer(name, teamId, now());
    store.audit("player.create", player.id, now());
    campus.mark();
    send(res, player);
  });
  admin.patch("/players/:id", (req, res) => {
    const id = validation(z.uuid(), req.params.id);
    if (!store.player(id)) throw new RequestError("找不到玩家", "not-found", 404);
    const body = validation(z.object({ name: nameSchema.optional(), teamId: teamIdSchema.optional(), swapId: z.uuid().optional() }), req.body);
    if (body.name && body.teamId) throw new RequestError("請分開變更名稱與隊伍");
    if (body.name) {
      store.renamePlayer(id, body.name);
      store.audit("player.rename", id, now());
    }
    if (body.teamId) campus.changeTeam(id, body.teamId, body.swapId, true);
    campus.mark();
    send(res, null);
  });
  admin.get("/players/:id/results", (req, res) => {
    const id = validation(z.uuid(), req.params.id);
    send(res, store.officialFor(id));
  });
  admin.post("/players/:id/kick", (req, res) => {
    campus.kick(validation(z.uuid(), req.params.id), true);
    send(res, null);
  });
  admin.post("/players/:id/link", (req, res) => {
    const id = validation(z.uuid(), req.params.id);
    const token = store.rotateToken(id);
    campus.kick(id, false);
    send(res, { id, token });
  });
  admin.post("/teams/auto", (_req, res) => { campus.autoTeams(); send(res, null); });
  admin.patch("/stations/:id", (req, res) => {
    campus.configureStation(validation(stationIdSchema, req.params.id), validation(stationSettings, req.body));
    send(res, null);
  });
  admin.post("/stations/:id/action", (req, res) => {
    campus.stationAction(validation(stationIdSchema, req.params.id), validation(stationAction, req.body).action);
    send(res, null);
  });
  admin.get("/sessions", (req, res) => {
    const query = req.query.before;
    const before = query == null || query === "" ? Number.MAX_SAFE_INTEGER : validation(z.coerce.number().int().positive(), query);
    send(res, store.sessionHistory(before, 100));
  });
  admin.get("/sessions/:id", (req, res) => {
    const id = validation(z.uuid(), req.params.id);
    if (!store.get("SELECT 1 FROM game_sessions WHERE session_id=?", id)) throw new RequestError("找不到場次", "not-found", 404);
    send(res, { results: store.resultsForSession(id), team: store.teamResult(id) });
  });
  admin.post("/competition/reset", (req, res) => {
    validation(z.object({ confirm: z.literal("RESET") }), req.body);
    campus.resetCompetition();
    send(res, { competitionId: store.competitionId });
  });
  admin.put("/map/:floor", (req, res) => {
    const floor = validation(floorSchema, Number(req.params.floor));
    const { image } = validation(mapBody, req.body);
    const map = image ? parseMap(image) : null;
    store.transaction(() => {
      store.run("UPDATE floor_maps SET revision=revision+1,mime=?,image=? WHERE floor=?", map?.mime ?? null, map?.bytes ?? null, floor);
      store.audit("map.update", floor + "F · " + (map?.mime ?? "原始樓層圖"), now());
    });
    campus.mark();
    send(res, null);
  });
  admin.put("/rules", (req, res) => {
    const { doubleChance } = validation(z.object({ doubleChance: z.number().int().min(0).max(100) }), req.body);
    store.transaction(() => {
      store.run("UPDATE settings SET double_chance=?", doubleChance);
      store.audit("rules.update", "雙倍挑戰 " + doubleChance + "%", now());
    });
    campus.mark();
    send(res, { doubleChance });
  });
  admin.get("/scores.csv", (req, res) => {
    const leaderboard = store.leaderboard();
    if (req.query.scope === "teams") {
      sendCsv(res, "campus-teams.csv", [
        ["名次", "隊伍ID", "隊伍", "五人平均分", "完成", "勝", "成員"],
        ...leaderboard.teams.map(team => [team.rank, team.id, team.name, team.score, team.completed, team.wins,
          team.members.map(member => member.name).join("、")])
      ]);
      return;
    }
    const rows: (string|number)[][] = [
      ["名次", "玩家ID", "玩家", "隊伍", "完成", "勝", "負", "單人分", "多人分", "總分",
        ...GAMES.map(game => game.name + " 結果"), ...GAMES.map(game => game.name + " 得分"),
        ...GAMES.map(game => game.name + " 雙倍挑戰")]
    ];
    for (const player of leaderboard.players) {
      const results = new Map(store.officialFor(player.id).map(result => [result.gameId, result]));
      rows.push([player.rank, player.id, player.name, player.teamName, player.completed, player.wins, player.losses,
        player.soloScore, player.multiScore, player.totalScore,
        ...GAMES.map(game => {
          const result = results.get(game.id);
          return result ? result.tied ? "和" : result.outcome === "win" ? "勝" : "負" : "未參賽";
        }),
        ...GAMES.map(game => results.get(game.id)?.awarded ?? 0),
        ...GAMES.map(game => results.get(game.id)?.doublePoints ? "是" : "")]);
    }
    sendCsv(res, "campus-scores.csv", rows);
  });
  app.use("/api", (_req, res) => { res.status(404).json({ ok: false, error: "找不到 API", code: "not-found" }); });
  if (config.staticRoot && existsSync(join(config.staticRoot, "index.html"))) {
    app.use(express.static(config.staticRoot));
    app.get(["/", "/controller", "/host", "/leaderboard", "/admin", "/practice"], (_req, res) => res.sendFile(join(config.staticRoot!, "index.html")));
    app.use((_req, res) => res.status(404).sendFile(join(config.staticRoot!, "index.html")));
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (error instanceof RequestError) { res.status(error.status).json({ ok: false, ...errorValue(error) }); return; }
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      res.status(400).json({ ok: false, error: "JSON 格式有誤", code: "validation" }); return;
    }
    if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
      res.status(413).json({ ok: false, error: "上傳檔案過大", code: "too-large" }); return;
    }
    campus.recordError(error, "http");
    res.status(500).json({ ok: false, ...errorValue(error) });
  });

  return {
    app, http, io, campus, store, practice,
    listen: (port: number, address: string) => new Promise<number>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, address, () => {
        http.off("error", reject);
        resolve((http.address() as AddressInfo).port);
      });
    }),
    close: async () => {
      clearInterval(interval);
      await new Promise<void>(resolve => { void io.close(() => resolve()); });
      store.close();
    }
  };
}

