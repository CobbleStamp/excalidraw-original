/**
 * excalidraw-web: element animation. Which elements may animate and with
 * which effects, how their stored setting is read back, how long one run
 * takes, and where a run has reached: a looping element runs, waits, and
 * runs again on a clock all elements share; a triggered run goes once from
 * the moment it was asked for. A line's dot or chevron travels along the
 * line; any other element's travelling light goes around its outline (the
 * box around a text, image or formula, the stroke of a pencil drawing); a
 * fade takes any element's opacity away and back.
 */
import {
  ANIMATION_DURATION_TIMES_SPEED,
  ANIMATION_MAX_DURATION_MS,
  ANIMATION_MAX_SPEED,
  ANIMATION_MIN_DURATION_MS,
  ANIMATION_MIN_SPEED,
  ANIMATION_PAUSE_MS,
  DEFAULT_ANIMATION_SPEED,
  FADE_DURATION_TIMES_SPEED,
  FADE_MAX_DURATION_MS,
  FADE_MIN_DURATION_MS,
} from "@excalidraw/common";

import {
  clamp,
  pointDistance,
  pointFrom,
  pointRotateRads,
} from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { getDiamondPoints, getElementAbsoluteCoords } from "./bounds";
import { LinearElementEditor } from "./linearElementEditor";
import { getPolygonCornerArcs, getPolygonPoints } from "./polygon";
import { getStickyNoteCornerRadius } from "./stickyNote";
import { getCornerRadius, getPolygonCornerRadius } from "./utils";

