/**
 * excalidraw-web: draws one frame of the animated elements: a glowing dot or
 * chevron travelling along a line, a glowing light travelling around a
 * shape, a pulse that glows and swells an outline, or a shimmer, a band of
 * light sweeping over what an element draws; each where its loop or
 * triggered run has reached.
 */
import { applyDarkModeFilter, isTransparent, THEME } from "@excalidraw/common";

import {
  getAnimationPath,
  getElementBounds,
  getMarkerOnLine,
  getTravellingPoint,
  renderElement,
} from "@excalidraw/element";

import type {
  AnimationMarker,
  AnimationPath,
  ElementRenderState,
} from "@excalidraw/element";

import type {
  AnimationEffect,
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { bootstrapCanvas, snapScrollToDevicePixels } from "./helpers";
import { createElementClipper } from "./staticScene";

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
  /** the editor's own canvas for shaping a shimmer, made when first needed and kept between frames */
  shimmerCanvas: { current: HTMLCanvasElement | null };
};

/** The light of an image, or of a stroke that does not show: the editor's primary colour */
const PRIMARY_LIGHT_COLOR = "#6965db";

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
  marker: AnimationMarker,
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
  const [x1, y1, x2, y2] = path.bounds;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
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

/** The direction a shimmer's band sweeps in: rightward and a little down */
const SHIMMER_DIRECTION = [
  Math.cos(Math.PI / 8),
  Math.sin(Math.PI / 8),
] as const;

/**
 * Where a shimmer's band is `progress` of the way across a box, in the box's
 * coordinates: the line its gradient runs along, clear at both ends and
 * brightest in the middle. It sweeps the box's whole extent along its
 * direction, so it starts wholly before the box and ends wholly past it.
 */
export const getShimmerBand = (
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  progress: number,
): { from: [number, number]; to: [number, number] } => {
  const [ux, uy] = SHIMMER_DIRECTION;
  // both parts of the direction are positive, so the top-left corner comes first along it and the bottom-right last
  const near = x1 * ux + y1 * uy;
  const far = x2 * ux + y2 * uy;
  const half = Math.max(24, (x2 - x1 + (y2 - y1)) * 0.2);
  const middle = near - half + (far - near + 2 * half) * progress;
  return {
    from: [ux * (middle - half), uy * (middle - half)],
    to: [ux * (middle + half), uy * (middle + half)],
  };
};

/** How far around an element, in drawing units, its shimmer's canvas works: room for a rough stroke */
const SHIMMER_PADDING = 8;

/**
 * Lights a band across an element and lays it over the layer: the element is
 * drawn on a canvas of its own only to shape the band (`source-in`), so its
 * label and whatever lies above it stay as the drawn layer shows them. Only
 * the element's box on the screen is worked on.
 */
