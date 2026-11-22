import assert from "node:assert/strict";
import { test } from "node:test";
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

