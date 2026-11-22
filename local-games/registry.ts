import type { PluginFactory } from "../packages/game-sdk";
import sokoban from "./game-01";
import lights from "./game-02";
import pipes from "./game-03";
import traffic from "./game-04";
import tubes from "./game-05";
import star from "./game-08";
import dino from "./game-09";
import mentalMath from "./game-10";
import twentyFour from "./game-11";
import prime from "./game-12";
import fractions from "./game-13";
import mazeRun from "./game-14";
import oasis from "./game-15";
import browserQuest from "./game-16";
import mathDuel from "./game-18";
import mathBreakout from "./game-20";
import slimeVolleyball from "./game-21";
import airHockey from "./game-22";
import neonBomberman from "./game-23";
import dojoFighter from "./game-24";

export const plugins: ReadonlyMap<string, PluginFactory> = new Map([
  ["game-01", sokoban],
  ["game-02", lights],
  ["game-03", pipes],
  ["game-04", traffic],
  ["game-05", tubes],
  ["game-08", star],
  ["game-09", dino],
  ["game-10", mentalMath],
  ["game-11", twentyFour],
  ["game-12", prime],
  ["game-13", fractions],
  ["game-14", mazeRun],
  ["game-15", oasis],
  ["game-16", browserQuest],
  ["game-18", mathDuel],
  ["game-20", mathBreakout],
  ["game-21", slimeVolleyball],
  ["game-22", airHockey],
  ["game-23", neonBomberman],
  ["game-24", dojoFighter]
]);
