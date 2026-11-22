import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const keyBytes = 32;

export async function newStudentCode(secret: string) {
  const code = String(randomInt(100_000_000)).padStart(8, "0");
  const salt = randomBytes(16).toString("hex");
  const hash = await derive("campus-student:" + code + ":" + secret, salt, keyBytes) as Buffer;
  return { code, digest: salt + "." + hash.toString("hex") };
}

export async function validStudentCode(code: string, digest: string | null, secret: string) {
  const [salt, expected] = digest?.split(".") ?? ["0".repeat(32), "0".repeat(keyBytes * 2)];
  const hash = await derive("campus-student:" + code + ":" + secret, salt, keyBytes) as Buffer;
  return digest !== null && timingSafeEqual(hash, Buffer.from(expected, "hex"));
}
