import assert from "node:assert/strict";
import { test } from "node:test";
import { STATION_QR_MS, STATION_SCAN_GRANT_MS } from "../packages/shared/rules";
import type { StationEntry } from "../packages/shared/protocol";
import { harness, ok, scanCode, send } from "./socket-helper";

test("room codes rotate after ten seconds, reject other rooms, and preserve a valid guest scan through registration", async () => {
  const service = await harness();
  try {
    const host = await service.host("HOST-01");
    await service.host("HOST-02");
    const first = "STATION-01";
    const second = "STATION-02";
    const phone = await service.connect();
    const observer = await service.connect();
    let exposed = false;
    observer.on("host:entry", () => { exposed = true; });
    const summary = await ok(observer,"campus:watch",null);
    assert.equal("entry" in summary.stations[0],false);

    const initial = service.campus.hostView("HOST-01").entry!;
    const other = service.campus.hostView("HOST-02").entry!;
    assert.equal(initial.expiresAt - service.time(),STATION_QR_MS);
    assert.equal(initial.expiresAt,other.expiresAt);
    assert.notEqual(scanCode(initial.url),scanCode(other.url));
    const wrongRoom = await send(phone,"station:scan",{ stationId: second,code: scanCode(initial.url) });
    assert.ok(!wrongRoom.ok && wrongRoom.code === "qr-invalid");

    service.step(STATION_QR_MS-1);
    await ok(phone,"station:scan",{ stationId: first,code: scanCode(initial.url) });
    const rotation = new Promise<StationEntry|null>(resolve => host.once("host:entry",resolve));
    service.step(1);
    const updated = await rotation;
    assert.equal(updated?.expiresAt,initial.expiresAt+STATION_QR_MS);
    assert.notEqual(scanCode(updated!.url),scanCode(initial.url));
    assert.equal(exposed,false);

    const { state } = await ok(phone,"player:join",{ name: "進場玩家" });
    service.fixtureRoute(state.player.id, "game-01");
    const staticLink = await send(phone,"station:join",{ stationId: second });
    assert.ok(!staticLink.ok && staticLink.code === "scan-required");
    const guestScan = await ok(phone,"station:join",{ stationId: first });
    assert.equal(guestScan.room?.stationId,first);
    await ok(phone,"station:leave",null);
    const validWrongRoom = await service.attemptStation(phone,second);
    assert.ok(!validWrongRoom.ok && validWrongRoom.code === "wrong-route");
    const reused = await send(phone,"station:join",{ stationId: first });
    assert.ok(!reused.ok && reused.code === "scan-required");
    const expired = await send(phone,"station:scan",{ stationId: first,code: scanCode(initial.url) });
    assert.ok(!expired.ok && expired.code === "qr-expired");
    const rescan = await service.joinStation(phone,first);
    assert.equal(rescan.player.id,state.player.id);
    assert.equal(rescan.room?.stationId,first);
  } finally { await service.close(); }
});

test("a scan is bound to the current host and expires before delayed admission", async () => {
  const service = await harness();
  try {
    await service.host("HOST-01");
    const player = await service.player("短效入場");
    service.fixtureRoute(player.id, "game-01");
    const stationId = "STATION-01";
    const code = service.stationCode(stationId);
    await ok(player.socket,"station:scan",{ stationId,code });

    await service.host("HOST-01");
    const superseded = await send(player.socket,"station:scan",{ stationId,code });
    assert.ok(!superseded.ok && superseded.code === "qr-invalid");
    const hostChanged = await send(player.socket,"station:join",{ stationId });
    assert.ok(!hostChanged.ok && hostChanged.code === "scan-required");

    await ok(player.socket,"station:scan",{ stationId,code: service.stationCode(stationId) });
    service.step(STATION_SCAN_GRANT_MS);
    const tooLate = await send(player.socket,"station:join",{ stationId });
    assert.ok(!tooLate.ok && tooLate.code === "scan-required");
  } finally { await service.close(); }
});

