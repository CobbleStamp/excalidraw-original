/**
 * excalidraw-web: draws one frame of the animated elements: a glowing dot or
 * chevron travelling along a line, a glowing light travelling around a
 * shape, a pulse that glows and swells an outline, or a shimmer, a band of
 * light sweeping over what an element draws; each where its loop or
 * triggered run has reached.
 */
import { applyDarkModeFilter, THEME } from "@excalidraw/common";

import {
  getAnimationPath,
  getElementBounds,
  getLineMarker,
  getTravellingPoint,
  renderElement,
} from "@excalidraw/element";

import type {
  AnimationPath,
  ElementRenderState,
  LineMarker,
} from "@excalidraw/element";

import type {
  AnimationEffect,
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { bootstrapCanvas } from "./helpers";

import type { RoughCanvas } from "roughjs/bin/canvas";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../scene/types";
import type { AppState } from "../types";

/** An element to animate, the effect it plays, and how far through its run it is */
export type AnimationToDraw = {
  element: NonDeletedExcalidrawElement;
  effect: AnimationEffect;
  progress: number;
};

export type AnimatedSceneProps = {
  canvas: HTMLCanvasElement;
  /** the device pixel ratio */
  scale: number;
  appState: AppState;
  animations: readonly AnimationToDraw[];
  elementsMap: NonDeletedSceneElementsMap;
  /** what the drawn layer draws, for drawing an element again under a shimmer */
  renderableElementsMap: RenderableElementsMap;
  rc: RoughCanvas;
  renderConfig: StaticCanvasRenderConfig;
  /** how the drawn layer shows an element now: faded, erased or slid by the host's overrides */
  renderStateOf: (element: ExcalidrawElement) => ElementRenderState;
  /** the host's colour for an element's light, `null` for the editor's own */
  colorOf?: (element: ExcalidrawElement) => string | null;
};

/** The light of an image, which has no colour of its own: the editor's primary colour */
const IMAGE_LIGHT_COLOR = "#6965db";

const drawDot = (
  context: CanvasRenderingContext2D,
  point: readonly [number, number],
  strokeWidth: number,
) => {
  const radius = Math.max(4.5, strokeWidth * 2);
  context.beginPath();
  context.arc(point[0], point[1], radius, 0, Math.PI * 2);
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

/** Strokes a path, swollen about its middle by `swell` */
const strokePath = (
  context: CanvasRenderingContext2D,
  path: AnimationPath,
  swell: number,
) => {
  const xs = path.points.map(([x]) => x);
  const ys = path.points.map(([, y]) => y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  context.translate(cx, cy);
  context.scale(swell, swell);
  context.translate(-cx, -cy);
  context.beginPath();
  path.points.forEach(([x, y], i) =>
    i === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
  );
  if (path.closed) {
    context.closePath();
  }
  context.stroke();
};

/** How bright a pulse is, and how far it has swollen, through its run: up and back down */
const pulseOf = (progress: number) => {
  const rise = Math.sin(Math.PI * progress);
  return { alpha: rise, swell: 1 + 0.06 * rise };
};

let shimmerCanvas: HTMLCanvasElement | null = null;

/** Draws an element again on a canvas of its own, lights a band across it, and lays it over the layer */
const drawShimmer = (
  context: CanvasRenderingContext2D,
  element: NonDeletedExcalidrawElement,
  progress: number,
  props: AnimatedSceneProps,
  state: ElementRenderState,
) => {
  const { appState, scale } = props;
  shimmerCanvas ??= document.createElement("canvas");
  shimmerCanvas.width = props.canvas.width;
  shimmerCanvas.height = props.canvas.height;
  const own = bootstrapCanvas({
    canvas: shimmerCanvas,
    scale,
    normalizedWidth: appState.width,
    normalizedHeight: appState.height,
  });
  own.clearRect(0, 0, appState.width, appState.height);
  const zoom = appState.zoom.value;
  own.scale(zoom, zoom);
  renderElement(
    element,
    props.renderableElementsMap,
    props.elementsMap,
    props.rc,
    own,
    props.renderConfig,
    appState,
    state,
  );
  // the band runs across the element's box, from beyond its left to beyond its right
  const [x1, y1, x2, y2] = getElementBounds(element, props.elementsMap);
  const band = Math.max(24, (x2 - x1 + (y2 - y1)) * 0.2);
  const along = x1 - band + (x2 - x1 + 2 * band) * progress;
  own.translate(
    appState.scrollX + state.offset.x,
    appState.scrollY + state.offset.y,
  );
  own.globalCompositeOperation = "source-atop";
  const light = own.createLinearGradient(along - band, y1, along + band, y2);
  light.addColorStop(0, "rgba(255, 255, 255, 0)");
  light.addColorStop(0.5, "rgba(255, 255, 255, 0.85)");
  light.addColorStop(1, "rgba(255, 255, 255, 0)");
  own.fillStyle = light;
  own.fillRect(x1 - band, y1 - band, x2 - x1 + 2 * band, y2 - y1 + 2 * band);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(shimmerCanvas, 0, 0);
  context.restore();
};

/** The colour an element's light is drawn in: the host's, else an image's own light, else its stroke colour */
const lightColorOf = (
  element: ExcalidrawElement,
  props: AnimatedSceneProps,
): string =>
  props.colorOf?.(element) ??
  (element.type === "image" ? IMAGE_LIGHT_COLOR : element.strokeColor);

/** Draws a line's marker, a travelling light or a pulse on one element */
const drawMarkerOrPulse = (
  context: CanvasRenderingContext2D,
  { element, effect, progress }: AnimationToDraw,
  elementsMap: ElementsMap,
) => {
  if (effect === "dot" || effect === "chevron") {
    const marker = getLineMarker(
      element as ExcalidrawLinearElement,
      elementsMap,
      progress,
    );
    if (marker && effect === "chevron") {
      drawChevron(context, marker, element.strokeWidth);
    } else if (marker) {
      drawDot(context, marker.point, element.strokeWidth);
    }
    return;
  }
  const path = getAnimationPath(element, elementsMap);
  if (effect === "travel") {
    const point = getTravellingPoint(path, progress);
    if (point) {
      drawDot(context, point, element.strokeWidth);
    }
    return;
  }
  const { alpha, swell } = pulseOf(progress);
  context.globalAlpha *= alpha;
  context.lineWidth = Math.max(2.5, element.strokeWidth * 1.5);
  context.lineCap = "round";
  context.lineJoin = "round";
  strokePath(context, path, swell);
};

/** Clears the canvas and draws each given animation */
export const renderAnimatedScene = (props: AnimatedSceneProps): void => {
  const { canvas, scale, appState, animations, elementsMap, renderStateOf } =
    props;
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
  for (const animation of animations) {
    const { element } = animation;
    const state = renderStateOf(element);
    if (!(state.opacity > 0)) {
      continue;
    }
    if (animation.effect === "shimmer") {
      drawShimmer(context, element, animation.progress, props, state);
      continue;
    }
    const color = applyDarkModeFilter(
      lightColorOf(element, props),
      appState.theme === THEME.DARK,
    );
    context.save();
    context.translate(state.offset.x, state.offset.y);
    context.globalAlpha = state.opacity;
    context.fillStyle = color;
    context.strokeStyle = color;
    context.shadowColor = color;
    // the blur is in device pixels, so it follows zoom and pixel ratio itself
    context.shadowBlur = Math.max(12, element.strokeWidth * 5) * zoom * scale;
    drawMarkerOrPulse(context, animation, elementsMap);
    context.restore();
  }
};
