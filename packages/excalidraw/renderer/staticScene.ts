import {
  applyDarkModeFilter,
  COLOR_WHITE,
  FRAME_STYLE,
  THEME,
  throttleRAF,
} from "@excalidraw/common";
import { isElementLink } from "@excalidraw/element";
import { createPlaceholderEmbeddableLabel } from "@excalidraw/element";
import { getBoundTextElement } from "@excalidraw/element";
import {
  isEmbeddableElement,
  isIframeLikeElement,
  isTextElement,
} from "@excalidraw/element";
import {
  elementOverlapsWithFrame,
  getTargetFrame,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import {
  getRenderElementWithPositionOverride,
  resolveElementRenderState,
  renderElement,
} from "@excalidraw/element";

import { getElementAbsoluteCoords } from "@excalidraw/element";
import { getKeptSizeHolders, getOutlinePoints } from "@excalidraw/element";

import type { ElementRenderState } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import {
  EXTERNAL_LINK_IMG,
  ELEMENT_LINK_IMG,
  getLinkHandleFromCoords,
} from "../components/hyperlink/helpers";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
  StaticSceneRenderConfig,
} from "../scene/types";
import type { StaticCanvasAppState, Zoom } from "../types";

const GridLineColor = {
  [THEME.LIGHT]: {
    bold: "#dddddd",
    regular: "#e5e5e5",
  },
  [THEME.DARK]: {
    bold: applyDarkModeFilter("#dddddd"),
    regular: applyDarkModeFilter("#e5e5e5"),
  },
} as const;

const strokeGrid = (
  context: CanvasRenderingContext2D,
  /** grid cell pixel size */
  gridSize: number,
  /** setting to 1 will disble bold lines */
  gridStep: number,
  scrollX: number,
  scrollY: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
  width: number,
  height: number,
  scale: number,
) => {
  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;

  const actualGridSize = gridSize * zoom.value;

  const spaceWidth = 1 / zoom.value;

  // scene units → device pixels
  const devicePixels = zoom.value * scale;

  // A line at least a device pixel wide is drawn a whole number of device
  // pixels wide and centered to cover them exactly — on the half pixel when
  // the count is odd. Straddling a pixel boundary renders it as two lighter
  // pixels, which is how the grid looked at every zoom but 100%. Thinner
  // lines (zoomed far out) keep their sub-pixel width: their lightness is
  // the point.
  const snap = (position: number, maxWidthInCssPixels: number) => {
    // a line is `min(1 / zoom, max)` scene units wide; computed straight in
    // device pixels, so `(1 / zoom) × zoom` never lands just under 1
    const widthInDevicePixels = Math.min(
      scale,
      maxWidthInCssPixels * devicePixels,
    );
    if (widthInDevicePixels < 1) {
      return { position, lineWidth: widthInDevicePixels / devicePixels };
    }
    const wholeWidth = Math.round(widthInDevicePixels);
    const center = wholeWidth % 2 ? 0.5 : 0;
    return {
      position:
        (Math.round(position * devicePixels - center) + center) / devicePixels,
      lineWidth: wholeWidth / devicePixels,
    };
  };

  context.save();

  // vertical lines
  for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(x - scrollX) % (gridStep * gridSize) === 0;
    // don't render regular lines when zoomed out and they're barely visible
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(x, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(position, offsetY - gridSize);
    context.lineTo(position, Math.ceil(offsetY + height + gridSize * 2));
    context.stroke();
  }

  for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(y - scrollY) % (gridStep * gridSize) === 0;
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const { position, lineWidth } = snap(y, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(offsetX - gridSize, position);
    context.lineTo(Math.ceil(offsetX + width + gridSize * 2), position);
    context.stroke();
  }
  context.restore();
};

export const frameClip = (
  frame: ExcalidrawFrameLikeElement,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState,
) => {
  context.translate(frame.x + appState.scrollX, frame.y + appState.scrollY);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      0,
      0,
      frame.width,
      frame.height,
      FRAME_STYLE.radius / appState.zoom.value,
    );
  } else {
    context.rect(0, 0, frame.width, frame.height);
  }
  context.clip();
  context.translate(
    -(frame.x + appState.scrollX),
    -(frame.y + appState.scrollY),
  );
};

/** Clips the context to an element's outline, sharp-cornered. */
const outlineClip = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
) => {
  const outline = getOutlinePoints(element, elementsMap);
  context.beginPath();
  outline.forEach(([x, y], index) => {
    if (index === 0) {
      context.moveTo(x + appState.scrollX, y + appState.scrollY);
    } else {
      context.lineTo(x + appState.scrollX, y + appState.scrollY);
    }
  });
  context.closePath();
  context.clip();
};

/**
 * Clips the context as the scene clips an element: to the frame it is in,
 * when frames clip, and past the outline of each container keeping its size
 * that holds it. Made once a frame, as it keeps what it has worked out.
 */
