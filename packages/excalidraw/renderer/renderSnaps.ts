import { pointFrom, type GlobalPoint, type LocalPoint } from "@excalidraw/math";

import { THEME } from "@excalidraw/common";

import type { PointSnapLine, PointerSnapLine, SizeSnapLine } from "../snapping";
import type { InteractiveCanvasAppState } from "../types";

const SNAP_COLOR_LIGHT = "#ff6b6b";
// dark-mode colors are the equivalents of what the former CSS inversion filter
// produced (see `applyDarkModeFilter`)
const SNAP_COLOR_DARK = "#ff9090";
const SNAP_COLOR_DARK_ZEN = "#da5b5b";
const SNAP_WIDTH = 1;
const SNAP_CROSS_SIZE = 2;
// the size label, in screen pixels
const SIZE_LABEL_FONT_SIZE = 11;
const SIZE_LABEL_PADDING_X = 5;
const SIZE_LABEL_HEIGHT = 18;
const SIZE_LABEL_GAP = 8;
const SIZE_LABEL_TEXT_COLOR = "#ffffff";

export const renderSnaps = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.snapLines.length) {
    return;
  }

  // in zen mode we draw only crosses, so use a different color to keep them
  // visible
  const snapColor =
    appState.theme === THEME.LIGHT
      ? SNAP_COLOR_LIGHT
      : appState.zenModeEnabled
      ? SNAP_COLOR_DARK_ZEN
      : SNAP_COLOR_DARK;
  // in zen mode make the cross more visible since we don't draw the lines
  const snapWidth =
    (appState.zenModeEnabled ? SNAP_WIDTH * 1.5 : SNAP_WIDTH) /
    appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  for (const snapLine of appState.snapLines) {
    if (snapLine.type === "pointer") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;

      drawPointerSnapLine(snapLine, context, appState);
    } else if (snapLine.type === "gap") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;

      drawGapLine(
        snapLine.points[0],
        snapLine.points[1],
        snapLine.direction,
        appState,
        context,
      );
    } else if (snapLine.type === "points") {
      context.lineWidth = snapWidth;
      context.strokeStyle = snapColor;
      drawPointsSnapLine(snapLine, context, appState);
    } else if (snapLine.type === "size") {
      drawSizeLabel(snapLine, snapColor, context, appState);
    }
  }

  context.restore();
};

/** "width × height" in a pill centred below the shape, the same size on
    screen at any zoom */
const drawSizeLabel = (
  sizeSnapLine: SizeSnapLine,
  color: string,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  const zoom: number = appState.zoom.value;
  const text: string = `${Math.round(sizeSnapLine.width)} × ${Math.round(
    sizeSnapLine.height,
  )}`;
  const [x, y]: GlobalPoint = sizeSnapLine.point;

  context.save();
  context.font = `${SIZE_LABEL_FONT_SIZE / zoom}px sans-serif`;
  const width: number =
    context.measureText(text).width + (2 * SIZE_LABEL_PADDING_X) / zoom;
  const height: number = SIZE_LABEL_HEIGHT / zoom;
  const top: number = y + SIZE_LABEL_GAP / zoom;

  context.fillStyle = color;
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(x - width / 2, top, width, height, height / 4);
  } else {
    context.rect(x - width / 2, top, width, height);
  }
  context.fill();

  context.fillStyle = SIZE_LABEL_TEXT_COLOR;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, top + height / 2);
  context.restore();
};

const drawPointsSnapLine = (
  pointSnapLine: PointSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.zenModeEnabled) {
    const firstPoint = pointSnapLine.points[0];
    const lastPoint = pointSnapLine.points[pointSnapLine.points.length - 1];

    drawLine(firstPoint, lastPoint, context);
  }

  for (const point of pointSnapLine.points) {
    drawCross(point, appState, context);
  }
};

const drawPointerSnapLine = (
  pointerSnapLine: PointerSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  drawCross(pointerSnapLine.points[0], appState, context);
  if (!appState.zenModeEnabled) {
    drawLine(pointerSnapLine.points[0], pointerSnapLine.points[1], context);
  }
};

const drawCross = <Point extends LocalPoint | GlobalPoint>(
  [x, y]: Point,
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  context.save();
  const size =
    (appState.zenModeEnabled ? SNAP_CROSS_SIZE * 1.5 : SNAP_CROSS_SIZE) /
    appState.zoom.value;
  context.beginPath();

  context.moveTo(x - size, y - size);
  context.lineTo(x + size, y + size);

  context.moveTo(x + size, y - size);
  context.lineTo(x - size, y + size);

  context.stroke();
  context.restore();
};

const drawLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  context: CanvasRenderingContext2D,
) => {
  context.beginPath();
  context.lineTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
};

const drawGapLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  direction: "horizontal" | "vertical",
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  // a horizontal gap snap line
  // |–––––––||–––––––|
  // ^    ^   ^       ^
  // \    \   \       \
  // (1)  (2) (3)     (4)

  const FULL = 8 / appState.zoom.value;
  const HALF = FULL / 2;
  const QUARTER = FULL / 4;

  if (direction === "horizontal") {
    const halfPoint = [(from[0] + to[0]) / 2, from[1]];
    // (1)
    if (!appState.zenModeEnabled) {
      drawLine(
        pointFrom(from[0], from[1] - FULL),
        pointFrom(from[0], from[1] + FULL),
        context,
      );
    }

    // (3)
    drawLine(
      pointFrom(halfPoint[0] - QUARTER, halfPoint[1] - HALF),
      pointFrom(halfPoint[0] - QUARTER, halfPoint[1] + HALF),
      context,
    );
    drawLine(
      pointFrom(halfPoint[0] + QUARTER, halfPoint[1] - HALF),
      pointFrom(halfPoint[0] + QUARTER, halfPoint[1] + HALF),
      context,
    );

    if (!appState.zenModeEnabled) {
      // (4)
      drawLine(
        pointFrom(to[0], to[1] - FULL),
        pointFrom(to[0], to[1] + FULL),
        context,
      );

      // (2)
      drawLine(from, to, context);
    }
  } else {
    const halfPoint = [from[0], (from[1] + to[1]) / 2];
    // (1)
    if (!appState.zenModeEnabled) {
      drawLine(
        pointFrom(from[0] - FULL, from[1]),
        pointFrom(from[0] + FULL, from[1]),
        context,
      );
    }

    // (3)
    drawLine(
      pointFrom(halfPoint[0] - HALF, halfPoint[1] - QUARTER),
      pointFrom(halfPoint[0] + HALF, halfPoint[1] - QUARTER),
      context,
    );
    drawLine(
      pointFrom(halfPoint[0] - HALF, halfPoint[1] + QUARTER),
      pointFrom(halfPoint[0] + HALF, halfPoint[1] + QUARTER),
      context,
    );

    if (!appState.zenModeEnabled) {
      // (4)
      drawLine(
        pointFrom(to[0] - FULL, to[1]),
        pointFrom(to[0] + FULL, to[1]),
        context,
      );

      // (2)
      drawLine(from, to, context);
    }
  }
};
