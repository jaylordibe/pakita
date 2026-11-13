import { app } from 'electron';

// Both icons are derived from one mark: build/icon.png, from which
// scripts/generate-mac-icon.mts draws build/icon-mac.png. `?asset` copies
// each into the build output and resolves to its path at runtime.
import iconPath from '../../build/icon.png?asset';
import macIconPath from '../../build/icon-mac.png?asset';

/**
 * The icon a window shows on Windows and Linux (title bar, taskbar). macOS
 * ignores a window icon: its Dock shows the application's.
 */
export const windowIcon: string | undefined =
  process.platform === 'darwin' ? undefined : iconPath;

/**
 * A packaged macOS app takes its Dock icon from the bundle. An unpackaged one
 * runs inside Electron's own bundle, so without this `pnpm dev` shows
 * Electron's icon.
 */
export function showDevelopmentDockIcon(): void {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(macIconPath);
  }
}
