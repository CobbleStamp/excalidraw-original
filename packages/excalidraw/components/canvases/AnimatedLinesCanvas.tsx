/**
 * excalidraw-web: the board's layer for animated lines. It sits over the
 * drawn elements and, while some visible line loops or some line plays a
 * triggered run, and the system does not ask for reduced motion, redraws
 * their travelling markers every frame; with nothing to animate it is not
 * there at all.
 */
import { useEffect, useReducer, useRef, useState } from "react";

import {
  canAnimateLine,
  getLineRunMs,
  getLoopProgress,
  getRunProgress,
  isLoopingLine,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { renderAnimatedLinesScene } from "../../renderer/animatedLinesScene";

import type {
  AnimatedLinesSceneProps,
  LineMarkerToDraw,
} from "../../renderer/animatedLinesScene";
import type { LineAnimationRuns } from "../../scene/lineAnimationRuns";

type AnimatedLinesCanvasProps = {
  appState: AnimatedLinesSceneProps["appState"];
  visibleElements: readonly NonDeletedExcalidrawElement[];
  elementsMap: ElementsMap;
  runs: LineAnimationRuns;
  renderStateOf: AnimatedLinesSceneProps["renderStateOf"];
  /** the window the editor is in, whose frames and motion setting count */
  ownerWindow: Window;
  scale: number;
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

/** The markers to draw at `timeMs`: each looping line's, and each triggered run's, ending runs that are over */
const markersAt = (
  loops: readonly ExcalidrawLinearElement[],
  runs: LineAnimationRuns,
  elementsMap: ElementsMap,
  timeMs: number,
): LineMarkerToDraw[] => {
  const markers: LineMarkerToDraw[] = [];
  for (const line of loops) {
    const progress = getLoopProgress(getLineRunMs(line, elementsMap), timeMs);
    if (progress !== null) {
      markers.push({ line, progress });
    }
  }
  for (const [id, startedMs] of [...runs.current()]) {
    const element = elementsMap.get(id);
    const line =
      element && !element.isDeleted && canAnimateLine(element) ? element : null;
    const progress = line
      ? getRunProgress(getLineRunMs(line, elementsMap), timeMs - startedMs)
      : null;
    if (line === null || progress === null) {
      runs.finish(id);
    } else if (!isLoopingLine(line)) {
      // a looping line's own marker already runs
      markers.push({ line, progress });
    }
  }
  return markers;
};

/** Draws the travelling markers of looping lines and triggered runs, frame by frame */
const AnimatedLinesCanvas = (props: AnimatedLinesCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, runsChanged] = useReducer((count: number) => count + 1, 0);
  const { runs, ownerWindow } = props;
  useEffect(() => runs.subscribe(runsChanged), [runs]);
  // lines change in place as they are edited, so they are found every render
  const loops = props.visibleElements.filter(
    isLoopingLine,
  ) as ExcalidrawLinearElement[];
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
      const scene = latest.current;
      const markers = markersAt(
        scene.loops,
        scene.runs,
        scene.elementsMap,
        timeMs,
      );
      if (canvasRef.current) {
        renderAnimatedLinesScene({
          ...scene,
          canvas: canvasRef.current,
          markers,
        });
      }
      frame = ownerWindow.requestAnimationFrame(draw);
    });
    return () => ownerWindow.cancelAnimationFrame(frame);
  }, [running, ownerWindow]);

  if (!running) {
    return null;
  }
  return (
    <canvas
      className="excalidraw__canvas animated-lines"
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

export default AnimatedLinesCanvas;
