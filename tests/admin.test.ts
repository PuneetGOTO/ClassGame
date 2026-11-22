import assert from "node:assert/strict";
import { test } from "node:test";
import type { StudentCredential } from "../packages/shared/protocol";
import { harness, ok, send } from "./socket-helper";

test("admin changes teams, moves hosts while retaining fixed games, publishes the map and exports both tables", async () => {
  const service = await harness();
  try {
    const a = await service.player("行政驗證", "TEAM-01");
    const b = await service.player("交換隊員", "TEAM-02");
    assert.equal((await service.admin("/players/" + a.id,"bad","PATCH")).status,400);
    assert.equal((await service.admin("/players/" + a.id,{ teamId: "TEAM-02", swapId: b.id },"PATCH")).status,200);
    assert.equal(service.store.player(a.id)?.team_id,"TEAM-02");
    assert.equal(service.store.player(b.id)?.team_id,"TEAM-01");
    assert.equal((await service.admin("/players/" + a.id,{ name: "行政驗證新名" },"PATCH")).status,200);
    assert.equal((await service.admin("/teams/auto",{})).status,200);
    assert.equal(service.store.player(a.id)?.team_id,"TEAM-01");
    await service.host("HOST-02");
    const station = { name: "測試站位", x: 5.5, y: 91, hostId: "HOST-02", gameId: "game-01", open: true };
    assert.equal((await service.admin("/stations/STATION-01",{ ...station,floor: 2 },"PATCH")).status,400);
    assert.equal((await service.admin("/stations/STATION-01",{ ...station,gameId: "game-10" },"PATCH")).status,409);
    assert.equal((await service.admin("/stations/STATION-01",station,"PATCH")).status,200);
    assert.equal(service.campus.hostView("HOST-02").station.name,"測試站位");
    assert.equal(service.campus.hostView("HOST-02").station.x,5.5);
    assert.equal(service.campus.hostView("HOST-02").station.gameId,"game-01");
    assert.equal(service.campus.hostView("HOST-01").station.gameId,"game-02");

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+WwuAAAAAASUVORK5CYII=";
    assert.equal((await service.admin("/map/3",{ image: "data:text/html;base64,YQ==" },"PUT")).status,400);
    assert.equal((await service.admin("/map/2",{ image: "data:image/png;base64," + png },"PUT")).status,400);
    assert.equal((await service.admin("/map/3",{ image: "data:image/png;base64," + png },"PUT")).status,200);
    const image = await fetch(service.origin + "/api/map/3");
    assert.equal(image.headers.get("content-type"),"image/png");
    assert.equal(Buffer.from(await image.arrayBuffer()).toString("base64"),png);
    assert.equal(service.campus.snapshot().floorMaps[3].custom,true);
    assert.equal(service.campus.snapshot().floorMaps[4].custom,false);
    assert.equal((await service.admin("/map/3",{ image: null },"PUT")).status,200);
    assert.equal(service.campus.snapshot().floorMaps[3].custom,false);
    assert.equal((await service.admin("/rules",{ doubleChance: 101 },"PUT")).status,400);
    assert.equal((await service.admin("/rules",{ doubleChance: 23 },"PUT")).status,200);
    assert.equal(service.campus.snapshot().doubleChance,23);

    const individual = await service.admin("/scores.csv");
    const team = await service.admin("/scores.csv?scope=teams");
    assert.match(await individual.text(), /行政驗證新名/);
    assert.match(await team.text(), /五人平均分/);
    assert.match(team.headers.get("content-disposition")!, /campus-teams.csv/);
    assert.equal((await service.admin("/competition/reset",{ confirm: "RESET" })).status,200);
    assert.equal(service.campus.snapshot().competitionId,2);
    assert.ok(service.campus.adminView().audit.some(item => item.action === "competition.reset"));
    assert.equal((await service.admin("/players/" + a.id + "/kick",{})).status,200);
    const reconnect = await service.connect();
    const rejected = await send(reconnect,"player:reconnect",{ token: a.token });
    assert.ok(!rejected.ok && rejected.code === "invalid-token");
    const linkResponse = await service.admin("/players/" + a.id + "/link",{});
    const token = (await linkResponse.json()).data.token;
    assert.equal((await ok(reconnect,"player:reconnect",{ token })).player.id,a.id);
  } finally { await service.close(); }
});