const drawShimmer = (
  context: CanvasRenderingContext2D,
  element: NonDeletedExcalidrawElement,
  progress: number,
  props: AnimatedSceneProps,
  appState: AppState,
  state: ElementRenderState,
) => {
  const { scale } = props;
  const shimmerCanvas = (props.shimmerCanvas.current ??=
    document.createElement("canvas"));
  // resizing reallocates the bitmap, so only when the layer's size changed
  if (
    shimmerCanvas.width !== props.canvas.width ||
    shimmerCanvas.height !== props.canvas.height
  ) {
    shimmerCanvas.width = props.canvas.width;
    shimmerCanvas.height = props.canvas.height;
  }
  const zoom = appState.zoom.value;
  const bounds = getElementBounds(element, props.elementsMap);
  const pad = SHIMMER_PADDING + element.strokeWidth * 2;
  const shiftX = appState.scrollX + state.offset.x;
  const shiftY = appState.scrollY + state.offset.y;
  const pixels = zoom * scale;
  const left = Math.max(0, Math.floor((bounds[0] - pad + shiftX) * pixels));
  const top = Math.max(0, Math.floor((bounds[1] - pad + shiftY) * pixels));
  const right = Math.min(
    shimmerCanvas.width,
    Math.ceil((bounds[2] + pad + shiftX) * pixels),
  );
  const bottom = Math.min(
    shimmerCanvas.height,
    Math.ceil((bounds[3] + pad + shiftY) * pixels),
  );
  if (!(right > left && bottom > top)) {
    return;
  }
  const width = right - left;
  const height = bottom - top;
  const own = shimmerCanvas.getContext("2d")!;
  // the canvas is kept between frames, its compositing with it
  own.save();
  // restored even when drawing throws, so no clip or compositing outlives the frame
  try {
    own.setTransform(1, 0, 0, 1, 0, 0);
    own.clearRect(left, top, width, height);
    own.beginPath();
    own.rect(left, top, width, height);
    own.clip();
    own.scale(pixels, pixels);
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
    own.translate(shiftX, shiftY);
    own.globalCompositeOperation = "source-in";
    const { from, to } = getShimmerBand(bounds, progress);
    const light = own.createLinearGradient(from[0], from[1], to[0], to[1]);
    light.addColorStop(0, "rgba(255, 255, 255, 0)");
    light.addColorStop(0.5, "rgba(255, 255, 255, 0.85)");
    light.addColorStop(1, "rgba(255, 255, 255, 0)");
    own.fillStyle = light;
    // past the worked area, so no copy of the element is left outside the band
    own.fillRect(
      bounds[0] - 2 * pad,
      bounds[1] - 2 * pad,
      bounds[2] - bounds[0] + 4 * pad,
      bounds[3] - bounds[1] + 4 * pad,
    );
  } finally {
    own.restore();
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(
    shimmerCanvas,
    left,
    top,
    width,
    height,
    left,
    top,
    width,
    height,
  );
  context.restore();
};

/** The colour an element's light is drawn in: the host's, else the editor's primary colour for an image or a stroke that does not show, else its stroke colour */
export const animationLightColorOf = (
  element: ExcalidrawElement,
  colorOf?: (element: ExcalidrawElement) => string | null,
): string =>
  colorOf?.(element) ??
  (element.type === "image" || isTransparent(element.strokeColor)
    ? PRIMARY_LIGHT_COLOR
    : element.strokeColor);

/** Draws a line's marker, a travelling light or a pulse on one element */
const drawMarkerOrPulse = (
  context: CanvasRenderingContext2D,
  { element, effect, progress }: AnimationToDraw,
  elementsMap: ElementsMap,
) => {
  if (effect === "dot" || effect === "chevron") {
    const marker = getMarkerOnLine(
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

/** Clears the canvas and draws each given animation, clipped as the drawn layer clips its element */
export const renderAnimatedScene = (props: AnimatedSceneProps): void => {
  const { canvas, scale, animations, elementsMap, renderStateOf } = props;
  // the drawn layer's scroll, on whole device pixels, so the two line up
  const appState = snapScrollToDevicePixels(props.appState, scale);
  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth: appState.width,
    normalizedHeight: appState.height,
  });
  const zoom = appState.zoom.value;
  context.scale(zoom, zoom);
  const clipElement = createElementClipper({
    context,
    appState,
    elementsMap: props.renderableElementsMap,
    allElementsMap: elementsMap,
    renderConfig: props.renderConfig,
  });
  for (const animation of animations) {
    const { element } = animation;
    const state = renderStateOf(element);
    if (!(state.opacity > 0)) {
      continue;
    }
    context.save();
    // restored even when drawing throws, so its clip does not outlive the frame
    try {
      clipElement(element, state);
      if (animation.effect === "shimmer") {
        drawShimmer(
          context,
          element,
          animation.progress,
          props,
          appState,
          state,
        );
        continue;
      }
      const color = applyDarkModeFilter(
        animationLightColorOf(element, props.colorOf),
        appState.theme === THEME.DARK,
      );
      context.translate(
        appState.scrollX + state.offset.x,
        appState.scrollY + state.offset.y,
      );
      context.globalAlpha = state.opacity;
      context.fillStyle = color;
      context.strokeStyle = color;
      context.shadowColor = color;
      // the blur is in device pixels, so it follows zoom and pixel ratio itself
      context.shadowBlur = Math.max(12, element.strokeWidth * 5) * zoom * scale;
      drawMarkerOrPulse(context, animation, elementsMap);
    } finally {
      context.restore();
    }
  }
};
