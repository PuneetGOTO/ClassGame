import assert from "node:assert/strict";
import { test } from "node:test";
import { STATION_QR_MS, STATION_SCAN_GRANT_MS } from "../packages/shared/rules";
import type { StationEntry } from "../packages/shared/protocol";
import { hostKey } from "../apps/server/src/config";
import { credentials, harness, ok, scanCode, send } from "./socket-helper";

test("30-second codes are room-bound and a valid fresh QR checks in only assigned players", async () => {
  const service = await harness();
  try {
    const host = await service.host("HOST-01");
    const a = await service.player("手機甲");
    const b = await service.player("手機乙");
    const older = await service.connect();
    const staleScreen = await send(older, "host:register", {
      hostId: "HOST-02", key: hostKey(credentials.hostSecret, "HOST-02"), entryOrigin: service.origin
    });
    assert.ok(!staleScreen.ok && staleScreen.code === "host-refresh");
    assert.equal(service.campus.hostView("HOST-02").station.online, false);
    const first = "STATION-01";
    const lobby = await service.match([a,b]);
    assert.equal(lobby.stationId, first);
    await service.host("HOST-02");
    service.step(STATION_QR_MS - (service.time() % STATION_QR_MS));
    const second = "STATION-02";
    const observer = await service.connect();
    let exposed = false;
    observer.on("host:entry", () => { exposed = true; });
    const summary = await ok(observer,"campus:watch",null);
    assert.equal("entry" in summary.stations[0],false);
    const initial = service.campus.hostView("HOST-01").entry!;
    const other = service.campus.hostView("HOST-02").entry!;
    assert.equal(initial.expiresAt - service.time(), 30_000);
    assert.equal(initial.expiresAt, other.expiresAt);
    assert.notEqual(scanCode(initial.url), scanCode(other.url));
    const badCode = await send(a.socket,"station:scan",{ stationId: second, code: scanCode(initial.url) });
    assert.ok(!badCode.ok && badCode.code === "qr-invalid");
    const wrong = await service.attemptStation(a.socket,second);
    assert.ok(!wrong.ok && wrong.code === "wrong-route");
    const unscanned = await send(a.socket,"station:join",{ stationId:first });
    assert.ok(!unscanned.ok && unscanned.code === "scan-required");

    service.step(STATION_QR_MS-1);
    await ok(a.socket,"station:scan",{ stationId:first, code:scanCode(initial.url) });
    const rotation = new Promise<StationEntry|null>(resolve => host.once("host:entry",resolve));
    service.step(1);
    const updated = await rotation;
    assert.notEqual(scanCode(updated!.url),scanCode(initial.url));
    assert.equal(exposed,false);
    const expired = await send(b.socket,"station:scan",{ stationId:first, code:scanCode(initial.url) });
    assert.ok(!expired.ok && expired.code === "qr-expired");

    const admitted = await ok(a.socket,"station:join",{ stationId:first });
    assert.equal(admitted.room?.members.find(member => member.id === a.id)?.checkedIn, true);
    const secondSeat = await service.joinStation(b.socket,first);
    assert.equal(secondSeat.room?.members.filter(member => member.checkedIn).length, 2);
  } finally { await service.close(); }
});

test("a valid scan grant is tied to its host connection and expires", async () => {
  const service = await harness();
  try {
    await service.host("HOST-01");
    const a = await service.player("短效入場");
    const b = await service.player("對手");
    const { stationId } = await service.match([a,b]);
    const code = service.stationCode(stationId);
    await ok(a.socket,"station:scan",{ stationId,code });
    await service.host("HOST-01");
    const superseded = await send(a.socket,"station:scan",{ stationId,code });
    assert.ok(!superseded.ok && superseded.code === "qr-invalid");
    const hostChanged = await send(a.socket,"station:join",{ stationId });
    assert.ok(!hostChanged.ok && hostChanged.code === "scan-required");
    await ok(a.socket,"station:scan",{ stationId,code: service.stationCode(stationId) });
    service.step(STATION_SCAN_GRANT_MS);
    const tooLate = await send(a.socket,"station:join",{ stationId });
    assert.ok(!tooLate.ok && tooLate.code === "scan-required");
  } finally { await service.close(); }
});
