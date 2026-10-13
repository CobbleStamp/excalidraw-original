import { isTransparent } from "@excalidraw/common";

import {
  shouldAllowVerticalAlign,
  suppportsHorizontalAlign,
  getColorTargetElement,
  hasBoundTextElement,
  isBoundToContainer,
  isElbowArrow,
  isImageElement,
  isLinearElement,
  isTextElement,
  hasStrokeColor,
  toolIsArrow,
  animationEffectsOf,
  canAnimate,
  isAnimated,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawElementType,
  NonDeletedElementsMap,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { alignActionsPredicate } from "../actions/actionAlign";
import {
  canChangeRoundness,
  canHaveArrowheads,
  getSelectedElements,
  hasBackground,
  hasFillStyle,
  hasFreedrawMode,
  hasRoughness,
  hasStrokeStyle,
  hasStrokeWidth,
} from "../scene";

import type { ElementOrToolType } from "../types";

import type { AppClassProperties, UIAppState } from "../types";

export const canChangeStrokeColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
  app: AppClassProperties,
) => {
  let commonSelectedType: ExcalidrawElementType | null =
    targetElements[0]?.type || null;

  for (const element of targetElements) {
    if (element.type !== commonSelectedType) {
      commonSelectedType = null;
      break;
    }
  }

  return (
    (hasStrokeColor(appState.activeTool.type) &&
      commonSelectedType !== "image" &&
      commonSelectedType !== "frame" &&
      commonSelectedType !== "magicframe") ||
    targetElements.some((element) => takesStrokeColor(element, app))
  );
};

/** excalidraw-web: whether an element takes a stroke colour: by its type, or as the host says. */
export const takesStrokeColor = (
  element: ExcalidrawElement,
  app: AppClassProperties,
): boolean =>
  hasStrokeColor(element.type) ||
  app.props.takesStrokeColor?.(element) === true;

/** excalidraw-web: whether an element may animate: by the editor's rule, and the host's when it has one. */
export const canAnimateFor = (
  element: ExcalidrawElement,
  app: AppClassProperties,
): boolean =>
  canAnimate(element) && (app.props.canAnimateElement?.(element) ?? true);

/** excalidraw-web: whether an element animates and may: set to animate, by the editor's rule and the host's. */
export const isAnimatedFor = (
  element: ExcalidrawElement,
  app: AppClassProperties,
): boolean => isAnimated(element) && canAnimateFor(element, app);

/**
 * excalidraw-web: the elements the animation controls act on: a shape's label
 * goes with its shape, so it is left out, unless it is the label being edited.
 */
export const animationTargetsOf = (
  targetElements: readonly ExcalidrawElement[],
  appState: Pick<UIAppState, "editingTextElement">,
): ExcalidrawElement[] =>
  appState.editingTextElement
    ? [...targetElements]
    : targetElements.filter((element) => !isBoundToContainer(element));

/** excalidraw-web: whether some elements are given and all offer the same effects. */
const offerSameEffects = (elements: readonly ExcalidrawElement[]): boolean => {
  if (elements.length === 0) {
    return false;
  }
  const first = animationEffectsOf(elements[0]);
  return elements.every((element) => {
    const offered = animationEffectsOf(element);
    return (
      offered.length === first.length &&
      offered.every((effect, i) => effect === first[i])
    );
  });
};

export const canChangeBackgroundColor = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  return (
    hasBackground(appState.activeTool.type) ||
    // a note's label (the target while editing it) has no fill, but a
    // background pick on it colors the note — so the picker stays available
    targetElements.some((element) =>
      hasBackground(
        getColorTargetElement(element, "backgroundColor", elementsMap).type,
      ),
    )
  );
};

/**
 * Single source of truth for "which shape-action controls are relevant right
 * now". Each flag answers whether a given control should be shown, given the
 * active tool and the current selection. All three styles-panel layouts
 * (full / compact / mobile) and the compact popovers consume these flags so
 * that visibility logic lives in one place and layout stays pure.
 */
