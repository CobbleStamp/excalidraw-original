/**
 * excalidraw-web: the triggered runs of animated lines. It keeps which lines
 * are playing a single run and when each began, starts one when a pointer
 * (the user's own, or a collaborator's) enters a line set to animate once,
 * and tells the animation layer when there are runs to draw.
 */
export class LineAnimationRuns {
  private readonly runs = new Map<string, number>();
  /** the line each pointer was last over, so a run starts only on entering */
  private readonly hovered = new Map<string, string | null>();
  private readonly listeners = new Set<() => void>();

  /** Begins a run on each of the lines at `nowMs`, restarting one already playing */
  start(lineIds: readonly string[], nowMs: number): void {
    if (lineIds.length === 0) {
      return;
    }
    for (const id of lineIds) {
      this.runs.set(id, nowMs);
    }
    this.notify();
  }

  /** Notes the line a pointer is over now, and begins its run when the pointer has just entered it */
  pointerOver(pointer: string, lineId: string | null, nowMs: number): void {
    const before = this.hovered.get(pointer) ?? null;
    this.hovered.set(pointer, lineId);
    if (lineId !== null && lineId !== before) {
      this.start([lineId], nowMs);
    }
  }

  /** Forgets the pointers named with `prefix` that are not among `present`, which left: coming back onto a line enters it */
  forgetPointersGone(prefix: string, present: ReadonlySet<string>): void {
    for (const pointer of [...this.hovered.keys()]) {
      if (pointer.startsWith(prefix) && !present.has(pointer)) {
        this.hovered.delete(pointer);
      }
    }
  }

  /** The lines playing a run, with the time each began */
  current(): ReadonlyMap<string, number> {
    return this.runs;
  }

  /** Ends a line's run once it is over */
  finish(lineId: string): void {
    if (this.runs.delete(lineId) && this.runs.size === 0) {
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