export const createElementClipper = ({
  context,
  appState,
  elementsMap,
  allElementsMap,
  renderConfig,
}: {
  context: CanvasRenderingContext2D;
  appState: StaticCanvasAppState;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  renderConfig: StaticCanvasRenderConfig;
}) => {
  const inFrameGroupsMap = new Map<string, boolean>();
  // what a container that keeps its size holds is hidden past its outline
  const keptSizeHolders = getKeptSizeHolders(allElementsMap);

  const clipElementToFrame = (
    element: NonDeletedExcalidrawElement,
    renderState: ElementRenderState,
  ) => {
    if (
      !(element.frameId || appState.frameToHighlight?.id) ||
      !appState.frameRendering.enabled ||
      !appState.frameRendering.clip
    ) {
      return;
    }
    const targetFrame = getTargetFrame(element, elementsMap, appState);
    if (!targetFrame) {
      return;
    }
    const frameState = resolveElementRenderState(
      targetFrame,
      elementsMap,
      renderConfig,
      allElementsMap,
    );
    const frame = getRenderElementWithPositionOverride(
      targetFrame,
      frameState.offset,
    );
    const isTranslated = (state: ElementRenderState) =>
      state.offset.x !== 0 || state.offset.y !== 0;
    if (
      (element.frameId === frame.id &&
        (isTranslated(renderState) || isTranslated(frameState))) ||
      shouldApplyFrameClip(
        getRenderElementWithPositionOverride(element, renderState.offset),
        frame,
        appState,
        elementsMap,
        inFrameGroupsMap,
      )
    ) {
      frameClip(frame, context, renderConfig, appState);
    }
  };

  return (
    element: NonDeletedExcalidrawElement,
    renderState: ElementRenderState,
  ) => {
    clipElementToFrame(element, renderState);
    for (const holder of keptSizeHolders.get(element.id) ?? []) {
      outlineClip(holder, context, appState, allElementsMap);
    }
  };
};

type LinkIconCanvas = HTMLCanvasElement & { zoom: number };

/** each link icon drawn at the current zoom, by the editor's kind of link or the host's image */
const linkIconCanvasCache: Map<
  "regularLink" | "elementLink" | HTMLImageElement,
  LinkIconCanvas
> = new Map();

