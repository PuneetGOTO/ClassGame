import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

export interface Configuration {
  adminKey: string;
  hostSecret: string;
  publicUrl?: string;
  dbPath: string;
  trustProxy?: number;
  staticRoot?: string;
}

export function webOrigin(raw: string) {
  try {
    const url = new URL(raw);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch { /* Invalid URL. */ }
  return undefined;
}

export function hostKey(secret: string, hostId: string) {
  return createHmac("sha256", secret).update("campus-host:" + hostId).digest("base64url");
}
export function matchesSecret(given: string, expected: string) {
  const actual = Buffer.from(given);
  const match = Buffer.from(expected);
  return actual.length === match.length && timingSafeEqual(actual, match);
}

function firstLanAddress() {
  const addresses = Object.values(networkInterfaces()).flatMap(list => list ?? []);
  const local = addresses.filter(item => item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254."));
  return local.find(item => /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(item.address))?.address ?? local[0]?.address;
}

export function entryUrl(config: Configuration, fallback: () => string, origin?: string, station?: string) {
  const base = new URL(config.publicUrl ?? webOrigin(origin ?? "") ?? fallback());
  if (!config.publicUrl && ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(base.hostname)) {
    base.hostname = firstLanAddress() ?? base.hostname;
  }
  const url = new URL("/controller", base);
  if (station) url.searchParams.set("station", station);
  return url.href;
}

export function loadConfig(): Configuration {
  let adminKey = process.env.ADMIN_KEY?.trim() ?? "";
  let hostSecret = process.env.HOST_SECRET?.trim() ?? "";
  const production = process.env.NODE_ENV === "production";
  if (production && (adminKey.length < 24 || hostSecret.length < 24 || adminKey === hostSecret)) {
    throw new Error("正式環境請設定兩組不同且長度至少 24 字元的 ADMIN_KEY 和 HOST_SECRET");
  }
  if (!adminKey || !hostSecret) {
    const credentialFile = resolve("data/local-credentials.json");
    mkdirSync(resolve("data"), { recursive: true });
    if (!existsSync(credentialFile)) {
      writeFileSync(credentialFile, JSON.stringify({
        adminKey: randomBytes(32).toString("base64url"), hostSecret: randomBytes(32).toString("base64url")
      }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    }
    const local = JSON.parse(readFileSync(credentialFile, "utf8"));
    adminKey ||= local.adminKey;
    hostSecret ||= local.hostSecret;
    console.log("本機管理金鑰存於 data/local-credentials.json");
  }
  if (adminKey.length < 16 || hostSecret.length < 16 || adminKey === hostSecret) throw new Error("請使用兩組不同且長度至少 16 字元的金鑰");
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl && !webOrigin(publicUrl)) throw new Error("PUBLIC_URL 須為 HTTP 或 HTTPS 網站入口，不含路徑");
  const trustProxy = Number(process.env.TRUST_PROXY || 0);
  if (!Number.isSafeInteger(trustProxy) || trustProxy < 0) throw new Error("TRUST_PROXY 須為非負的整數");
  return { adminKey, hostSecret, publicUrl, trustProxy, dbPath: resolve(process.env.DB_PATH || "data/game.sqlite"),
    staticRoot: resolve("dist/web") };
}

