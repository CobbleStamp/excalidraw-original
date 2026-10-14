/**
 * excalidraw-web: the opacities the animation layer's running Fades give
 * elements this frame, which the board's own canvas draws them at, so a
 * fading element stays under what covers it. It tells the board when they
 * change, and stays quiet while no Fade runs.
 */
export class ElementFades {
  private opacities: ReadonlyMap<string, number> = new Map();
  private readonly listeners = new Set<() => void>();

  /** The opacity of each fading element, by id */
  current(): ReadonlyMap<string, number> {
    return this.opacities;
  }

  /** Sets this frame's opacities, telling the board unless none were fading and none are */
  set(opacities: ReadonlyMap<string, number>): void {
    if (opacities.size === 0 && this.opacities.size === 0) {
      return;
    }
    this.opacities = opacities;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Calls `listener` whenever the opacities change; returns the unsubscribe */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
