import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { resolve } from 'node:path';

/** Launches the BUILT app (out/) against the given profile folder. */
export async function launchApp(
  userDataDirectory: string,
): Promise<{ application: ElectronApplication; operator: Page }> {
  const application = await electron.launch({
    args: [resolve(__dirname, '../../../out/main/index.js')],
    env: {
      ...process.env,
      PAKITA_TEST_USER_DATA_DIRECTORY: userDataDirectory,
      // Never let a developer's dev-server URL leak into the built-app test.
      ELECTRON_RENDERER_URL: '',
    },
  });
  const operator = await application.firstWindow();
  await operator.waitForLoadState('domcontentloaded');
  return { application, operator };
}

/** The projector window, once the app has opened it. */
export async function findProjector(
  application: ElectronApplication,
): Promise<Page> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const projector = application
      .windows()
      .find((window) => window.url().endsWith('/projector.html'));
    if (projector) {
      await projector.waitForLoadState('domcontentloaded');
      return projector;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('The projector window did not open');
}