import type {
  AnimationEffect,
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "./types";

/** Where a travelling marker is drawn, and the way it faces */
export type AnimationMarker = {
  point: GlobalPoint;
  /** the direction of travel, in radians from the positive x axis */
  heading: number;
};

/**
 * The path an element's travelling light and pulse follow, in scene
 * coordinates: closed around a shape or a box, open along a pencil stroke
 */
export type AnimationPath = {
  points: readonly GlobalPoint[];
  closed: boolean;
  /** the box around the points: min x, min y, max x, max y */
  bounds: readonly [number, number, number, number];
  /** the length of each stretch, in order, the closing one last when it is closed */
  lengths: readonly number[];
  /** the length of the whole path, in drawing units */
  length: number;
};

/** Every effect an element may animate with, in the order the panel offers them */
export const ANIMATION_EFFECTS = [
  "dot",
  "chevron",
  "travel",
  "pulse",
  "shimmer",
  "fade",
] as const;

const LINE_EFFECTS: readonly AnimationEffect[] = ANIMATION_EFFECTS.filter(
  (effect) => effect === "dot" || effect === "chevron" || effect === "fade",
);
const SHAPE_EFFECTS: readonly AnimationEffect[] = ANIMATION_EFFECTS.filter(
  (effect) => effect !== "dot" && effect !== "chevron",
);

/** Whether an element is a line or an arrow that may animate: one not closed into a polygon */
const isAnimatableLine = (
  element: ExcalidrawElement,
): element is ExcalidrawLinearElement =>
  element.type === "arrow" ||
  (element.type === "line" && !(element as { polygon?: boolean }).polygon);

/** Whether an element can be animated: a line or arrow, a shape, a sticky note, a text, an image or a pencil drawing */
export const canAnimate = (element: ExcalidrawElement): boolean => {
  switch (element.type) {
    case "line":
    case "arrow":
      return isAnimatableLine(element);
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "polygon":
    case "stickynote":
    case "text":
    case "image":
    case "freedraw":
      return true;
    default:
      return false;
  }
};

/** The effects an element may animate with: a dot, a chevron or a fade on a line or arrow, a travelling light, a pulse, a shimmer or a fade on the rest */
export const animationEffectsOf = (
  element: ExcalidrawElement,
): readonly AnimationEffect[] =>
  !canAnimate(element)
    ? []
    : isAnimatableLine(element)
    ? LINE_EFFECTS
    : SHAPE_EFFECTS;

/** The effect an element animates with when none is set: a chevron on an arrow, a dot on a line, a travelling light otherwise */
export const defaultAnimationEffectOf = (
  element: ExcalidrawElement,
): AnimationEffect =>
  element.type === "arrow"
    ? "chevron"
    : element.type === "line"
    ? "dot"
    : "travel";

/** The effect a run plays: the one asked for, else the element's own, as long as the element offers it, else its default */
export const animationEffectOf = (
  element: ExcalidrawElement,
  asked?: AnimationEffect,
): AnimationEffect => {
  const offered = animationEffectsOf(element);
  if (asked !== undefined && offered.includes(asked)) {
    return asked;
  }
  return element.animationEffect !== undefined &&
    offered.includes(element.animationEffect)
    ? element.animationEffect
    : defaultAnimationEffectOf(element);
};

/** Whether an element animates at all: once when triggered, or in a loop */
export const isAnimated = (element: ExcalidrawElement): boolean =>
  canAnimate(element) &&
  (element.animation === "once" || element.animation === "loop");

/** Whether an element's animation runs over and over on the board */
export const isLooping = (element: ExcalidrawElement): boolean =>
  canAnimate(element) && element.animation === "loop";

/** Whether an element plays a run when a pointer enters it */
export const isAnimatedOnce = (element: ExcalidrawElement): boolean =>
  canAnimate(element) && element.animation === "once";

/** Whether a pointer enters an element by coming near its stroke, as on a line or arrow, rather than anywhere in its box */
export const isEnteredByStroke = (element: ExcalidrawElement): boolean =>
  isAnimatableLine(element);

/** Turns any stored speed into one within the allowed range */
export const normalizeAnimationSpeed = (speed: unknown): number =>
  typeof speed === "number" && Number.isFinite(speed)
    ? clamp(Math.round(speed), ANIMATION_MIN_SPEED, ANIMATION_MAX_SPEED)
    : DEFAULT_ANIMATION_SPEED;

/** Reads an element's stored animation back: a setting that is not ours or not offered is dropped, a speed brought into range */
export const restoreAnimation = <T extends ExcalidrawElement>(
  element: T,
): T => {
  if (
    element.animation === undefined &&
    element.animationSpeed === undefined &&
    element.animationEffect === undefined
  ) {
    return element;
  }
  const { animation, animationSpeed, animationEffect, ...rest } = element;
  if (!canAnimate(element)) {
    return rest as T;
  }
  return {
    ...rest,
    ...(animation === "once" || animation === "loop" ? { animation } : {}),
    ...(animationSpeed !== undefined
      ? { animationSpeed: normalizeAnimationSpeed(animationSpeed) }
      : {}),
    ...(animationEffect !== undefined &&
    animationEffectsOf(element).includes(animationEffect)
      ? { animationEffect }
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

const ARC_STEPS = 8;
const ELLIPSE_STEPS = 64;

/** A quarter of a circle, from `fromAngle` a quarter turn on, clockwise on the screen */
const quarterArc = (
  cx: number,
  cy: number,
  radius: number,
  fromAngle: number,
): [number, number][] =>
  Array.from({ length: ARC_STEPS }, (_, i) => {
    const angle = fromAngle + ((i + 1) / ARC_STEPS) * (Math.PI / 2);
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

/** A box's outline with rounded corners, clockwise from its top middle, relative to its top-left */
const roundedBoxOutline = (
  width: number,
  height: number,
  radius: number,
): [number, number][] => {
  const r = Math.min(radius, width / 2, height / 2);
  return [
    [width / 2, 0],
    [width - r, 0],
    ...quarterArc(width - r, r, r, -Math.PI / 2),
    [width, height - r],
    ...quarterArc(width - r, height - r, r, 0),
    [r, height],
    ...quarterArc(r, height - r, r, Math.PI / 2),
    [0, r],
    ...quarterArc(r, r, r, Math.PI),
  ];
};

/** A rounded corner as the editor draws it: a curve from `start` to `end`, both its handles at `corner` */
const cornerCurve = ([start, corner, end]: readonly (readonly [
  number,
  number,
])[]): [number, number][] =>
  Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const t = i / ARC_STEPS;
    // a cubic whose two middle handles are the corner
    const ends = [(1 - t) ** 3, t ** 3];
    const middle = 1 - ends[0] - ends[1];
    return [
      ends[0] * start[0] + middle * corner[0] + ends[1] * end[0],
      ends[0] * start[1] + middle * corner[1] + ends[1] * end[1],
    ];
  });

/** A diamond's corners as the editor rounds them: each `[start, corner, end]`, clockwise from its top */
const diamondCornerArcs = (
  element: ExcalidrawElement,
): [number, number][][] => {
  const [tx, ty, rx, ry, bx, by, lx, ly] = getDiamondPoints(element);
  const across = getCornerRadius(Math.abs(tx - lx), element);
  const down = getCornerRadius(Math.abs(ry - ty), element);
  return [
    [
      [tx - across, ty + down],
      [tx, ty],
      [tx + across, ty + down],
    ],
    [
      [rx - across, ry - down],
      [rx, ry],
      [rx - across, ry + down],
    ],
    [
      [bx + across, by - down],
      [bx, by],
      [bx - across, by - down],
    ],
    [
      [lx + across, ly + down],
      [lx, ly],
      [lx + across, ly - down],
    ],
  ];
};

/** A closed outline turned clockwise on the screen and started at its top: the top corner, or the middle of a flat top edge */
const fromTopClockwise = (points: [number, number][]): [number, number][] => {
  const area = points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0);
  const clockwise = area >= 0 ? points : [...points].reverse();
  const top = clockwise.reduce((min, [, y]) => Math.min(min, y), Infinity);
  const first = clockwise.findIndex(([, y]) => Math.abs(y - top) < 1e-6);
  const next = (first + 1) % clockwise.length;
  const startsFlat = Math.abs(clockwise[next][1] - top) < 1e-6;
  const rotated = [...clockwise.slice(first), ...clockwise.slice(0, first)];
  if (!startsFlat) {
    return rotated;
  }
  const [[ax, ay], [bx]] = rotated;
  return [[(ax + bx) / 2, ay], ...rotated.slice(1), rotated[0]];
};

/** An element's outline before it is turned, relative to its top-left, and whether it closes */
const localOutline = (
  element: ExcalidrawElement,
): { points: [number, number][]; closed: boolean } => {
  switch (element.type) {
    case "rectangle":
      return {
        points: roundedBoxOutline(
          element.width,
          element.height,
          element.roundness
            ? getCornerRadius(Math.min(element.width, element.height), element)
            : 0,
        ),
        closed: true,
      };
    case "stickynote":
      return {
        points: roundedBoxOutline(
          element.width,
          element.height,
          getStickyNoteCornerRadius(element),
        ),
        closed: true,
      };
    case "diamond": {
      if (element.roundness) {
        return {
          points: fromTopClockwise(
            diamondCornerArcs(element).flatMap(cornerCurve),
          ),
          closed: true,
        };
      }
      const [tx, ty, rx, ry, bx, by, lx, ly] = getDiamondPoints(element);
      return {
        points: [
          [tx, ty],
          [rx, ry],
          [bx, by],
          [lx, ly],
        ],
        closed: true,
      };
    }
    case "ellipse":
      return {
        points: Array.from({ length: ELLIPSE_STEPS }, (_, i) => {
          const angle = -Math.PI / 2 + (i / ELLIPSE_STEPS) * Math.PI * 2;
          return [
            element.width / 2 + (element.width / 2) * Math.cos(angle),
            element.height / 2 + (element.height / 2) * Math.sin(angle),
          ];
        }),
        closed: true,
      };
    case "polygon": {
      const corners = getPolygonPoints(element);
      return {
        // rounded, each corner the curve the editor draws through it
        points: fromTopClockwise(
          element.roundness
            ? getPolygonCornerArcs(
                corners,
                getPolygonCornerRadius(element, corners),
              ).flatMap(cornerCurve)
            : corners.map(([x, y]) => [x, y]),
        ),
        closed: true,
      };
    }
    case "freedraw":
      return {
        points: element.points.map(([x, y]) => [x, y]),
        closed: false,
      };
    default:
      // a text, an image or a formula: the box around it
      return {
        points: roundedBoxOutline(element.width, element.height, 0),
        closed: true,
      };
  }
};

const pathCache = new WeakMap<
  ExcalidrawElement,
  { version: number; path: AnimationPath }
>();

/** The path an element's travelling light and pulse follow, turned as the element is, in scene coordinates */
export const getAnimationPath = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): AnimationPath => {
  const cached = pathCache.get(element);
  if (cached?.version === element.version) {
    return cached.path;
  }
  const [, , , , cx, cy] = getElementAbsoluteCoords(element, elementsMap);
  const center = pointFrom<GlobalPoint>(cx, cy);
  const { points: local, closed } = localOutline(element);
  const points = local.map(([x, y]) =>
    pointRotateRads(
      pointFrom<GlobalPoint>(element.x + x, element.y + y),
      center,
      element.angle,
    ),
  );
  const lengths = stretchesOf(points, closed).map(([a, b]) =>
    pointDistance(a, b),
  );
  const path: AnimationPath = {
    points,
    closed,
    bounds: points.reduce<[number, number, number, number]>(
      ([minX, minY, maxX, maxY], [x, y]) => [
        Math.min(minX, x),
        Math.min(minY, y),
        Math.max(maxX, x),
        Math.max(maxY, y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    ),
    lengths,
    length: lengths.reduce((sum, length) => sum + length, 0),
  };
  pathCache.set(element, { version: element.version, path });
  return path;
};

/** Each stretch of a path, its start and end, closing it back to its start when it is closed */
const stretchesOf = (
  points: readonly GlobalPoint[],
  closed: boolean,
): [GlobalPoint, GlobalPoint][] => {
  const ends = closed && points.length > 0 ? [...points, points[0]] : points;
  return ends.slice(1).map((end, i) => [ends[i], end]);
};

/** The length a travelling marker covers on an element, in drawing units */
const travelLength = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): number =>
  isAnimatableLine(element)
    ? LinearElementEditor.getPathLength(element, elementsMap)
    : getAnimationPath(element, elementsMap).length;

/** How long one run of an element's animation with an effect takes, in milliseconds; 0 for a travelling marker on something of no length */
export const getAnimationRunMs = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  effect: AnimationEffect,
): number => {
  const speed = normalizeAnimationSpeed(
    element.animationSpeed ?? DEFAULT_ANIMATION_SPEED,
  );
  if (effect === "pulse" || effect === "shimmer") {
    return clamp(
      ANIMATION_DURATION_TIMES_SPEED / speed,
      ANIMATION_MIN_DURATION_MS,
      ANIMATION_MAX_DURATION_MS,
    );
  }
  if (effect === "fade") {
    return clamp(
      FADE_DURATION_TIMES_SPEED / speed,
      FADE_MIN_DURATION_MS,
      FADE_MAX_DURATION_MS,
    );
  }
  const length = travelLength(element, elementsMap);
  return length > 0 ? (length / speed) * 1000 : 0;
};

/**
 * How far along a looping element's run it is, from 0 to 1, at `timeMs` on
 * a clock all elements share; null while it waits between runs
 */
export const getLoopProgress = (
  runMs: number,
  timeMs: number,
): number | null => {
  if (!(runMs > 0)) {
    return null;
  }
  const phase = timeMs % (runMs + ANIMATION_PAUSE_MS);
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
export const getMarkerOnLine = (
  element: ExcalidrawLinearElement,
  elementsMap: ElementsMap,
  progress: number,
): AnimationMarker | null => {
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

/** Where the travelling light is on an element's path `progress` of the way round, in scene coordinates */
export const getTravellingPoint = (
  path: AnimationPath,
  progress: number,
): GlobalPoint | null => {
  if (!(path.length > 0)) {
    return null;
  }
  const stretches = stretchesOf(path.points, path.closed);
  let left = clamp(progress, 0, 1) * path.length;
  for (const [i, [a, b]] of stretches.entries()) {
    const length = path.lengths[i];
    if (left <= length && length > 0) {
      const share = left / length;
      return pointFrom<GlobalPoint>(
        a[0] + (b[0] - a[0]) * share,
        a[1] + (b[1] - a[1]) * share,
      );
    }
    left -= length;
  }
  return stretches[stretches.length - 1][1];
};

/**
 * An element's opacity `progress` of the way through a fade: from its own
 * opacity to nothing and back, or, for an element at 0, from nothing to
 * full and back
 */
export const getFadeOpacity = (opacity: number, progress: number): number => {
  const away = Math.sin(Math.PI * clamp(progress, 0, 1)) ** 2;
  return opacity > 0 ? opacity * (1 - away) : 100 * away;
};
