export interface DisplayGeometry {
  readonly id: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export type ProjectorPlacement =
  | { readonly mode: 'showing'; readonly display: DisplayGeometry }
  | { readonly mode: 'windowed'; readonly display: DisplayGeometry }
  | { readonly mode: 'display-missing' };

/**
 * Where the projector output goes.
 *
 * - The operator chose a display and it is connected: full screen there.
 * - The chosen display is gone (a cable came out): nowhere, until it comes
 *   back — the output is never thrown onto the operator's own screen.
 * - No choice made: the first display that is not the primary one; with a
 *   single display, a normal window on it, so the app is usable on a laptop
 *   alone — unless this presentation was already on a second display, which
 *   has now gone: then nowhere, as for a chosen display.
 */
export function placeProjector(
  displays: readonly DisplayGeometry[],
  primaryDisplayId: number,
  chosenDisplayId: number | null,
  wasOnSecondaryDisplay = false,
): ProjectorPlacement {
  if (chosenDisplayId !== null) {
    const chosen = displays.find((display) => display.id === chosenDisplayId);
    return chosen
      ? { mode: 'showing', display: chosen }
      : { mode: 'display-missing' };
  }
  const secondary = displays.find((display) => display.id !== primaryDisplayId);
  if (secondary) {
    return { mode: 'showing', display: secondary };
  }
  if (wasOnSecondaryDisplay) {
    return { mode: 'display-missing' };
  }
  const primary =
    displays.find((display) => display.id === primaryDisplayId) ?? displays[0];
  return primary
    ? { mode: 'windowed', display: primary }
    : { mode: 'display-missing' };
}