const renderLinkIcon = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
  renderState: ElementRenderState,
  renderConfig: StaticCanvasRenderConfig,
) => {
  if (element.link && !appState.selectedElementIds[element.id]) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    const [x, y, width, height] = getLinkHandleFromCoords(
      [
        x1 + renderState.offset.x,
        y1 + renderState.offset.y,
        x2 + renderState.offset.x,
        y2 + renderState.offset.y,
      ],
      element.angle,
      appState,
    );
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    context.save();
    context.translate(appState.scrollX + centerX, appState.scrollY + centerY);
    context.rotate(element.angle);

    const canvasKey =
      renderConfig.linkIcon?.(element) ??
      (isElementLink(element.link) ? "elementLink" : "regularLink");

    let linkCanvas = linkIconCanvasCache.get(canvasKey);

    if (!linkCanvas || linkCanvas.zoom !== appState.zoom.value) {
      linkCanvas = Object.assign(document.createElement("canvas"), {
        zoom: appState.zoom.value,
      });
      linkCanvas.width = width * window.devicePixelRatio * appState.zoom.value;
      linkCanvas.height =
        height * window.devicePixelRatio * appState.zoom.value;
      linkIconCanvasCache.set(canvasKey, linkCanvas);

      const linkCanvasCacheContext = linkCanvas.getContext("2d")!;
      linkCanvasCacheContext.scale(
        window.devicePixelRatio * appState.zoom.value,
        window.devicePixelRatio * appState.zoom.value,
      );

      // Seed a sane default so a corrupted color (silently rejected by the
      // canvas) falls back to white instead of a stale fillStyle.
      linkCanvasCacheContext.fillStyle = COLOR_WHITE;
      linkCanvasCacheContext.fillStyle =
        appState.viewBackgroundColor || COLOR_WHITE;

      linkCanvasCacheContext.fillRect(0, 0, width, height);

      if (canvasKey === "elementLink") {
        linkCanvasCacheContext.drawImage(ELEMENT_LINK_IMG, 0, 0, width, height);
      } else if (canvasKey === "regularLink") {
        linkCanvasCacheContext.drawImage(
          EXTERNAL_LINK_IMG,
          0,
          0,
          width,
          height,
        );
      } else {
        linkCanvasCacheContext.drawImage(canvasKey, 0, 0, width, height);
      }

      linkCanvasCacheContext.restore();
    }
    context.globalAlpha = renderState.opacity;
    context.drawImage(linkCanvas, x - centerX, y - centerY, width, height);
    context.restore();
  }
};
const _renderStaticScene = ({
  canvas,
  rc,
  elementsMap,
  allElementsMap,
  visibleElements,
  scale,
  appState: unsnappedAppState,
  renderConfig,
}: StaticSceneRenderConfig) => {
  if (canvas === null) {
    return;
  }

  const { renderGrid = true, isExporting } = renderConfig;
  // export draws vectors, not cached bitmaps — nothing to keep on the grid
  const appState = isExporting
    ? unsnappedAppState
    : snapScrollToDevicePixels(unsnappedAppState, scale);

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );

  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
    theme: appState.theme,
    isExporting,
    viewBackgroundColor: appState.viewBackgroundColor,
  });

  // Apply zoom
  context.scale(appState.zoom.value, appState.zoom.value);

  // Grid
  if (renderGrid) {
    strokeGrid(
      context,
      appState.gridSize,
      appState.gridStep,
      appState.scrollX,
      appState.scrollY,
      appState.zoom,
      renderConfig.theme,
      normalizedWidth / appState.zoom.value,
      normalizedHeight / appState.zoom.value,
      scale,
    );
  }

  const groupsToBeAddedToFrame = new Set<string>();

  visibleElements.forEach((element) => {
    if (
      element.groupIds.length > 0 &&
      appState.frameToHighlight &&
      appState.selectedElementIds[element.id] &&
      (elementOverlapsWithFrame(
        element,
        appState.frameToHighlight,
        elementsMap,
      ) ||
        element.groupIds.find((groupId) => groupsToBeAddedToFrame.has(groupId)))
    ) {
      element.groupIds.forEach((groupId) =>
        groupsToBeAddedToFrame.add(groupId),
      );
    }
  });

  const getRenderState = (element: ExcalidrawElement) =>
    resolveElementRenderState(
      element,
      elementsMap,
      renderConfig,
      allElementsMap,
    );

  const clipElement = createElementClipper({
    context,
    appState,
    elementsMap,
    allElementsMap,
    renderConfig,
  });

  // Paint visible elements
  visibleElements
    .filter((el) => !isIframeLikeElement(el))
    .forEach((element) => {
      try {
        if (
          isTextElement(element) &&
          element.containerId &&
          elementsMap.has(element.containerId)
        ) {
          // will be rendered with the container
          return;
        }

        context.save();
        const boundTextElement = getBoundTextElement(element, elementsMap);

        const renderState = getRenderState(element);
        clipElement(element, renderState);
        renderElement(
          element,
          elementsMap,
          allElementsMap,
          rc,
          context,
          renderConfig,
          appState,
          renderState,
        );

        if (boundTextElement) {
          context.save();
          if (element.keepsSize) {
            // text past the outline of a container that keeps its size is hidden
            outlineClip(
              getRenderElementWithPositionOverride(element, renderState.offset),
              context,
              appState,
              elementsMap,
            );
          }
          renderElement(
            boundTextElement,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
          context.restore();
        }

        context.restore();

        if (!isExporting && renderConfig.renderLinks !== false) {
          renderLinkIcon(
            element,
            context,
            appState,
            elementsMap,
            renderState,
            renderConfig,
          );
        }
      } catch (error: any) {
        console.error(
          error,
          element.id,
          element.x,
          element.y,
          element.width,
          element.height,
        );
      }
    });

  // render embeddables on top
  visibleElements
    .filter((el) => isIframeLikeElement(el))
    .forEach((element) => {
      try {
        const renderState = getRenderState(element);
        context.save();
        clipElement(element, renderState);
        renderElement(
          element,
          elementsMap,
          allElementsMap,
          rc,
          context,
          renderConfig,
          appState,
          renderState,
        );

        if (
          isIframeLikeElement(element) &&
          (isExporting ||
            (isEmbeddableElement(element) &&
              renderConfig.embedsValidationStatus.get(element.id) !== true)) &&
          element.width &&
          element.height
        ) {
          const label = {
            ...createPlaceholderEmbeddableLabel(element),
            // Synthetic visual: resolve overrides and frame opacity through
            // its owner, without creating another animation target.
            id: element.id,
            frameId: element.frameId,
          };
          renderElement(
            label,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
        }
        if (!isExporting && renderConfig.renderLinks !== false) {
          renderLinkIcon(
            element,
            context,
            appState,
            elementsMap,
            renderState,
            renderConfig,
          );
        }
        context.restore();
      } catch (error: any) {
        console.error(error);
      }
    });

  // render pending nodes for flowcharts
  renderConfig.pendingFlowchartNodes?.forEach((element) => {
    try {
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } catch (error) {
      console.error(error);
    }
  });
};

/** throttled to animation framerate */
export const renderStaticSceneThrottled = throttleRAF(
  (config: StaticSceneRenderConfig) => {
    _renderStaticScene(config);
  },
);

/**
 * Static scene is the non-ui canvas where we render elements.
 */
export const renderStaticScene = (
  renderConfig: StaticSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderStaticSceneThrottled(renderConfig);
    return;
  }

  _renderStaticScene(renderConfig);
};