export const getShapeActionPredicates = (
  appState: UIAppState,
  targetElements: ExcalidrawElement[],
  elementsMap: NonDeletedElementsMap | NonDeletedSceneElementsMap,
  app: AppClassProperties,
) => {
  const activeToolType = appState.activeTool.type;

  // A property is relevant when it applies to the active tool (so it can be
  // preconfigured before drawing) or to any currently selected element.
  const forToolOrSelection = (
    predicate: (type: ElementOrToolType) => boolean,
  ) =>
    predicate(activeToolType) ||
    targetElements.some((element) => predicate(element.type));

  const singleSelected = targetElements.length === 1;

  // a container + its bound text read as a single logical element (2 selected)
  const isSingleElementBoundContainer =
    targetElements.length === 2 &&
    (hasBoundTextElement(targetElements[0]) ||
      hasBoundTextElement(targetElements[1]));

  const isEditingTextOrNewElement = Boolean(
    appState.editingTextElement || appState.newElement,
  );
  const hasSelection = targetElements.length > 0;
  // excalidraw-web: a label's own animation gives its shape no controls
  const animationTargets = animationTargetsOf(targetElements, appState);

  return {
    /** some element(s) selected */
    hasSelection,
    /** actions on selected elements (delete/duplicate/...) */
    showExtraActions: hasSelection && !isEditingTextOrNewElement,

    // color
    strokeColor: canChangeStrokeColor(appState, targetElements, app),
    backgroundColor: canChangeBackgroundColor(
      appState,
      targetElements,
      elementsMap,
    ),
    fill:
      // bucket fill never renders transparent (it falls back to a real
      // color), so its fill style stays relevant either way
      activeToolType === "bucketfill" ||
      (hasFillStyle(activeToolType) &&
        !isTransparent(appState.currentItemBackgroundColor)) ||
      targetElements.some(
        (element) =>
          hasFillStyle(element.type) && !isTransparent(element.backgroundColor),
      ),

    // stroke / shape properties
    strokeWidth: forToolOrSelection(hasStrokeWidth),
    freedrawMode: forToolOrSelection(hasFreedrawMode),
    strokeStyle: forToolOrSelection(hasStrokeStyle),
    sloppiness: forToolOrSelection(hasRoughness),
    roundness: forToolOrSelection(canChangeRoundness),
    polygonSides: forToolOrSelection((type) => type === "polygon"),
    arrowType: forToolOrSelection(toolIsArrow),
    arrowheads: forToolOrSelection(canHaveArrowheads),
    // excalidraw-web: a new element has no animation, so these follow the selection only
    animation: animationTargets.some((element) => canAnimateFor(element, app)),
    animationEffect: offerSameEffects(
      animationTargets.filter((element) => isAnimatedFor(element, app)),
    ),
    animationSpeed: animationTargets.some((element) =>
      isAnimatedFor(element, app),
    ),

    // text
    text: activeToolType === "text" || targetElements.some(isTextElement),
    textAlign:
      activeToolType === "text" ||
      suppportsHorizontalAlign(targetElements, elementsMap),
    verticalAlign: shouldAllowVerticalAlign(targetElements, elementsMap),

    opacity: activeToolType !== "autoshape" || hasSelection,

    // arrangement
    // z-order controls are hidden while the freedraw or drawShape tool is
    // active without an actual selection
    layers:
      (activeToolType !== "freedraw" &&
        activeToolType !== "autoshape" &&
        !targetElements.some((element) => element.type === "freedraw")) ||
      getSelectedElements(elementsMap, appState).some(
        (element) => element.type === "freedraw",
      ),
    align:
      !isSingleElementBoundContainer && alignActionsPredicate(appState, app),
    distribute: targetElements.length > 2,

    // per-element actions
    // NOTE: the full panel treats a bound container as linkable; the compact /
    // mobile layouts only link a truly single selection. Both are preserved via
    // the two flags below.
    link: singleSelected || isSingleElementBoundContainer,
    linkSingleOnly: singleSelected,
    cropEditor:
      !appState.croppingElementId &&
      singleSelected &&
      isImageElement(targetElements[0]) &&
      // excalidraw-web: the host may refuse cropping an image
      app.props.isImageCroppable?.(targetElements[0]) !== false,
    lineEditor:
      !appState.selectedLinearElement?.isEditing &&
      singleSelected &&
      isLinearElement(targetElements[0]) &&
      !isElbowArrow(targetElements[0]),
  };
};

export type ShapeActionPredicates = ReturnType<typeof getShapeActionPredicates>;
