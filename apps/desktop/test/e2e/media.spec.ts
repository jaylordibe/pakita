import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { findProjector, launchApp } from './support/launch';
import { startTestApi, type TestApi } from './support/test-api';

// A background video, end to end against a real API and real S3-compatible
// storage (the test stack's own): uploaded from one laptop straight to
// storage, downloaded and verified by a second, and played by its projector
// under the lyrics, never restarted by a slide change.

test.describe.configure({ mode: 'serial' });

const FIXTURE = resolve(__dirname, '../fixtures/background-loop.webm');
const FIXTURE_SHA256 = createHash('sha256')
  .update(readFileSync(FIXTURE))
  .digest('hex');

let api: TestApi;
const profiles: string[] = [];
const applications: ElectronApplication[] = [];

async function openLaptop(): Promise<{
  application: ElectronApplication;
  operator: Page;
}> {
  const profile = mkdtempSync(join(tmpdir(), 'pakita-media-'));
  profiles.push(profile);
  const laptop = await launchApp(profile);
  applications.push(laptop.application);
  const { operator } = laptop;
  await operator.getByTestId('server-address').fill(api.origin);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await operator.getByTestId('sign-in-identifier').fill(api.owner.identifier);
  await operator.getByTestId('sign-in-password').fill(api.owner.password);
  await operator.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    operator.getByTestId('library-song-Amazing Grace'),
  ).toBeVisible();
  return laptop;
}

test.beforeAll(async () => {
  api = await startTestApi({ storage: 's3' });
  await api.request('POST', `/api/workspaces/${api.workspace.id}/songs`, {
    title: 'Amazing Grace',
    sections: [
      {
        key: 'v1',
        kind: 'verse',
        label: 'Verse 1',
        lyrics: 'Amazing grace\n\nHow sweet the sound',
      },
    ],
  });
});

test.afterAll(async () => {
  for (const application of applications) await application.close();
  await api?.dispose();
  for (const profile of profiles) {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('uploads a video from one laptop and makes it the default background', async () => {
  const { application, operator } = await openLaptop();
  // The file dialog is the operating system's; answer it with the fixture.
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, FIXTURE);

  await operator.getByTestId('tab-themes').click();
  await operator.getByTestId('theme-new').click();
  await operator.getByTestId('theme-name').fill('Moving');
  await operator.getByTestId('theme-default').check();
  await operator.getByTestId('media-upload').click();
  const tile = operator.getByTestId('media-background-loop');
  await expect(tile).toContainText('On this laptop', { timeout: 30_000 });
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  // Its still frame, drawn from the local copy, shows in the preview.
  await expect(operator.locator('.preview .poster')).toBeVisible({
    timeout: 15_000,
  });
  await operator.getByTestId('theme-save').click();
  await expect(operator.getByTestId('theme-Moving')).toContainText('(default)');

  const media = await api.request<{
    data: Array<{ id: string; sha256: string; contentType: string }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/media`);
  expect(media.data).toEqual([
    expect.objectContaining({
      sha256: FIXTURE_SHA256,
      contentType: 'video/webm',
    }),
  ]);
});

test('a second laptop downloads it and the projector plays it across slides', async () => {
  const { application, operator } = await openLaptop();
  await operator.getByTestId('tab-themes').click();
  await operator.getByTestId('theme-Moving').click();
  await expect(operator.getByTestId('media-background-loop')).toContainText(
    'On this laptop',
    { timeout: 30_000 },
  );

  await operator.getByTestId('tab-songs').click();
  await operator.getByTestId('library-song-Amazing Grace').click();
  await operator.getByTestId('go-live').click();
  const projector = await findProjector(application);
  await expect(projector.locator('#slide')).toHaveText('Amazing grace');

  const playing = projector.locator('.background-video.is-shown');
  await expect(playing).toHaveCount(1, { timeout: 15_000 });
  await expect(playing).toHaveAttribute(
    'src',
    `pakita-media://files/${FIXTURE_SHA256}.webm`,
  );
  const id = await playing.getAttribute('id');
  const timeOf = () =>
    projector
      .locator(`#${id}`)
      .evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(timeOf).toBeGreaterThan(0.3);
  const before = await timeOf();

  await operator.getByTestId('live-next').click();
  await expect(projector.locator('#slide')).toHaveText('How sweet the sound');
  // The same layer, still playing on from where it was: not restarted.
  await expect(projector.locator('.background-video.is-shown')).toHaveAttribute(
    'id',
    id!,
  );
  expect(await timeOf()).toBeGreaterThanOrEqual(before);
});

test('converts a video larger than 1080p on the laptop before uploading it', async () => {
  const [application] = applications;
  const operator = await application!.firstWindow();
  // A 2560 × 1440 clip, recorded here: no large file in the repository.
  const recorded = await operator.evaluate(
    () =>
      new Promise<number[]>((resolveClip) => {
        const canvas = document.createElement('canvas');
        canvas.width = 2560;
        canvas.height = 1440;
        const context = canvas.getContext('2d')!;
        let frame = 0;
        const timer = setInterval(() => {
          context.fillStyle = `hsl(${(frame += 9) % 360} 70% 50%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }, 33);
        const recorder = new MediaRecorder(canvas.captureStream(30), {
          mimeType: 'video/webm;codecs=vp9',
        });
        const parts: Blob[] = [];
        recorder.ondataavailable = (event) => parts.push(event.data);
        recorder.onstop = async () => {
          clearInterval(timer);
          const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
          resolveClip(Array.from(bytes));
        };
        recorder.start();
        setTimeout(() => recorder.stop(), 1500);
      }),
  );
  const clip = join(profiles[0]!, 'large-loop.webm');
  writeFileSync(clip, Buffer.from(recorded));
  await application!.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, clip);

  await operator.getByTestId('tab-themes').click();
  await operator.getByTestId('theme-Moving').click();
  await operator.getByTestId('media-upload').click();
  await expect(operator.getByTestId('media-large-loop')).toContainText(
    'On this laptop',
    { timeout: 60_000 },
  );

  const media = await api.request<{
    data: Array<{
      name: string;
      width: number;
      height: number;
      contentType: string;
    }>;
  }>('GET', `/api/workspaces/${api.workspace.id}/media`);
  expect(media.data.find((video) => video.name === 'large-loop')).toEqual(
    expect.objectContaining({ width: 1920, height: 1080 }),
  );
});
