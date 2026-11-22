import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack, CampusState, ClientEvents, ServerEvents } from "../shared/protocol";

export const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false, transports: ["websocket"] });
type ClientEvent = keyof ClientEvents;
type Reply<E extends ClientEvent> = NonNullable<Parameters<ClientEvents[E]>[1]> extends (reply: Ack<infer T>) => void ? T : never;

export class RemoteError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export const message = (error: unknown) => error instanceof Error ? error.message : "操作失敗，請再試一次";

export async function request<E extends ClientEvent>(event: E, data: Parameters<ClientEvents[E]>[0]): Promise<Reply<E>> {
  if (!socket.connected) throw new RemoteError("目前離線，連線恢復後再試", "offline");
  let response: Ack<Reply<E>>;
  try {
    const sender = socket.timeout(4500) as unknown as { emitWithAck(name: string, payload: unknown): Promise<Ack<Reply<E>>> };
    response = await sender.emitWithAck(event, data);
  } catch {
    throw new RemoteError("伺服器回應逾時，請重試", "request-timeout");
  }
  if (!response.ok) throw new RemoteError(response.error, response.code);
  return response.data;
}
export async function adminRequest<T>(key: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/admin" + path, {
    method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload: Ack<T> = await response.json();
  if (!payload.ok) throw new RemoteError(payload.error, payload.code);
  return payload.data;
}

export function useCampus() {
  const [state, setState] = useState<CampusState | null>(null);
  const [online, setOnline] = useState(socket.connected);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    async function calibrate() {
      const sent = Date.now();
      try {
        const now = await request("clock:sync", null);
        setOffset(now - (sent + Date.now()) / 2);
      } catch { /* Retain the last calculation during reconnection. */ }
    }
    async function connect() {
      setOnline(true);
      try { setState(await request("campus:watch", null)); } catch { /* A reconnect will resubscribe. */ }
      await calibrate();
    }
    const disconnect = () => setOnline(false);
    socket.on("campus:state", setState).on("connect", connect).on("disconnect", disconnect);
    if (socket.connected) void connect();
    else socket.connect();
    const interval = setInterval(calibrate, 20_000);
    const abort = new AbortController();
    void fetch("/api/campus", { signal: abort.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setState(previous => previous ?? data); }).catch(() => {});
    return () => {
      clearInterval(interval);
      abort.abort();
      socket.off("campus:state", setState).off("connect", connect).off("disconnect", disconnect);
    };
  }, []);
  return { state, online, offset };
}

export type CampusConnection = ReturnType<typeof useCampus>;

