/**
 * excalidraw-web: line animation. Which lines and arrows may carry a
 * travelling marker, how their stored setting is read back, and where the
 * marker is on a line: a looping line's marker runs the line at its speed,
 * waits, and runs again on a clock all lines share; a triggered run goes
 * once from the moment it was asked for.
 */
import {
  DEFAULT_LINE_ANIMATION_SPEED,
  LINE_ANIMATION_MAX_SPEED,
  LINE_ANIMATION_MIN_SPEED,
  LINE_ANIMATION_PAUSE_MS,
} from "@excalidraw/common";

import { clamp } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { LinearElementEditor } from "./linearElementEditor";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "./types";

/** Where an animated line's marker is drawn, and the way it faces */
export type LineMarker = {
  point: GlobalPoint;
  /** the direction of travel, in radians from the positive x axis */
  heading: number;
};

/** Whether an element can be animated: an arrow, or a line that is not closed into a polygon */
export const canAnimateLine = (
  element: ExcalidrawElement,
): element is ExcalidrawLinearElement =>
  element.type === "arrow" ||
  (element.type === "line" && !(element as { polygon?: boolean }).polygon);

/** Whether a line animates at all: once when triggered, or in a loop */
export const isAnimatedLine = (
  element: ExcalidrawElement,
): element is ExcalidrawLinearElement =>
  canAnimateLine(element) &&
  (element.animation === "once" || element.animation === "loop");

/** Whether a line's marker runs over and over on the board */
export const isLoopingLine = (
  element: ExcalidrawElement,
): element is ExcalidrawLinearElement =>
  canAnimateLine(element) && element.animation === "loop";

/** Whether a line plays a run when a pointer enters it */
export const isOnceLine = (
  element: ExcalidrawElement,
): element is ExcalidrawLinearElement =>
  canAnimateLine(element) && element.animation === "once";

/** Turns any stored speed into one within the allowed range */
export const normalizeLineAnimationSpeed = (speed: unknown): number =>
  typeof speed === "number" && Number.isFinite(speed)
    ? clamp(
        Math.round(speed),
        LINE_ANIMATION_MIN_SPEED,
        LINE_ANIMATION_MAX_SPEED,
      )
    : DEFAULT_LINE_ANIMATION_SPEED;

/** Reads a line's stored animation back: a setting that is not ours is dropped, a speed brought into range */
export const restoreLineAnimation = <T extends ExcalidrawLinearElement>(
  element: T,
): T => {
  const { animation, animationSpeed, ...rest } = element;
  return {
    ...rest,
    ...(animation === "once" || animation === "loop" ? { animation } : {}),
    ...(animationSpeed !== undefined
      ? { animationSpeed: normalizeLineAnimationSpeed(animationSpeed) }
      : {}),
  } as T;
};

/** Whether the marker runs from the line's end to its start: an arrow with a head at its start only */
export const lineMarkerRunsBackward = (
  element: ExcalidrawLinearElement,
): boolean =>
  element.type === "arrow" &&
  element.startArrowhead !== null &&
  element.endArrowhead === null;

/** How long one run of a line's marker takes, in milliseconds; 0 for a line of no length */
export const getLineRunMs = (
  element: ExcalidrawLinearElement,
  elementsMap: ElementsMap,
): number => {
  const length = LinearElementEditor.getPathLength(element, elementsMap);
  const speed = normalizeLineAnimationSpeed(
    element.animationSpeed ?? DEFAULT_LINE_ANIMATION_SPEED,
  );
  return length > 0 ? (length / speed) * 1000 : 0;
};

/**
 * How far along a looping line's run the marker is, from 0 to 1, at
 * `timeMs` on a clock all lines share; null while it waits between runs
 */
export const getLoopProgress = (
  runMs: number,
  timeMs: number,
): number | null => {
  if (!(runMs > 0)) {
    return null;
  }
  const phase = timeMs % (runMs + LINE_ANIMATION_PAUSE_MS);
  return phase < runMs ? phase / runMs : null;
};

/**
 * How far a triggered run has gone, from 0 to 1, `elapsedMs` after it began;
 * null once it is over. A frame's time can fall just before the run was
 * asked for, which counts as its start.
 */
export const getRunProgress = (
  runMs: number,
  elapsedMs: number,
): number | null =>
  runMs > 0 && elapsedMs < runMs ? Math.max(0, elapsedMs) / runMs : null;

/** Where the marker is on a line `progress` of the way through its run, in scene coordinates */
export const getLineMarker = (
  element: ExcalidrawLinearElement,
  elementsMap: ElementsMap,
  progress: number,
): LineMarker | null => {
  const length = LinearElementEditor.getPathLength(element, elementsMap);
  if (!(length > 0)) {
    return null;
  }
  const backward = lineMarkerRunsBackward(element);
  const at = backward ? 1 - progress : progress;
  // the heading comes from a short stretch of path either side of the marker
  const step = Math.min(1 / length, 0.01);
  const before = LinearElementEditor.getPointAtPathParameter(
    element,
    Math.max(0, at - step),
    elementsMap,
  );
  const point = LinearElementEditor.getPointAtPathParameter(
    element,
    at,
    elementsMap,
  );
  const after = LinearElementEditor.getPointAtPathParameter(
    element,
    Math.min(1, at + step),
    elementsMap,
  );
  if (!before || !point || !after) {
    return null;
  }
  const forward = Math.atan2(after[1] - before[1], after[0] - before[0]);
  return { point, heading: backward ? forward + Math.PI : forward };
};
