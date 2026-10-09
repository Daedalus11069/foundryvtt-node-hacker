/**
 * Ported directly from hacking-minigame-test's NodeConnection.calculateOffset/calculateStyles
 * (itself adapted from https://stackoverflow.com/questions/19382872/how-to-connect-html-divs-with-lines):
 * given two grid cells and a fixed cell size, computes the CSS for a single absolutely
 * positioned, rotated <div> that visually connects their centers - the "connect two divs
 * with a line" technique, not an SVG overlay. Ported as-is (row/col naming kept close to
 * the original) rather than reinvented, per instruction to copy this project's own logic.
 */
export interface GridPoint {
  x: number;
  y: number;
}

export interface ConnectorStyle {
  top: number;
  left: number;
  height: number;
  rotationDeg: number;
}

interface Offset {
  x: number;
  y: number;
}

function calculateOffset(from: GridPoint, to: GridPoint, width: number, height: number) {
  const linegap = 1;
  let fromOffset: Offset = { x: 0, y: 0 };
  let toOffset: Offset = { x: 0, y: 0 };

  if (to.y < from.y && to.x === from.x) {
    // To above From
    fromOffset = { x: width / 2 - linegap, y: 0 };
    toOffset = { x: width / 2 - linegap, y: height };
  } else if (to.y < from.y && to.x > from.x) {
    // To top-right of From
    fromOffset = { x: width - linegap, y: 0 };
    toOffset = { x: 0, y: height - linegap };
  } else if (to.y === from.y && to.x > from.x) {
    // To right of From
    fromOffset = { x: width, y: height / 2 - linegap };
    toOffset = { x: 0, y: height / 2 - linegap };
  } else if (to.y > from.y && to.x > from.x) {
    // To bottom-right of From
    fromOffset = { x: width, y: height - linegap };
    toOffset = { x: linegap, y: 0 };
  } else if (to.y > from.y && to.x === from.x) {
    // To below From
    fromOffset = { x: width / 2 + linegap, y: height };
    toOffset = { x: width / 2 + linegap, y: 0 };
  } else if (to.y > from.y && to.x < from.x) {
    // To bottom-left of From
    fromOffset = { x: linegap, y: height };
    toOffset = { x: width, y: linegap };
  } else if (to.y === from.y && to.x < from.x) {
    // To left of From
    fromOffset = { x: 0, y: height / 2 + linegap };
    toOffset = { x: width, y: height / 2 + linegap };
  } else if (to.y < from.y && to.x < from.x) {
    // To top-left of From
    fromOffset = { x: 0, y: linegap };
    toOffset = { x: width - linegap, y: height };
  }

  return { from: fromOffset, to: toOffset };
}

function orderByAxis(points: [Offset & GridPoint, Offset & GridPoint], axis: "x" | "y") {
  return [...points].sort((a, b) => a[axis] - b[axis]);
}

export function calculateConnectorStyle(from: GridPoint, to: GridPoint, cellSize: number): ConnectorStyle {
  const width = cellSize;
  const height = cellSize;
  const offsets = calculateOffset(from, to, width, height);
  const widthAdjust = width / 4;
  const heightAdjust = height / 4;

  const fromPoint = { ...offsets.from, x: offsets.from.x + from.x * width, y: offsets.from.y + from.y * height };
  const toPoint = { ...offsets.to, x: offsets.to.x + to.x * width, y: offsets.to.y + to.y * height };

  if (from.y !== to.y) {
    orderByAxis([fromPoint, toPoint], "y").forEach((point, i) => {
      point.y += heightAdjust * (i === 0 ? -1 : 1);
    });
  }
  if (from.x !== to.x) {
    orderByAxis([fromPoint, toPoint], "x").forEach((point, i) => {
      point.x += widthAdjust * (i === 0 ? -1 : 1);
    });
  }

  const fT = fromPoint.y;
  const tT = toPoint.y;
  const fL = fromPoint.x;
  const tL = toPoint.x;

  const CA = Math.abs(tT - fT);
  const CO = Math.abs(tL - fL);
  const H = Math.sqrt(CA * CA + CO * CO);
  let ANG = (180 / Math.PI) * Math.acos(CA / H);

  const top = tT > fT ? (tT - fT) / 2 + fT : (fT - tT) / 2 + tT;
  const left = tL > fL ? (tL - fL) / 2 + fL : (fL - tL) / 2 + tL;

  if ((fT < tT && fL < tL) || (tT < fT && tL < fL) || (fT > tT && fL > tL) || (tT > fT && tL > fL)) {
    ANG *= -1;
  }

  return { top: top - H / 2, left, height: H, rotationDeg: ANG };
}
