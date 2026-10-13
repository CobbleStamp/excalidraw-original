/**
 * The square snap: a rectangle, diamond or ellipse drawn or resized to nearly
 * equal sides snaps to equal sides, under snapping's own on/off rule, and
 * shows its size below it while snapping is on.
 */
import React from "react";

import { arrayToMap, reseed } from "@excalidraw/common";
import { getTransformHandles } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { getSquareSnap } from "../snapping";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, render, unmountComponent } from "./test-utils";

import type { SizeSnapLine } from "../snapping";

const { h } = window;
const mouse = new Pointer("mouse");

const setSnapping = (objectsSnapModeEnabled: boolean): void => {
  act(() => {
    h.setState({ objectsSnapModeEnabled });
  });
};

/** presses the "s" handle of the only selected element and drags it down */
const startDraggingSouthHandle = (element: ExcalidrawElement): void => {
  act(() => {
    h.setState({ selectedElementIds: { [element.id]: true } });
  });
  const [x, y, width, height] = getTransformHandles(
    element,
    h.state.zoom,
    arrayToMap(h.elements),
    "mouse",
    {},
  ).s!;
  mouse.reset();
  mouse.down(x + width / 2, y + height / 2);
  mouse.move(0, 10);
};

/** gives the canvas a size, so that shapes are on screen to snap to */
const showCanvas = (): void => {
  act(() => {
    h.setState({ width: 1000, height: 800 });
  });
};

const sizeLabels = (): SizeSnapLine[] =>
  h.state.snapLines.filter(
    (line): line is SizeSnapLine => line.type === "size",
  );

describe("getSquareSnap", () => {
  it("moves only the free side to match the other", () => {
    expect(getSquareSnap(97, 100, "width", 8)).toEqual({ x: 3, y: 0 });
    expect(getSquareSnap(100, 94, "height", 8)).toEqual({ x: 0, y: 6 });
  });

  it("meets halfway when both sides are free", () => {
    expect(getSquareSnap(104, 98, "both", 8)).toEqual({ x: -3, y: 3 });
  });

  it("keeps a flipped side flipped", () => {
    expect(getSquareSnap(-97, 100, "width", 8)).toEqual({ x: -3, y: 0 });
  });

  it("leaves sides further apart than the snap distance", () => {
    expect(getSquareSnap(90, 100, "both", 8)).toBeNull();
  });
});

