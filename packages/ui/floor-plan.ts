import { floorPlanFrame, type Floor } from "../shared/floors";

type Point = [number, number];
type Rect = [number, number, number, number];

const plans: Record<Floor, {
  outline: Point[];
  rooms: Rect[];
  outlines?: Point[][];
  stair: Rect[];
  stairsAtJunction: Point[];
  linework?: Point[][];
  courts?: Rect[];
}> = {
  3: {
    outline: [[422,805],[1017,805],[951,738],[1073,631],[1140,693],[1140,149],[1548,149],[1548,1183],[422,1183]],
    rooms: [
      [1396,232,1548,400], [1396,404,1548,565], [1396,568,1548,754], [1396,754,1548,823],
      [1390,891,1548,1183], [1210,891,1390,1183], [1195,560,1341,754], [1195,398,1341,552],
      [1195,270,1341,396], [1195,149,1338,268],
      [869,861,1083,997], [623,861,869,997], [557,861,623,997], [422,997,526,1045],
      [422,1045,526,1183], [526,1045,731,1183], [731,1045,1085,1183],
      [1085,1045,1147,1183], [1147,1045,1210,1183]
    ],
    stair: [[422,861,557,997],[1394,149,1548,231]],
    stairsAtJunction: [[951,738],[1073,631],[1148,704],[1032,814]],
    linework: [[[1083,861],[1117,861],[1148,899],[1148,997],[1083,997]], [[1254,963],[1390,963]],
      [[1396,864],[1478,864],[1478,829],[1548,829]]]
  },
  4: {
    outline: [[477,786],[1056,786],[980,701],[1095,590],[1166,657],[1166,92],[1561,92],[1565,1107],[1551,1159],[477,1159]],
    rooms: [
      [1166,92,1353,194], [477,1005,622,1159], [622,1005,780,1159],
      [780,1005,947,1159], [947,1005,1115,1159], [1115,1005,1235,1159],
      [1235,907,1390,1113], [715,786,881,971], [605,839,664,971], [664,839,715,971],
      [1418,699,1563,774], [1416,836,1564,909]
    ],
    outlines: [
      [[881,786],[1056,786],[1117,844],[1117,973],[881,973]],
      [[1390,908],[1565,908],[1565,1002],[1469,1002],[1469,1113],[1390,1113]],
      [[1166,194],[1396,194],[1396,220],[1562,220],[1563,699],[1418,699],
        [1418,723],[1228,723],[1166,659]]
    ],
    stair: [[477,786,605,974],[1396,92,1561,219]],
    stairsAtJunction: [[980,701],[1095,590],[1170,669],[1055,782]],
    courts: [[1246,242,1518,363],[1246,385,1518,506],[1246,528,1518,650]],
    linework: [[[1235,1113],[1235,1159]], [[1485,775],[1485,836],[1564,836]]]
  }
};

export function drawFloorPlan(context: CanvasRenderingContext2D, floor: Floor) {
  const frame = floorPlanFrame[floor];
  const plan = plans[floor];
  const color = floor === 3
    ? { room: "#1a344b", hall: "#203448", wall: "#61829e", outer: "#90afc7", stair: "#38536a" }
    : { room: "#193b3c", hall: "#223a43", wall: "#638f8e", outer: "#92c0b9", stair: "#3c5a65" };
  context.save();
  context.translate(-frame.x, -frame.y);
  context.lineJoin = "round";
  context.fillStyle = "#0c1621";
  context.fillRect(frame.x, frame.y, frame.width, frame.height);
  context.strokeStyle = "#192733";
  context.lineWidth = 1;
  context.beginPath();
  const spacing = 34;
  for (let x = frame.x + spacing; x < frame.x + frame.width; x += spacing) {
    context.moveTo(x, frame.y);
    context.lineTo(x, frame.y + frame.height);
  }
  for (let y = frame.y + spacing; y < frame.y + frame.height; y += spacing) {
    context.moveTo(frame.x, y);
    context.lineTo(frame.x + frame.width, y);
  }
  context.stroke();

  function path(points: Point[], closed = false) {
    context.beginPath();
    points.forEach(([x,y], index) => index === 0 ? context.moveTo(x,y) : context.lineTo(x,y));
    if (closed) context.closePath();
  }
  const rectangle = ([x1,y1,x2,y2]: Rect): Point[] => [[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
  function surface(points: Point[], fill: string, stroke: string, width: number) {
    path(points, true);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = width;
    context.stroke();
  }
  surface(plan.outline, color.hall, color.outer, 7);
  for (const shape of [...plan.rooms.map(rectangle), ...(plan.outlines ?? [])]) {
    surface(shape, color.room, color.wall, 4.5);
  }

  function staircase(points: Point[]) {
    surface(points, color.stair, color.wall, 4.5);
    const [leftTop,rightTop,rightBottom,leftBottom] = points;
    context.strokeStyle = color.outer;
    context.lineWidth = 2.5;
    for (let step = 1; step <= 7; step++) {
      const position = step / 8;
      const left: Point = [leftTop[0] + (leftBottom[0]-leftTop[0])*position, leftTop[1] + (leftBottom[1]-leftTop[1])*position];
      const right: Point = [rightTop[0] + (rightBottom[0]-rightTop[0])*position, rightTop[1] + (rightBottom[1]-rightTop[1])*position];
      path([left,right]);
      context.stroke();
    }
  }
  for (const stair of plan.stair) staircase(rectangle(stair));
  staircase(plan.stairsAtJunction);

  context.strokeStyle = color.wall;
  context.lineWidth = 3;
  for (const line of plan.linework ?? []) {
    path(line);
    context.stroke();
  }
  context.lineWidth = 2;
  for (const court of plan.courts ?? []) {
    const [x1,y1,x2,y2] = court;
    const centerX = (x1+x2)/2;
    const centerY = (y1+y2)/2;
    context.strokeRect(x1,y1,x2-x1,y2-y1);
    path([[x1,centerY],[x2,centerY]]);
    context.stroke();
    path([[centerX,y1],[centerX,y2]]);
    context.stroke();
  }
  context.restore();
}

