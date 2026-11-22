import "dotenv/config";
import { loadConfig } from "./config";
import { createService } from "./service";
import { plugins } from "../../../local-games/registry";

const server = createService(loadConfig(), plugins);
const port = Number(process.env.PORT || 3000);
const address = process.env.BIND_ADDRESS || "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 須介乎 1 與 65535");
const actualPort = await server.listen(port, address);
console.log("校園闖關伺服器 · http://localhost:" + actualPort);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await server.close();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