describe("square snap", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    mouse.reset();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  describe("resizing", () => {
    it("snaps an edge to a square when snapping is on", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(true);

      UI.resize(rectangle, "e", [2, 0]);

      expect(rectangle.width).toBe(100);
      expect(rectangle.height).toBe(100);
    });

    it("does not snap when snapping is off", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(false);

      UI.resize(rectangle, "e", [2, 0]);

      expect(rectangle.width).toBe(97);
    });

    it("snaps while Ctrl/Cmd is held with snapping off", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(false);

      UI.resize(rectangle, "e", [2, 0], { ctrl: true });

      expect(rectangle.width).toBe(100);
    });

    it("does not snap while Ctrl/Cmd is held with snapping on", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(true);

      UI.resize(rectangle, "e", [2, 0], { ctrl: true });

      expect(rectangle.width).toBe(97);
    });

    it("snaps a corner by meeting halfway", () => {
      const ellipse = UI.createElement("ellipse", { width: 100, height: 100 });
      setSnapping(true);

      UI.resize(ellipse, "se", [4, -2]);

      expect(ellipse.width).toBe(101);
      expect(ellipse.height).toBe(101);
    });

    it("snaps a west edge, moving the shape's left side", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(true);

      UI.resize(rectangle, "w", [-2, 0]);

      expect(rectangle.width).toBe(100);
      expect(rectangle.x).toBe(-5);
    });

    it("leaves Shift's kept aspect ratio alone", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
      });
      setSnapping(true);

      UI.resize(rectangle, "e", [2, 0], { shift: true });

      expect(rectangle.width).toBe(97);
    });

    it("snaps to a square nearer than another shape's edge", () => {
      showCanvas();
      UI.createElement("rectangle", { x: 200, width: 50, height: 103 });
      const rectangle = UI.createElement("rectangle", {
        width: 100,
        height: 95,
      });
      setSnapping(true);

      // a square is 3 away, the other shape's bottom 6
      UI.resize(rectangle, "s", [0, 2]);

      expect(rectangle.height).toBe(100);
    });

    it("snaps to another shape's edge nearer than a square", () => {
      showCanvas();
      UI.createElement("rectangle", { x: 200, width: 50, height: 103 });
      const rectangle = UI.createElement("rectangle", {
        width: 100,
        height: 95,
      });
      setSnapping(true);

      // a square is 2 away, the other shape's bottom 1
      UI.resize(rectangle, "s", [0, 7]);

      expect(rectangle.height).toBe(103);
    });

    it("snaps a north edge resized from the center", () => {
      const diamond = UI.createElement("diamond", { width: 100, height: 96 });
      setSnapping(true);

      UI.resize(diamond, "n", [0, -1], { alt: true });

      expect(diamond.width).toBe(100);
      expect(diamond.height).toBe(100);
    });

    it("snaps a rotated shape along its own sides", () => {
      const rectangle = UI.createElement("rectangle", {
        width: 95,
        height: 100,
        angle: Math.PI / 2,
      });
      setSnapping(true);

      // turned a quarter, the shape's "e" handle points down the screen
      UI.resize(rectangle, "e", [0, 2]);

      expect(rectangle.width).toBeCloseTo(100);
      expect(rectangle.height).toBeCloseTo(100);
    });

    it("does not snap other shapes", () => {
      const frame = API.createElement({
        type: "frame",
        width: 95,
        height: 100,
      });
      API.setElements([frame]);
      setSnapping(true);

      UI.resize(frame, "e", [2, 0]);

      expect(h.elements[0].width).toBe(97);
    });

    it("shows the size below the shape while resizing", () => {
      const rectangle = UI.createElement("rectangle", {
        x: 10,
        y: 20,
        width: 60,
        height: 100,
      });
      setSnapping(true);

      startDraggingSouthHandle(rectangle.get());

      expect(rectangle.height).toBeCloseTo(110);
      const [label] = sizeLabels();
      expect(sizeLabels()).toHaveLength(1);
      expect(label.point[0]).toBeCloseTo(40);
      expect(label.point[1]).toBeCloseTo(130);
      expect(label.width).toBe(60);
      expect(label.height).toBeCloseTo(110);

      mouse.up();
      expect(sizeLabels()).toEqual([]);
    });

    it("shows no size while snapping is off", () => {
      const rectangle = UI.createElement("rectangle", {
        x: 10,
        y: 20,
        width: 60,
        height: 100,
      });
      setSnapping(false);

      startDraggingSouthHandle(rectangle.get());

      expect(rectangle.height).toBeCloseTo(110);
      expect(sizeLabels()).toEqual([]);
      mouse.up();
    });
  });

  describe("drawing", () => {
    it("snaps a new shape to a square and shows its size", () => {
      setSnapping(true);
      UI.clickTool("rectangle");

      mouse.reset();
      mouse.down(10, 10);
      mouse.move(100, 96);

      const [rectangle] = h.elements;
      expect(rectangle.width).toBe(98);
      expect(rectangle.height).toBe(98);
      expect(sizeLabels()).toEqual([
        { type: "size", point: [59, 108], width: 98, height: 98 },
      ]);

      mouse.up();
      expect(sizeLabels()).toEqual([]);
    });

    it("snaps a shape drawn from the center within the same distance", () => {
      setSnapping(true);
      UI.clickTool("rectangle");

      Keyboard.withModifierKeys({ alt: true }, () => {
        mouse.reset();
        mouse.down(100, 100);
        // sides of 100 and 110: further apart than the snap distance
        mouse.move(50, 55);
      });
      expect(h.elements[0].width).toBe(100);
      expect(h.elements[0].height).toBe(110);

      Keyboard.withModifierKeys({ alt: true }, () => {
        // sides of 100 and 106: within it
        mouse.move(0, -2);
        mouse.up();
      });
      expect(h.elements[0].width).toBe(103);
      expect(h.elements[0].height).toBe(103);
    });

    it("does not snap a new shape when snapping is off", () => {
      setSnapping(false);
      UI.clickTool("rectangle");

      mouse.reset();
      mouse.down(10, 10);
      mouse.move(100, 96);
      mouse.up();

      expect(h.elements[0].width).toBe(100);
      expect(h.elements[0].height).toBe(96);
    });

    it("snaps a new shape while Ctrl/Cmd is held with snapping off", () => {
      setSnapping(false);
      UI.clickTool("ellipse");

      Keyboard.withModifierKeys({ ctrl: true }, () => {
        mouse.reset();
        mouse.down(10, 10);
        mouse.move(100, 96);
        mouse.up();
      });

      expect(h.elements[0].width).toBe(98);
      expect(h.elements[0].height).toBe(98);
    });
  });
});
