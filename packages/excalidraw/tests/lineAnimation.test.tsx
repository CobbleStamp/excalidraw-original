/**
 * Line animation: which lines can carry a travelling marker, where the marker
 * is along a looping line and a triggered run, the Animation choice and Speed
 * slider in the panel, a pointer entering a line set to animate once and the
 * host's `animateLines` playing a run, copying it with styles, keeping it
 * through a save and reopen, and the board's layer that draws it.
 */
import React from "react";

import { pointFrom } from "@excalidraw/math";

import {
  arrayToMap,
  CODES,
  DEFAULT_LINE_ANIMATION_SPEED,
  LINE_ANIMATION_PAUSE_MS,
} from "@excalidraw/common";

import {
  canAnimateLine,
  getLineMarker,
  getLineRunMs,
  getLoopProgress,
  getRunProgress,
} from "@excalidraw/element";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { LineAnimationRuns } from "../scene/lineAnimationRuns";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

/** a test line, usable both as a line and as any element on the board */
type AnimatableLine = ExcalidrawLinearElement & NonDeletedExcalidrawElement;

const straight = (
  type: "line" | "arrow",
  extra: Partial<ExcalidrawLinearElement> = {},
): AnimatableLine =>
  ({
    ...API.createElement({
      type,
      x: 10,
      y: 20,
      width: 200,
      height: 0,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(200, 0)],
    }),
    ...extra,
  } as AnimatableLine);

const closedLine = () =>
  API.createElement({
    type: "line",
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(100, 0),
      pointFrom<LocalPoint>(100, 100),
      pointFrom<LocalPoint>(0, 0),
    ],
    polygon: true,
  });

const lineById = (id: string): ExcalidrawLinearElement =>
  h.elements.find((element) => element.id === id) as ExcalidrawLinearElement;

const animationLayer = () => document.querySelector("canvas.animated-lines");

describe("where a line's marker is", () => {
  it("takes a run the line's length over its speed", () => {
    const line = straight("line", { animationSpeed: 400 });

    expect(getLineRunMs(line, arrayToMap([line]))).toBeCloseTo(500);
  });

  it("loops: runs, waits, and runs again", () => {
    expect(getLoopProgress(1000, 0)).toBe(0);
    expect(getLoopProgress(1000, 500)).toBeCloseTo(0.5);
    expect(getLoopProgress(1000, 1001)).toBeNull();
    expect(
      getLoopProgress(1000, 1000 + LINE_ANIMATION_PAUSE_MS + 500),
    ).toBeCloseTo(0.5);
  });

  it("plays a triggered run once, from a frame just before it was asked for", () => {
    expect(getRunProgress(1000, -5)).toBe(0);
    expect(getRunProgress(1000, 500)).toBeCloseTo(0.5);
    expect(getRunProgress(1000, 1000)).toBeNull();
    expect(getRunProgress(0, 0)).toBeNull();
  });

  it("puts a line's dot along it from start to end, facing the end", () => {
    const line = straight("line");
    const marker = getLineMarker(line, arrayToMap([line]), 0.25)!;

    expect(marker.point[0]).toBeCloseTo(60);
    expect(marker.point[1]).toBeCloseTo(20);
    expect(marker.heading).toBeCloseTo(0);
  });

  it("runs an arrow's chevron toward its only head when the head is at the start", () => {
    const arrow = straight("arrow", {
      startArrowhead: "arrow",
      endArrowhead: null,
    });
    const marker = getLineMarker(arrow, arrayToMap([arrow]), 0.25)!;

    expect(marker.point[0]).toBeCloseTo(160);
    expect(Math.abs(marker.heading)).toBeCloseTo(Math.PI);
  });

  it("runs from start to end on an arrow with heads at both ends", () => {
    const arrow = straight("arrow", {
      startArrowhead: "arrow",
      endArrowhead: "arrow",
    });
    const marker = getLineMarker(arrow, arrayToMap([arrow]), 0.25)!;

    expect(marker.point[0]).toBeCloseTo(60);
  });

  it("follows a rotated line", () => {
    const line = straight("line", { angle: (Math.PI / 2) as Radians });
    // a quarter turn about its middle (110, 20) stands the line upright
    const marker = getLineMarker(line, arrayToMap([line]), 0.25)!;

    expect(marker.point[0]).toBeCloseTo(110, 0);
    expect(marker.point[1]).toBeCloseTo(-30, 0);
    expect(marker.heading).toBeCloseTo(Math.PI / 2);
  });

  it("animates arrows and open lines, not closed lines or shapes", () => {
    expect(canAnimateLine(straight("arrow"))).toBe(true);
    expect(canAnimateLine(straight("line"))).toBe(true);
    expect(canAnimateLine(closedLine())).toBe(false);
    expect(canAnimateLine(API.createElement({ type: "rectangle" }))).toBe(
      false,
    );
  });
});

