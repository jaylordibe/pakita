import { BrowserWindow, screen } from 'electron';

import { IpcEvent, type LiveState } from '../../shared/ipc-contract';
import { createSecureWebPreferences } from '../security-policy';
import { placeProjector, type ProjectorPlacement } from './projector-placement';

type ProjectorStatus = LiveState['projector'];

export interface ProjectorOptions {
  readonly preloadPath: string;
  /** Loads the projector page into a new window. */
  readonly loadPage: (window: BrowserWindow) => Promise<void>;
  readonly getChosenDisplayId: () => number | null;
  /** Called when the status changes (so the operator sees it). */
  readonly onStatusChange: () => void;
  /** The latest state, re-sent to a window that was (re)created. */
  readonly currentState: () => LiveState;
}

/**
 * The audience-facing window. It shows whatever the main process sends and
 * nothing else: its preload is read-only.
 *
 * It follows the displays as they come and go: a disconnected projector
 * hides the output (the presentation keeps running), and reconnecting it
 * brings the output back on the same slide. A crashed page is recreated with
 * the current state.
 */
export class Projector {
  private window: BrowserWindow | null = null;
  private status: ProjectorStatus = 'off';
  private isOpen = false;
  /** This presentation reached a second display (automatic placement). */
  private wasOnSecondaryDisplay = false;
  /** The placement the window has now (see `placementKey`). */
  private appliedPlacement: string | null = null;

  constructor(private readonly options: ProjectorOptions) {
    const replace = () => {
      if (this.isOpen) this.place();
    };
    screen.on('display-added', replace);
    screen.on('display-removed', replace);
    screen.on('display-metrics-changed', replace);
  }

  getStatus(): ProjectorStatus {
    return this.isOpen ? this.status : 'off';
  }

  open(): void {
    this.isOpen = true;
    this.place();
  }

  close(): void {
    this.isOpen = false;
    this.wasOnSecondaryDisplay = false;
    this.status = 'off';
    this.appliedPlacement = null;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.options.onStatusChange();
  }

  /** Re-applies the display choice, e.g. after the operator picks another. */
  place(): void {
    const primaryDisplayId = screen.getPrimaryDisplay().id;
    const placement = placeProjector(
      screen.getAllDisplays(),
      primaryDisplayId,
      this.options.getChosenDisplayId(),
      this.wasOnSecondaryDisplay,
    );
    if (
      placement.mode === 'showing' &&
      placement.display.id !== primaryDisplayId
    ) {
      this.wasOnSecondaryDisplay = true;
    }
    this.applyPlacement(placement);
  }

  /** Whether these web contents are the projector page (for IPC checks). */
  isProjectorContents(contentsId: number): boolean {
    return (
      this.window !== null &&
      !this.window.isDestroyed() &&
      this.window.webContents.id === contentsId
    );
  }

  send(state: LiveState): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IpcEvent.liveState, state);
    }
  }

  private applyPlacement(placement: ProjectorPlacement): void {
    // Already placed there: change nothing. Going full screen hides a menu
    // bar, which macOS reports as a display change; re-placing the window
    // on it would toggle full screen again, endlessly, and freeze the
    // whole computer.
    const key = placementKey(placement);
    if (
      key === this.appliedPlacement &&
      this.window &&
      !this.window.isDestroyed()
    ) {
      return;
    }
    this.appliedPlacement = key;
    if (placement.mode === 'display-missing') {
      this.window?.hide();
      this.setStatus('display-missing');
      return;
    }
    const window = this.ensureWindow();
    const { bounds } = placement.display;
    if (placement.mode === 'showing') {
      window.setFullScreen(false);
      window.setBounds(bounds);
      window.setFullScreen(true);
    } else {
      window.setFullScreen(false);
      window.setBounds({
        x: bounds.x + Math.round(bounds.width * 0.1),
        y: bounds.y + Math.round(bounds.height * 0.1),
        width: Math.round(bounds.width * 0.6),
        height: Math.round(bounds.width * 0.6 * (9 / 16)),
      });
    }
    window.showInactive();
    this.setStatus(placement.mode);
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }
    const window = new BrowserWindow({
      title: 'Pakita — projector',
      frame: false,
      show: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      // The operator's keyboard stays on the operator window.
      focusable: false,
      webPreferences: createSecureWebPreferences(this.options.preloadPath),
    });
    window.webContents.on('did-finish-load', () =>
      this.send(this.options.currentState()),
    );
    window.webContents.on('render-process-gone', () => {
      // Recreate the page; the presentation itself lives in the main process.
      if (!window.isDestroyed()) window.destroy();
      this.window = null;
      this.appliedPlacement = null;
      if (this.isOpen) this.place();
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.appliedPlacement = null;
      }
    });
    this.window = window;
    void this.options.loadPage(window);
    return window;
  }

  private setStatus(status: ProjectorStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.options.onStatusChange();
    }
  }
}

/** Equal for two placements that would put the window in the same place. */
function placementKey(placement: ProjectorPlacement): string {
  if (placement.mode === 'display-missing') return placement.mode;
  const { id, bounds } = placement.display;
  return `${placement.mode}:${id}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}
