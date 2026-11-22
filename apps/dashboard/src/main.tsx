import { createRoot } from "react-dom/client";
import { ArrowLeft } from "@phosphor-icons/react";
import "@fontsource-variable/geist";
import "../../../packages/ui/styles.css";
import "../../../packages/ui/christmas-theme.css";
import "../../../packages/ui/host-play.css";
import { ChristmasSnowfall } from "../../../packages/ui/christmas-art";
import { Brand, Header } from "../../../packages/ui/components";
import { useCampus } from "../../../packages/ui/network";
import { Controller } from "../../controller/src/Controller";
import { Host } from "../../host/src/Host";
import { CampusMap } from "./CampusMap";
import { Leaderboard } from "./Leaderboard";
import { Admin } from "./Admin";
import { Practice } from "./Practice";

const path = location.pathname.replace(/\/$/, "") || "/";
const names: Record<string,string> = { "/": "校園地圖", "/controller": "手機控制器", "/host": "固定主機", "/leaderboard": "聖誕即時排行榜",
  "/admin": "管理後台", "/practice": "測試遊戲" };
document.title = (names[path] ?? "找不到頁面") + " · Campus Quest";
if (path === "/leaderboard") {
  document.body.dataset.theme = "xmas-leaderboard";
} else {
  delete document.body.dataset.theme;
}

function App() {
  const connection = useCampus();
  return <>
    <ChristmasSnowfall/>
    {path === "/host" || path === "/practice" ? null : <Header path={path} online={connection.online}/>}
    {path === "/" ? <CampusMap connection={connection}/>
      : path === "/controller" ? <Controller connection={connection}/>
      : path === "/host" ? <Host connection={connection}/>
      : path === "/leaderboard" ? <Leaderboard connection={connection}/>
      : path === "/admin" ? <Admin connection={connection}/>
      : path === "/practice" ? <Practice connection={connection}/>
      : <main id="main" className="narrow join-layout"><div className="panel join-panel">
        <p className="eyebrow">404</p><h1>找不到此頁面</h1><a className="button primary" href="/"><ArrowLeft size={18}/> 返回校園地圖</a>
      </div></main>}
    {(path === "/admin" || path === "/leaderboard") && <footer className="site-footer shell"><Brand/><span>校園闖關平台</span></footer>}
  </>;
}

createRoot(document.getElementById("root")!).render(<App/>);

