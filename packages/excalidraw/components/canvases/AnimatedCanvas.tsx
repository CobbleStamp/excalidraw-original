/**
 * excalidraw-web: the board's layer for animated elements. It sits over the
 * drawn elements and, while some visible element loops or some element plays
 * a triggered run, and the system does not ask for reduced motion, redraws
 * their animations every frame; with nothing to animate it is not there at
 * all.
 */
import { useEffect, useReducer, useRef, useState } from "react";

import {
  animationEffectOf,
  getAnimationRunMs,
  getLoopProgress,
  getRunProgress,
  isLooping,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { renderAnimatedScene } from "../../renderer/animatedScene";

import type {
  AnimatedSceneProps,
  AnimationToDraw,
} from "../../renderer/animatedScene";
import type { AnimationRuns } from "../../scene/animationRuns";

type AnimatedCanvasProps = Omit<
  AnimatedSceneProps,
  "canvas" | "animations" | "shimmerCanvas"
> & {
  visibleElements: readonly NonDeletedExcalidrawElement[];
  runs: AnimationRuns;
  /** whether the host lets an element animate, beyond the editor's own rule */
  canAnimate: (element: ExcalidrawElement) => boolean;
  /** the window the editor is in, whose frames and motion setting count */
  ownerWindow: Window;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for reduced motion, following it as it changes */
const usePrefersReducedMotion = (ownerWindow: Window): boolean => {
  const [reduced, setReduced] = useState<boolean>(
    () => ownerWindow.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true,
  );
  useEffect(() => {
    const query = ownerWindow.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query?.addEventListener) {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [ownerWindow]);
  return reduced;
};

/** The animations to draw at `timeMs`: each looping element's, and each triggered run's, ending runs that are over */
const animationsAt = (
  loops: readonly NonDeletedExcalidrawElement[],
  runs: AnimationRuns,
  elementsMap: NonDeletedSceneElementsMap,
  canAnimate: (element: ExcalidrawElement) => boolean,
  timeMs: number,
): AnimationToDraw[] => {
  const animations: AnimationToDraw[] = [];
  for (const element of loops) {
    const effect = animationEffectOf(element);
    const progress = getLoopProgress(
      getAnimationRunMs(element, elementsMap, effect),
      timeMs,
    );
    if (progress !== null) {
      animations.push({ element, effect, progress });
    }
  }
  for (const [id, run] of [...runs.current()]) {
    const found = elementsMap.get(id);
    const element = found && canAnimate(found) ? found : null;
    const effect = element ? animationEffectOf(element, run.effect) : null;
    const progress =
      element && effect
        ? getRunProgress(
            getAnimationRunMs(element, elementsMap, effect),
            timeMs - run.startedMs,
          )
        : null;
    if (element === null || effect === null || progress === null) {
      runs.finish(id);
    } else if (!isLooping(element)) {
      // a looping element already runs its own
      animations.push({ element, effect, progress });
    }
  }
  return animations;
};

/** Draws the animations of looping elements and triggered runs, frame by frame */
const AnimatedCanvas = (props: AnimatedCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // this editor's own canvas for shimmers, its bitmap let go when nothing animates
  const shimmerCanvas = useRef<HTMLCanvasElement | null>(null);
  const [, runsChanged] = useReducer((count: number) => count + 1, 0);
  const { runs, ownerWindow } = props;
  useEffect(() => runs.subscribe(runsChanged), [runs]);
  // elements change in place as they are edited, so they are found every render
  const loops = props.visibleElements.filter(
    (element) => isLooping(element) && props.canAnimate(element),
  );
  const reducedMotion = usePrefersReducedMotion(ownerWindow);
  const running =
    (loops.length > 0 || runs.current().size > 0) && !reducedMotion;
  // each frame reads the latest scene, without restarting the loop
  const latest = useRef({ ...props, loops });
  latest.current = { ...props, loops };

  useEffect(() => {
    if (!running) {
      return;
    }
    let frame = ownerWindow.requestAnimationFrame(function draw(
      timeMs: number,
    ) {
      // the next frame is asked for first, so a frame that fails does not stop the loop
      frame = ownerWindow.requestAnimationFrame(draw);
      const scene = latest.current;
      const animations = animationsAt(
        scene.loops,
        scene.runs,
        scene.elementsMap,
        scene.canAnimate,
        timeMs,
      );
      if (canvasRef.current) {
        renderAnimatedScene({
          ...scene,
          canvas: canvasRef.current,
          animations,
          shimmerCanvas,
        });
      }
    });
    return () => {
      ownerWindow.cancelAnimationFrame(frame);
      if (shimmerCanvas.current) {
        shimmerCanvas.current.width = 0;
        shimmerCanvas.current.height = 0;
        shimmerCanvas.current = null;
      }
    };
  }, [running, ownerWindow]);

  if (!running) {
    return null;
  }
  return (
    <canvas
      className="excalidraw__canvas animated-elements"
      style={{
        width: props.appState.width,
        height: props.appState.height,
        pointerEvents: "none",
      }}
      width={props.appState.width * props.scale}
      height={props.appState.height * props.scale}
      ref={canvasRef}
    />
  );
};

export default AnimatedCanvas;
