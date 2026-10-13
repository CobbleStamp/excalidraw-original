/**
 * excalidraw-web: the triggered runs of animated elements. It keeps which
 * elements are playing a single run, when each began and the effect it
 * plays, starts one when a pointer (the user's own, or a collaborator's)
 * enters an element set to animate once, and tells the animation layer when
 * there are runs to draw.
 */
import type { AnimationEffect } from "@excalidraw/element/types";

/** A triggered run: when it began, and the effect asked for, if any */
export type AnimationRun = {
  startedMs: number;
  effect?: AnimationEffect;
};

export class AnimationRuns {
  private readonly runs = new Map<string, AnimationRun>();
  /** the elements each pointer was last over, so a run starts only on entering */
  private readonly hovered = new Map<string, ReadonlySet<string>>();
  private readonly listeners = new Set<() => void>();

  /** Begins a run on each of the elements at `nowMs`, with the effect asked for, restarting one already playing */
  start(
    elementIds: readonly string[],
    nowMs: number,
    effect?: AnimationEffect,
  ): void {
    if (elementIds.length === 0) {
      return;
    }
    for (const id of elementIds) {
      this.runs.set(id, { startedMs: nowMs, ...(effect && { effect }) });
    }
    this.notify();
  }

  /** Notes the elements a pointer is over now, and begins a run on each it has just entered */
  pointerOver(
    pointer: string,
    elementIds: readonly string[],
    nowMs: number,
  ): void {
    const before = this.hovered.get(pointer);
    this.hovered.set(pointer, new Set(elementIds));
    this.start(
      elementIds.filter((id) => !before?.has(id)),
      nowMs,
    );
  }

  /** Forgets a pointer that left: coming back onto an element enters it */
  forget(pointer: string): void {
    this.hovered.delete(pointer);
  }

  /** Forgets the pointers named with `prefix` that are not among `present`, which left: coming back onto an element enters it */
  forgetPointersGone(prefix: string, present: ReadonlySet<string>): void {
    for (const pointer of [...this.hovered.keys()]) {
      if (pointer.startsWith(prefix) && !present.has(pointer)) {
        this.hovered.delete(pointer);
      }
    }
  }

  /** The elements playing a run, with each run */
  current(): ReadonlyMap<string, AnimationRun> {
    return this.runs;
  }

  /** Ends an element's run once it is over */
  finish(elementId: string): void {
    if (this.runs.delete(elementId) && this.runs.size === 0) {
      this.notify();
    }
  }

  /** Hears when runs begin or the last one ends; returns a function that stops it */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
