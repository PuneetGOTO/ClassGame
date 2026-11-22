export const TEAM_SIZE = 5;
export const TEAM_COUNT = 10;
export const PLAYER_LIMIT = TEAM_SIZE * TEAM_COUNT;
export const STATION_COUNT = 20;
export const GAME_MS = 60_000;
export const COUNTDOWN_MS = 3_000;
export const LOBBY_MS = 90_000;
export const SCORE_SCALE = TEAM_SIZE;

export type Category = "puzzle" | "adventure" | "math";
export type Mode = "solo" | "co-op" | "team-quiz";
export type Controls = "directions" | "cell" | "traffic" | "flight" | "runner" | "quest" | "answer" | "expression";

export interface GameInfo {
  id: string;
  name: string;
  english: string;
  category: Category;
  mode: Mode;
  controls: Controls;
  objective: string;
}

const entries = [
  ["推箱子", "Sokoban", "puzzle", "solo", "directions", "把所有箱子推到標記的位置。"],
  ["關燈解謎", "Lights Out", "puzzle", "solo", "cell", "點一盞燈會翻轉自己和上下左右。把所有燈熄滅。"],
  ["水管拼接", "Pipe Connect", "puzzle", "solo", "cell", "點按旋轉水管，接通入口、所有管段和出口。"],
  ["交通解困", "Rush Hour", "puzzle", "solo", "traffic", "選取車輛，再沿車身方向移動。把金色車開到右側出口。"],
  ["試管分色", "Water Sort", "puzzle", "solo", "cell", "依序點選來源與目的試管，將液體整理成每管一色。"],
  ["迷宮吃豆", "Maze Muncher", "adventure", "solo", "directions", "在迷宮內吃到指定數量的豆。碰到巡邏怪物會返回起點。"],
  ["穿越馬路", "Cross Road", "adventure", "solo", "directions", "穿越車道抵達對岸。碰到車輛會返回起點。"],
  ["太空守衛", "Star Defender", "adventure", "solo", "flight", "左右移動並發射，擊落指定數量的敵方飛船。"],
  ["恐龍逃亡", "Dino Run", "adventure", "solo", "runner", "跳過地面障礙並蹲下閃過飛鳥，連續通過指定數量的障礙。"],
  ["心算挑戰", "Math Challenge", "math", "solo", "answer", "答對指定數量的加減乘除題目。"],
  ["二十四點", "Game 24", "math", "solo", "expression", "每題把四個數字各用一次，組成等於 24 的算式。"],
  ["質數判斷", "Prime Check", "math", "solo", "answer", "完成指定題數，並答對足夠的質數判斷題。"],
  ["分數比較", "Fraction Compare", "math", "solo", "answer", "完成指定題數，並答對足夠的分數比較題。"],
  ["迷宮尋路", "Maze Run", "adventure", "solo", "directions", "拾齊所有訊號，再從迷宮出口離開。"],
  ["地圖探險", "Oasis", "adventure", "solo", "quest", "走近信標並按操作鍵拾取，每次帶回營地交付一座。"],
  ["勇者冒險", "BrowserQuest", "adventure", "solo", "quest", "走近守衛並按操作鍵攻擊，擊敗所有守衛後抵達終點。"],
  ["龍之遠征", "WebCraft", "adventure", "solo", "quest", "收集所有晶石並擊退巨龍，再前往遠征終點。"],
  ["數學快答", "Math Duel", "math", "solo", "answer", "輸入每題的答案，在限時內答對指定題數。"],
  ["數字推理", "Number Hunt", "math", "solo", "answer", "根據線索找出指定數量的神秘數字。"],
  ["數學破磚", "Math Breakout", "math", "solo", "answer", "每答對一題擊碎一塊磚，把所有磚塊擊碎。"]
] as const;

export const GAMES: GameInfo[] = entries.map(([name, english, category, mode, controls, objective], i) => ({
  id: `game-${String(i + 1).padStart(2, "0")}`, name, english, category, mode, controls, objective
}));
export const categoryLabel: Record<Category, string> = { puzzle: "解謎", adventure: "冒險", math: "數學" };
export const modeLabel: Record<Mode, string> = { solo: "單人", "co-op": "隊伍合作", "team-quiz": "隊伍答題" };
export const gameById = new Map(GAMES.map(game => [game.id, game]));
export const fixedId = (type: "TEAM" | "HOST" | "STATION", number: number) =>
  `${type}-${String(number).padStart(2, "0")}`;
export const teamColors = ["#77c7ff", "#f8be6d", "#73e3b3", "#f189ac", "#a5acff", "#ff946e", "#5ae3ed", "#c3e879", "#d4acff", "#f4dc62"];