describe("triggered runs", () => {
  it("begin when a pointer enters a line, not while it stays, and again when it comes back", () => {
    const runs = new LineAnimationRuns();
    runs.pointerOver("self", "a", 0);
    runs.finish("a");
    runs.pointerOver("self", "a", 10);

    expect(runs.current().size).toBe(0);

    runs.pointerOver("self", null, 20);
    runs.pointerOver("self", "a", 30);

    expect(runs.current().get("a")).toBe(30);
  });

  it("follow each pointer on its own", () => {
    const runs = new LineAnimationRuns();
    runs.pointerOver("self", "a", 0);
    runs.pointerOver("collaborator:1", "a", 5);

    expect(runs.current().get("a")).toBe(5);
  });

  it("begin again for a pointer that left and came back onto the same line", () => {
    const runs = new LineAnimationRuns();
    runs.pointerOver("collaborator:1", "a", 0);
    runs.finish("a");
    runs.forgetPointersGone("collaborator:", new Set(["collaborator:2"]));
    runs.pointerOver("collaborator:1", "a", 10);

    expect(runs.current().get("a")).toBe(10);
  });

  it("tell their listener when they begin and when the last one ends", () => {
    const runs = new LineAnimationRuns();
    const heard = vi.fn();
    runs.subscribe(heard);
    runs.start(["a", "b"], 0);
    runs.finish("a");
    runs.finish("b");

    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("line animation in the editor", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw handleKeyboardGlobally />);
    // the test board has no size until it is given one, and so nothing is in view
    API.setAppState({ width: 800, height: 600 });
  });

  afterEach(async () => {
    await act(async () => {});
  });

  it("offers No animation, Animate once and Animate loop for a selected line, and Speed only while it animates", () => {
    const line = straight("line");
    API.setElements([line]);
    API.setSelectedElements([line]);

    expect(screen.getByTestId("line-animation-none")).toBeChecked();
    expect(screen.queryByTestId("line-animation-speed")).toBeNull();

    fireEvent.click(screen.getByTestId("line-animation-once"));

    expect(lineById(line.id).animation).toBe("once");
    expect(lineById(line.id).animationSpeed).toBe(DEFAULT_LINE_ANIMATION_SPEED);
    expect(screen.getByTestId("line-animation-speed")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("line-animation-loop"));

    expect(lineById(line.id).animation).toBe("loop");

    fireEvent.click(screen.getByTestId("line-animation-none"));

    expect(lineById(line.id).animation).toBeUndefined();
    expect(screen.queryByTestId("line-animation-speed")).toBeNull();
  });

  it("sets the speed with the slider and gives it to the next line that starts to animate", () => {
    const first = straight("arrow", {
      animation: "loop",
      animationSpeed: 200,
    });
    const second = straight("arrow", { animationSpeed: 100 });
    API.setElements([first, second]);
    API.setSelectedElements([first]);

    fireEvent.change(screen.getByTestId("line-animation-speed"), {
      target: { value: "600" },
    });

    expect(lineById(first.id).animationSpeed).toBe(600);

    API.setSelectedElements([second]);
    fireEvent.click(screen.getByTestId("line-animation-once"));

    expect(lineById(second.id).animationSpeed).toBe(600);
  });

  it("shows the speed a line runs at, the default when it has none of its own", () => {
    const line = straight("line", { animation: "loop" });
    API.setAppState({ currentItemAnimationSpeed: 600 });
    API.setElements([line]);
    API.setSelectedElements([line]);

    expect(screen.getByTestId("line-animation-speed")).toHaveValue(
      String(DEFAULT_LINE_ANIMATION_SPEED),
    );
  });

  it("offers no Animation for shapes, closed lines, or the line tool before a line is drawn", () => {
    const closed = closedLine();
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([closed, rectangle]);

    API.setSelectedElements([closed]);
    expect(screen.queryByTestId("line-animation-none")).toBeNull();

    API.setSelectedElements([rectangle]);
    expect(screen.queryByTestId("line-animation-none")).toBeNull();

    API.clearSelection();
    UI.clickTool("line");
    expect(screen.queryByTestId("line-animation-none")).toBeNull();
  });

  it("copies a line's animation with the other styles, keeping the target's speed when the source has none", () => {
    const source = straight("line", { animation: "once" });
    const target = straight("arrow", { animationSpeed: 300 });
    API.setElements([source, target]);

    const pressCopyStyles = (): void => {
      Keyboard.codeDown(CODES.C);
    };
    const pressPasteStyles = (): void => {
      Keyboard.codeDown(CODES.V);
    };
    API.setSelectedElements([source] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, pressCopyStyles);
    API.setSelectedElements([target] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, pressPasteStyles);

    expect(lineById(target.id).animation).toBe("once");
    expect(lineById(target.id).animationSpeed).toBe(300);
  });

  it("pastes no animation from a line without one, taking the target's off", () => {
    const source = straight("line");
    const target = straight("arrow", { animation: "loop" });
    API.setElements([source, target]);

    const pressCopyStyles = (): void => {
      Keyboard.codeDown(CODES.C);
    };
    const pressPasteStyles = (): void => {
      Keyboard.codeDown(CODES.V);
    };
    API.setSelectedElements([source] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, pressCopyStyles);
    API.setSelectedElements([target] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, pressPasteStyles);

    expect(lineById(target.id).animation).toBeUndefined();
  });

  it("draws a looping line's marker on a layer of its own, there only while something animates", async () => {
    const line = straight("line", { animation: "once" });
    API.setElements([line]);

    expect(animationLayer()).toBeNull();

    API.updateElement(line, { animation: "loop" });
    await act(async () => {});

    expect(animationLayer()).not.toBeNull();
  });

  it("plays a run when the pointer enters a line set to animate once", async () => {
    API.setElements([straight("line", { animation: "once" })]);
    const mouse = new Pointer("mouse");

    mouse.moveTo(110, 300);
    await act(async () => {});
    expect(animationLayer()).toBeNull();

    mouse.moveTo(110, 20);
    await act(async () => {});
    expect(animationLayer()).not.toBeNull();
  });

  it("keeps a run going while a second pointer moves elsewhere", () => {
    const runs = new LineAnimationRuns();
    runs.pointerOver("self:1", "a", 0);
    runs.pointerOver("self:2", null, 5);
    runs.pointerOver("self:1", "a", 10);

    expect(runs.current().get("a")).toBe(0);
  });

  it("plays no run when the pointer enters a line with no animation", async () => {
    API.setElements([straight("line")]);
    const mouse = new Pointer("mouse");

    mouse.moveTo(110, 20);
    await act(async () => {});

    expect(animationLayer()).toBeNull();
  });

  it("plays a run when a collaborator's pointer enters a line set to animate once", async () => {
    API.setElements([straight("arrow", { animation: "once" })]);

    await act(async () => {
      h.app.updateScene({
        collaborators: new Map([
          ["peer" as never, { pointer: { x: 110, y: 20, tool: "pointer" } }],
        ]),
      });
    });

    expect(animationLayer()).not.toBeNull();
  });

  it("plays a run the host asks for on any line, whatever its setting", async () => {
    const line = straight("line");
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([line, rectangle]);

    await act(async () => {
      h.app.animateLines([rectangle.id]);
    });
    expect(animationLayer()).toBeNull();

    await act(async () => {
      h.app.animateLines([line.id]);
    });
    expect(animationLayer()).not.toBeNull();
  });

  it("keeps the markers still when the system asks for reduced motion", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    try {
      await render(<Excalidraw />);
      API.setAppState({ width: 800, height: 600 });
      API.setElements([straight("line", { animation: "loop" })]);
      await act(async () => {});

      expect(animationLayer()).toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe("line animation in a saved drawing", () => {
  it("keeps it through a save and reopen, dropping a setting that is not ours and bringing a speed into range", () => {
    const [kept, unknown, fast, plain] = restoreElements(
      [
        straight("line", {
          id: "kept",
          animation: "loop",
          animationSpeed: 300,
        }),
        {
          ...straight("arrow", { id: "unknown" }),
          animation: "sometimes",
          animationSpeed: "fast",
        },
        straight("arrow", {
          id: "fast",
          animation: "once",
          animationSpeed: 5000,
        }),
        straight("line", { id: "plain" }),
      ] as unknown as ExcalidrawLinearElement[],
      null,
    ) as ExcalidrawLinearElement[];

    expect(kept.animation).toBe("loop");
    expect(kept.animationSpeed).toBe(300);
    expect("animation" in unknown).toBe(false);
    expect(unknown.animationSpeed).toBe(DEFAULT_LINE_ANIMATION_SPEED);
    expect(fast.animation).toBe("once");
    expect(fast.animationSpeed).toBe(1000);
    expect("animation" in plain).toBe(false);
  });
});
