import { createHmac } from "node:crypto";
import { STATION_QR_MS } from "../../../packages/shared/rules";
import { matchesSecret } from "./config";

export function qrExpiry(now: number) {
  return (Math.floor(now / STATION_QR_MS) + 1) * STATION_QR_MS;
}

function signature(secret: string, stationId: string, hostConnection: string, expiresAt: number) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["station-qr", stationId, hostConnection, expiresAt]))
    .digest("base64url")
    .slice(0, 32);
}

export function stationQr(secret: string, stationId: string, hostConnection: string, expiresAt: number) {
  return expiresAt + "." + signature(secret, stationId, hostConnection, expiresAt);
}

export function checkStationQr(secret: string, stationId: string, hostConnection: string, now: number, code: string) {
  const [stamp, provided] = code.split(".");
  const expiresAt = Number(stamp);
  if (expiresAt <= now) return "expired";
  if (expiresAt !== qrExpiry(now) || !provided || !matchesSecret(provided, signature(secret, stationId, hostConnection, expiresAt))) {
    return "invalid";
  }
  return "valid";
}

