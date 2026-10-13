/**
 * Element animation: which elements can animate and with which effects, how
 * long a run takes, where a line's marker and a shape's travelling light are
 * through a run, the Animation, Effect and Speed choices in the panel, a
 * pointer entering an element set to animate once and the host's
 * `animateElements` playing a run, copying it with styles, keeping it
 * through a save and reopen, and the board's layer that draws it.
 */
import React from "react";

import { pointFrom } from "@excalidraw/math";

import {
  arrayToMap,
  CODES,
  ANIMATION_PAUSE_MS,
  DEFAULT_ANIMATION_SPEED,
} from "@excalidraw/common";

import {
  animationEffectOf,
  animationEffectsOf,
  canAnimate,
  getAnimationPath,
  getAnimationRunMs,
  getLineMarker,
  getLoopProgress,
  getRunProgress,
  getTravellingPoint,
} from "@excalidraw/element";

import type { LocalPoint, Radians } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { restoreElements } from "../data/restore";
import { AnimationRuns } from "../scene/animationRuns";

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

const animationLayer = () => document.querySelector("canvas.animated-elements");

describe("where a line's marker is", () => {
  it("takes a run the line's length over its speed", () => {
    const line = straight("line", { animationSpeed: 400 });

    expect(getAnimationRunMs(line, arrayToMap([line]), "dot")).toBeCloseTo(500);
  });

  it("loops: runs, waits, and runs again", () => {
    expect(getLoopProgress(1000, 0)).toBe(0);
    expect(getLoopProgress(1000, 500)).toBeCloseTo(0.5);
    expect(getLoopProgress(1000, 1001)).toBeNull();
    expect(getLoopProgress(1000, 1000 + ANIMATION_PAUSE_MS + 500)).toBeCloseTo(
      0.5,
    );
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

  it("animates arrows and open lines, not closed lines", () => {
    expect(canAnimate(straight("arrow"))).toBe(true);
    expect(canAnimate(straight("line"))).toBe(true);
    expect(canAnimate(closedLine())).toBe(false);
  });
});

describe("what a shape's animation is", () => {
  const box = (
    type: "rectangle" | "text" | "image",
    extra: Partial<ExcalidrawElement> = {},
  ) =>
    ({
      ...API.createElement({ type, x: 0, y: 0, width: 100, height: 50 }),
      roundness: null,
      ...extra,
    } as NonDeletedExcalidrawElement);

  it("animates shapes, sticky notes, texts, images and pencil drawings, not frames or embeds", () => {
    for (const type of [
      "rectangle",
      "diamond",
      "ellipse",
      "polygon",
      "stickynote",
      "text",
      "image",
      "freedraw",
    ] as const) {
      expect(canAnimate(API.createElement({ type }))).toBe(true);
    }
    expect(canAnimate(API.createElement({ type: "frame" }))).toBe(false);
    expect(canAnimate(API.createElement({ type: "embeddable" }))).toBe(false);
  });

  it("offers a dot or a chevron on lines and arrows, a travelling light, a pulse or a shimmer on the rest", () => {
    expect(animationEffectsOf(straight("line"))).toEqual(["dot", "chevron"]);
    expect(animationEffectsOf(straight("arrow"))).toEqual(["dot", "chevron"]);
    expect(animationEffectsOf(box("rectangle"))).toEqual([
      "travel",
      "pulse",
      "shimmer",
    ]);
    expect(animationEffectsOf(API.createElement({ type: "frame" }))).toEqual(
      [],
    );
  });

  it("plays a line's dot, an arrow's chevron and a shape's travelling light when none is set", () => {
    expect(animationEffectOf(straight("line"))).toBe("dot");
    expect(animationEffectOf(straight("arrow"))).toBe("chevron");
    expect(animationEffectOf(box("rectangle"))).toBe("travel");
  });

  it("plays the effect asked for when the element offers it, its own otherwise", () => {
    const pulsing = box("rectangle", { animationEffect: "pulse" });

    expect(animationEffectOf(pulsing, "shimmer")).toBe("shimmer");
    expect(animationEffectOf(pulsing, "chevron")).toBe("pulse");
    expect(animationEffectOf(straight("line"), "chevron")).toBe("chevron");
  });

  it("takes a pulse or shimmer 160 over its speed in seconds, kept between 0.3 and 2", () => {
    const at = (speed: number) => {
      const element = box("rectangle", { animationSpeed: speed });
      return getAnimationRunMs(element, arrayToMap([element]), "pulse");
    };

    expect(at(DEFAULT_ANIMATION_SPEED)).toBeCloseTo(800);
    expect(at(400)).toBeCloseTo(400);
    expect(at(50)).toBe(2000);
    expect(at(1000)).toBe(300);
  });

  it("takes a travelling light's run its outline's length over its speed", () => {
    const element = box("rectangle", { animationSpeed: 300 });

    expect(
      getAnimationRunMs(element, arrayToMap([element]), "travel"),
    ).toBeCloseTo(1000);
  });

  it("runs a rectangle's light clockwise from its top middle", () => {
    const element = box("rectangle");
    const path = getAnimationPath(element, arrayToMap([element]));

    expect(getTravellingPoint(path, 0)).toEqual([50, 0]);
    // 75 of the 300 round: 50 to the top right corner, then 25 down
    expect(getTravellingPoint(path, 0.25)![0]).toBeCloseTo(100);
    expect(getTravellingPoint(path, 0.25)![1]).toBeCloseTo(25);
    expect(getTravellingPoint(path, 1)![0]).toBeCloseTo(50);
    expect(getTravellingPoint(path, 1)![1]).toBeCloseTo(0);
  });

  it("runs round the box of a text or image, turned as it is", () => {
    const element = box("text", { angle: Math.PI as Radians });
    const start = getTravellingPoint(
      getAnimationPath(element, arrayToMap([element])),
      0,
    )!;

    // half a turn about its middle (50, 25) puts its top middle at the bottom
    expect(start[0]).toBeCloseTo(50);
    expect(start[1]).toBeCloseTo(50);
  });

  it("starts an ellipse's and a polygon's light at the top", () => {
    const ellipse = API.createElement({
      type: "ellipse",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    const polygon = API.createElement({
      type: "polygon",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const ellipseStart = getTravellingPoint(
      getAnimationPath(ellipse, arrayToMap([ellipse])),
      0,
    )!;
    const polygonPath = getAnimationPath(polygon, arrayToMap([polygon]));
    const top = Math.min(...polygonPath.points.map(([, y]) => y));

    expect(ellipseStart[0]).toBeCloseTo(50);
    expect(ellipseStart[1]).toBeCloseTo(0);
    expect(getTravellingPoint(polygonPath, 0)![1]).toBeCloseTo(top);
    // clockwise: the light moves right from the top
    expect(getTravellingPoint(polygonPath, 0.05)![0]).toBeGreaterThan(
      getTravellingPoint(polygonPath, 0)![0],
    );
  });

  it("runs a pencil drawing's light along its stroke, from its start, not back round", () => {
    const pencil = API.createElement({
      type: "freedraw",
      x: 10,
      y: 10,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(100, 0),
        pointFrom<LocalPoint>(100, 100),
      ],
    });
    const path = getAnimationPath(pencil, arrayToMap([pencil]));

    expect(path.closed).toBe(false);
    expect(getTravellingPoint(path, 0)).toEqual([10, 10]);
    expect(getTravellingPoint(path, 1)![0]).toBeCloseTo(110);
    expect(getTravellingPoint(path, 1)![1]).toBeCloseTo(110);
  });
});

describe("triggered runs", () => {
  it("begin when a pointer enters an element, not while it stays, and again when it comes back", () => {
    const runs = new AnimationRuns();
    runs.pointerOver("self", ["a"], 0);
    runs.finish("a");
    runs.pointerOver("self", ["a"], 10);

    expect(runs.current().size).toBe(0);

    runs.pointerOver("self", [], 20);
    runs.pointerOver("self", ["a"], 30);

    expect(runs.current().get("a")?.startedMs).toBe(30);
  });

  it("begin on an element entered while the pointer stays over another", () => {
    const runs = new AnimationRuns();
    runs.pointerOver("self", ["box"], 0);
    runs.pointerOver("self", ["box", "line"], 10);

    expect(runs.current().get("box")?.startedMs).toBe(0);
    expect(runs.current().get("line")?.startedMs).toBe(10);
  });

  it("follow each pointer on its own", () => {
    const runs = new AnimationRuns();
    runs.pointerOver("self", ["a"], 0);
    runs.pointerOver("collaborator:1", ["a"], 5);

    expect(runs.current().get("a")?.startedMs).toBe(5);
  });

  it("begin again for a pointer that left and came back onto the same element", () => {
    const runs = new AnimationRuns();
    runs.pointerOver("collaborator:1", ["a"], 0);
    runs.finish("a");
    runs.forgetPointersGone("collaborator:", new Set(["collaborator:2"]));
    runs.pointerOver("collaborator:1", ["a"], 10);

    expect(runs.current().get("a")?.startedMs).toBe(10);
  });

  it("keep the effect a run was asked for", () => {
    const runs = new AnimationRuns();
    runs.start(["a"], 0, "pulse");
    runs.start(["b"], 0);

    expect(runs.current().get("a")?.effect).toBe("pulse");
    expect(runs.current().get("b")?.effect).toBeUndefined();
  });

  it("tell their listener when they begin and when the last one ends", () => {
    const runs = new AnimationRuns();
    const heard = vi.fn();
    runs.subscribe(heard);
    runs.start(["a", "b"], 0);
    runs.finish("a");
    runs.finish("b");

    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("keeps a run going while a second pointer moves elsewhere", () => {
    const runs = new AnimationRuns();
    runs.pointerOver("self:1", ["a"], 0);
    runs.pointerOver("self:2", [], 5);
    runs.pointerOver("self:1", ["a"], 10);

    expect(runs.current().get("a")?.startedMs).toBe(0);
  });
});

describe("animation in the editor", () => {
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

    expect(screen.getByTestId("animation-none")).toBeChecked();
    expect(screen.queryByTestId("animation-speed")).toBeNull();

    fireEvent.click(screen.getByTestId("animation-once"));

    expect(lineById(line.id).animation).toBe("once");
    expect(lineById(line.id).animationSpeed).toBe(DEFAULT_ANIMATION_SPEED);
    expect(screen.getByTestId("animation-speed")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("animation-loop"));

    expect(lineById(line.id).animation).toBe("loop");

    fireEvent.click(screen.getByTestId("animation-none"));

    expect(lineById(line.id).animation).toBeUndefined();
    expect(screen.queryByTestId("animation-speed")).toBeNull();
  });

  it("sets the speed with the slider and gives it to the next line that starts to animate", () => {
    const first = straight("arrow", {
      animation: "loop",
      animationSpeed: 200,
    });
    const second = straight("arrow", { animationSpeed: 100 });
    API.setElements([first, second]);
    API.setSelectedElements([first]);

    fireEvent.change(screen.getByTestId("animation-speed"), {
      target: { value: "600" },
    });

    expect(lineById(first.id).animationSpeed).toBe(600);

    API.setSelectedElements([second]);
    fireEvent.click(screen.getByTestId("animation-once"));

    expect(lineById(second.id).animationSpeed).toBe(600);
  });

  it("shows the speed a line runs at, the default when it has none of its own", () => {
    const line = straight("line", { animation: "loop" });
    API.setAppState({ currentItemAnimationSpeed: 600 });
    API.setElements([line]);
    API.setSelectedElements([line]);

    expect(screen.getByTestId("animation-speed")).toHaveValue(
      String(DEFAULT_ANIMATION_SPEED),
    );
  });

  it("offers no Animation for closed lines, frames, or the line tool before a line is drawn", () => {
    const closed = closedLine();
    const frame = API.createElement({ type: "frame" });
    API.setElements([closed, frame]);

    API.setSelectedElements([closed]);
    expect(screen.queryByTestId("animation-none")).toBeNull();

    API.setSelectedElements([frame]);
    expect(screen.queryByTestId("animation-none")).toBeNull();

    API.clearSelection();
    UI.clickTool("line");
    expect(screen.queryByTestId("animation-none")).toBeNull();
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

  it("copies a line's animation to a shape, without the line's effect", () => {
    const source = straight("arrow", {
      animation: "loop",
      animationEffect: "dot",
    });
    const target = API.createElement({ type: "rectangle" });
    API.setElements([source, target]);

    API.setSelectedElements([source] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () =>
      Keyboard.codeDown(CODES.C),
    );
    API.setSelectedElements([target] as NonDeletedExcalidrawElement[]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () =>
      Keyboard.codeDown(CODES.V),
    );

    const pasted = h.elements.find((element) => element.id === target.id)!;
    expect(pasted.animation).toBe("loop");
    expect(pasted.animationEffect).toBeUndefined();
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

  it("offers Animation for a shape, and Effect while it animates, Travelling light first", () => {
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    expect(screen.getByTestId("animation-none")).toBeChecked();
    expect(screen.queryByTestId("animation-effect-travel")).toBeNull();

    fireEvent.click(screen.getByTestId("animation-once"));

    expect(screen.getByTestId("animation-effect-travel")).toBeChecked();
    expect(screen.queryByTestId("animation-effect-dot")).toBeNull();

    fireEvent.click(screen.getByTestId("animation-effect-shimmer"));

    expect(
      h.elements.find((element) => element.id === rectangle.id)
        ?.animationEffect,
    ).toBe("shimmer");
  });

  it("offers Dot and Chevron on a line or arrow, the arrow's Chevron first", () => {
    const arrow = straight("arrow", { animation: "loop" });
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    expect(screen.getByTestId("animation-effect-chevron")).toBeChecked();
    expect(screen.queryByTestId("animation-effect-pulse")).toBeNull();

    fireEvent.click(screen.getByTestId("animation-effect-dot"));

    expect(lineById(arrow.id).animationEffect).toBe("dot");
  });

  it("offers no Effect for a line and a shape animating together", () => {
    const line = straight("line", { animation: "loop" });
    const rectangle = {
      ...API.createElement({ type: "rectangle" }),
      animation: "loop",
    } as const;
    API.setElements([line, rectangle]);
    API.setSelectedElements([line, rectangle]);

    expect(screen.queryByTestId("animation-effect-dot")).toBeNull();
    expect(screen.queryByTestId("animation-effect-travel")).toBeNull();
  });

  it("animates a shape without its label", () => {
    const [rectangle, label] = API.createTextContainer();
    API.setElements([rectangle, label]);
    API.setSelectedElements([rectangle]);

    fireEvent.click(screen.getByTestId("animation-loop"));

    const byId = (id: string) =>
      h.elements.find((element) => element.id === id);
    expect(byId(rectangle.id)?.animation).toBe("loop");
    expect(byId(label.id)?.animation).toBeUndefined();
  });

  it("plays a run when the pointer enters a shape's box set to animate once", async () => {
    API.setElements([
      {
        ...API.createElement({
          type: "ellipse",
          x: 300,
          y: 300,
          width: 100,
          height: 100,
        }),
        animation: "once",
      },
    ]);
    const mouse = new Pointer("mouse");

    mouse.moveTo(200, 200);
    await act(async () => {});
    expect(animationLayer()).toBeNull();

    // the box's corner, outside the ellipse itself
    mouse.moveTo(303, 303);
    await act(async () => {});
    expect(animationLayer()).not.toBeNull();
  });

  it("plays the effect the host asks for on a shape", async () => {
    const rectangle = API.createElement({ type: "rectangle" });
    API.setElements([rectangle]);

    await act(async () => {
      h.app.animateElements([rectangle.id], performance.now(), "pulse");
    });

    expect(animationLayer()).not.toBeNull();
  });

  it("plays a run the host asks for on any element that may animate, whatever its setting", async () => {
    const line = straight("line");
    const frame = API.createElement({ type: "frame" });
    API.setElements([line, frame]);

    await act(async () => {
      h.app.animateElements([frame.id]);
    });
    expect(animationLayer()).toBeNull();

    await act(async () => {
      h.app.animateElements([line.id]);
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

describe("animation the host does not allow", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(
      <Excalidraw
        canAnimateElement={(element) => element.customData?.still !== true}
      />,
    );
    API.setAppState({ width: 800, height: 600 });
  });

  it("offers no Animation, and plays nothing, for an element the host keeps still", async () => {
    const still = {
      ...API.createElement({ type: "rectangle" }),
      customData: { still: true },
    };
    API.setElements([still]);
    API.setSelectedElements([still]);

    expect(screen.queryByTestId("animation-none")).toBeNull();

    await act(async () => {
      h.app.animateElements([still.id]);
    });
    expect(animationLayer()).toBeNull();
  });

  it("pastes no animation onto an element the host keeps still", () => {
    const source = {
      ...API.createElement({ type: "rectangle" }),
      animation: "loop",
      animationEffect: "pulse",
    } as const;
    const still = {
      ...API.createElement({ type: "rectangle" }),
      customData: { still: true },
    };
    API.setElements([source, still]);

    API.setSelectedElements([source]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () =>
      Keyboard.codeDown(CODES.C),
    );
    API.setSelectedElements([still]);
    Keyboard.withModifierKeys({ ctrl: true, alt: true }, () =>
      Keyboard.codeDown(CODES.V),
    );

    const pasted = h.elements.find((element) => element.id === still.id)!;
    expect(pasted.animation).toBeUndefined();
    expect(pasted.animationEffect).toBeUndefined();
  });
});

describe("animation in a saved drawing", () => {
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
    expect(unknown.animationSpeed).toBe(DEFAULT_ANIMATION_SPEED);
    expect(fast.animation).toBe("once");
    expect(fast.animationSpeed).toBe(1000);
    expect("animation" in plain).toBe(false);
  });

  it("keeps a shape's animation and an effect it offers, dropping one it does not, and an animation on what cannot animate", () => {
    const [pulsing, wrongEffect, frame] = restoreElements(
      [
        {
          ...API.createElement({ type: "rectangle", id: "pulsing" }),
          animation: "loop",
          animationEffect: "pulse",
        },
        {
          ...API.createElement({ type: "ellipse", id: "wrong" }),
          animation: "once",
          animationEffect: "chevron",
        },
        {
          ...API.createElement({ type: "frame", id: "frame" }),
          animation: "loop",
        },
      ],
      null,
    );

    expect(pulsing.animation).toBe("loop");
    expect(pulsing.animationEffect).toBe("pulse");
    expect(wrongEffect.animation).toBe("once");
    expect("animationEffect" in wrongEffect).toBe(false);
    expect("animation" in frame).toBe(false);
  });
});
