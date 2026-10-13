/**
 * excalidraw-web: draws one frame of the animated lines' markers: a glowing
 * dot on a line, a glowing chevron on an arrow, each in its line's colour,
 * where the line's loop or triggered run has reached.
 */
import { applyDarkModeFilter, THEME } from "@excalidraw/common";

import { getLineMarker } from "@excalidraw/element";

import type { ElementRenderState, LineMarker } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

import { bootstrapCanvas } from "./helpers";

import type { AppState } from "../types";

/** A line to draw a marker on, and how far through its run the marker is */
export type LineMarkerToDraw = {
  line: ExcalidrawLinearElement;
  progress: number;
};

export type AnimatedLinesSceneProps = {
  canvas: HTMLCanvasElement;
  /** the device pixel ratio */
  scale: number;
  appState: Pick<
    AppState,
    "width" | "height" | "zoom" | "scrollX" | "scrollY" | "theme"
  >;
  markers: readonly LineMarkerToDraw[];
  elementsMap: ElementsMap;
  /** how the drawn layer shows a line now: faded, erased or slid by the host's overrides */
  renderStateOf: (line: ExcalidrawLinearElement) => ElementRenderState;
};

const drawDot = (
  context: CanvasRenderingContext2D,
  marker: LineMarker,
  strokeWidth: number,
) => {
  const radius = Math.max(4.5, strokeWidth * 2);
  context.beginPath();
  context.arc(marker.point[0], marker.point[1], radius, 0, Math.PI * 2);
  context.fill();
};

const drawChevron = (
  context: CanvasRenderingContext2D,
  marker: LineMarker,
  strokeWidth: number,
) => {
  const arm = Math.max(9, strokeWidth * 3.5);
  context.lineWidth = Math.max(2.5, strokeWidth * 1.25);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.translate(marker.point[0], marker.point[1]);
  context.rotate(marker.heading);
  context.beginPath();
  context.moveTo(-arm * 0.7, -arm * 0.75);
  context.lineTo(0, 0);
  context.lineTo(-arm * 0.7, arm * 0.75);
  context.stroke();
};

/** Clears the canvas and draws each given marker */
export const renderAnimatedLinesScene = ({
  canvas,
  scale,
  appState,
  markers,
  elementsMap,
  renderStateOf,
}: AnimatedLinesSceneProps): void => {
  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth: appState.width,
    normalizedHeight: appState.height,
  });
  context.clearRect(0, 0, appState.width, appState.height);
  const zoom = appState.zoom.value;
  context.scale(zoom, zoom);
  context.translate(appState.scrollX, appState.scrollY);
  for (const { line, progress } of markers) {
    const state = renderStateOf(line);
    const marker =
      state.opacity > 0 ? getLineMarker(line, elementsMap, progress) : null;
    if (!marker) {
      continue;
    }
    const color = applyDarkModeFilter(
      line.strokeColor,
      appState.theme === THEME.DARK,
    );
    context.save();
    context.translate(state.offset.x, state.offset.y);
    context.globalAlpha = state.opacity;
    context.fillStyle = color;
    context.strokeStyle = color;
    context.shadowColor = color;
    // the blur is in device pixels, so it follows zoom and pixel ratio itself
    context.shadowBlur = Math.max(12, line.strokeWidth * 5) * zoom * scale;
    if (line.type === "arrow") {
      drawChevron(context, marker, line.strokeWidth);
    } else {
      drawDot(context, marker, line.strokeWidth);
    }
    context.restore();
  }
};