test("student numbers bind privately to existing and new accounts, with code rotation and account suspension", async () => {
  const service = await harness();
  try {
    const legacy = await service.player("同名學生", "TEAM-01");
    const post = await service.admin("/players", { name: "同名學生", studentNumber: "００１－ａ", teamId: "TEAM-02" });
    assert.equal(post.status, 200);
    const primary: StudentCredential = (await post.json()).data;
    assert.equal(primary.studentNumber, "001-A");
    assert.match(primary.code, /^\d{8}$/);
    assert.equal((await service.admin("/players", { name: "其他學生", studentNumber: "001-a" })).status, 409);

    const unusable = await service.admin("/players/import", { students: [
      { name: "回滾學生", studentNumber: "002" }, { name: "重複", studentNumber: "001-A" }
    ] });
    assert.equal(unusable.status, 409);
    assert.equal(service.store.playerFromStudentNumber("002"), undefined);
    const bulk = await service.admin("/players/import", { students: [
      { name: "同名學生", studentNumber: "003" }, { name: "另一位同學", studentNumber: "004" }
    ] });
    assert.equal(bulk.status, 200);
    assert.equal((await bulk.json()).data.length, 2);
    const issue = await service.admin("/players/" + legacy.id, { name: "同名學生", studentNumber: "0007" }, "PATCH");
    assert.equal(issue.status, 200);
    const oldAccount: StudentCredential = (await issue.json()).data;
    assert.equal(oldAccount.id, legacy.id);
    const guest = await service.connect();
    const revoked = await send(guest, "player:reconnect", { token: legacy.token });
    assert.ok(!revoked.ok && revoked.code === "invalid-token");

    assert.equal((await service.admin("/registration", { open: false }, "PUT")).status, 200);
    service.step();
    assert.equal((await ok(guest, "campus:watch", null)).selfRegistration, false);
    const registration = await send(guest, "player:join", { name: "新暱稱" });
    assert.ok(!registration.ok && registration.code === "registration-closed");
    const badCode = primary.code === "00000000" ? "11111111" : "00000000";
    const invalid = await send(guest, "player:login", { studentNumber: primary.studentNumber, code: badCode });
    assert.ok(!invalid.ok && invalid.code === "student-login");
    const login = await ok(guest, "player:login", { studentNumber: "001-a", code: primary.code });
    assert.equal(login.state.player.id, primary.id);
    const moved = await service.connect();
    const next = await ok(moved, "player:login", { studentNumber: primary.studentNumber, code: primary.code });
    const observer = await service.connect();
    const stale = await send(observer, "player:reconnect", { token: login.token });
    assert.ok(!stale.ok && stale.code === "invalid-token");
    assert.equal((await service.admin("/players/" + primary.id + "/status", { suspended: true }, "PUT")).status, 200);
    assert.equal((await send(observer, "player:reconnect", { token: next.token })).ok, false);
    assert.equal((await send(observer, "player:login", { studentNumber: primary.studentNumber, code: primary.code })).ok, false);
    assert.equal((await service.admin("/players/" + primary.id + "/status", { suspended: false }, "PUT")).status, 200);
    const rotated: StudentCredential = (await (await service.admin("/players/" + primary.id + "/code", {})).json()).data;
    const signedIn = await ok(observer, "player:login", { studentNumber: primary.studentNumber, code: rotated.code });
    assert.equal(signedIn.state.player.id, primary.id);
    assert.equal("studentNumber" in signedIn.state.player, false);
    const row = service.store.player(primary.id)!;
    assert.match(row.access_hash!, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    assert.doesNotMatch(row.access_hash!, new RegExp("^" + rotated.code + "$"));
    assert.equal(service.campus.adminView().players.find(item => item.id === primary.id)?.studentNumber, primary.studentNumber);
    const publicBoard = (await (await fetch(service.origin + "/api/campus")).json()).leaderboard;
    assert.ok(publicBoard.players.every((player: object) => !("studentNumber" in player) && !("access_hash" in player)));
    for (const suffix of ["", "?scope=teams"]) assert.doesNotMatch(await (await service.admin("/scores.csv" + suffix)).text(), /001-A|0007/);
  } finally { await service.close(); }
});

test("a leaderboard reset archives the previous edition, clears the live board and rejects a stale confirmation", async () => {
  const service = await harness();
  try {
    await service.host("HOST-12");
    const a = await service.player("分數封存甲", "TEAM-01");
    const b = await service.player("分數封存乙", "TEAM-02");
    const lobby = await service.match([a,b]);
    await service.begin([a,b], lobby.stationId);
    await service.operate(a.socket, a.id);
    await service.operate(b.socket, b.id);
    service.step(60_000);
    assert.ok(service.store.player(a.id)!.total_score > 0);
    const baseline = service.store.player(a.id)!.total_score;
    const id = service.store.competitionId;
    const reset = { competitionId: id, confirm: "RESET", reason: "活動結束" };
    assert.equal((await service.admin("/competition/reset", { ...reset, reason: "" })).status, 400);
    assert.equal((await service.admin("/competition/reset", reset)).status, 200);
    assert.equal((await service.admin("/competition/reset", reset)).status, 409);
    assert.equal(service.campus.snapshot().competitionId, id + 1);
    assert.ok(service.campus.snapshot().leaderboard.players.every(player => player.totalScore === 0 && player.completed === 0));
    assert.equal(service.store.officialFor(a.id).length, 0);
    assert.equal(service.store.officialFor(a.id, id).length, 1);
    assert.equal(service.campus.adminView().competitions.find(item => item.id === id)?.resetReason, "活動結束");

    await service.admin("/players/" + a.id, { teamId: "TEAM-03" }, "PATCH");
    await service.admin("/players/" + a.id, { name: "新一屆名稱" }, "PATCH");
    const history = await service.admin("/leaderboard?competition=" + id);
    assert.equal(history.status, 200);
    const old = (await history.json()).data.players.find((player: { id: string }) => player.id === a.id);
    assert.deepEqual([old.name, old.teamId, old.totalScore, old.completed], ["分數封存甲", "TEAM-01", baseline, 1]);
    const csv = await service.admin("/scores.csv?competition=" + id);
    assert.match(csv.headers.get("content-disposition")!, new RegExp("campus-scores-edition-" + id + "\\.csv"));
    assert.match(await csv.text(), /分數封存甲/);
    assert.equal((await fetch(service.origin + "/api/admin/leaderboard?competition=" + id)).status, 401);
  } finally { await service.close(); }
});

