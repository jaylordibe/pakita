<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type {
  MediaItem,
  MediaUploadProgress,
  PickedVideo,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import { inspectVideo, normalizeVideo } from '../video-normalize';
import AppIcon from './AppIcon.vue';

// The theme's background image or video: one of the church's, or a new one
// uploaded from this laptop. Videos never play here: each shows a still frame
// this laptop draws once from its downloaded copy.

const props = defineProps<{ kind: 'image' | 'video' }>();
const selected = defineModel<string | null>({ required: true });
const emit = defineEmits<{ changed: [items: MediaItem[]] }>();

const items = ref<MediaItem[]>([]);
const shownItems = computed(() =>
  items.value.filter((item) => item.kind === props.kind),
);
const isUploadingImage = ref(false);
const errorMessage = ref<string | null>(null);
const upload = ref<{
  picked: PickedVideo;
  /** 0 to 1 while a video outside the spec is converted; null otherwise. */
  converting: number | null;
  progress: MediaUploadProgress | null;
} | null>(null);

// Several things reload the list (a synchronisation, a finished download, an
// upload), and their answers can arrive out of order: only the latest one
// started is shown, so an older, staler answer never overwrites it.
let latestLoad = 0;
async function load(): Promise<void> {
  const thisLoad = ++latestLoad;
  const listed = await window.pakita.media.list();
  if (thisLoad !== latestLoad) return;
  items.value = listed;
  emit('changed', items.value);
  void drawMissingPosters();
}

const megabytes = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function stateOf(item: MediaItem): string {
  const { file } = item;
  switch (file.state) {
    case 'ready':
      return 'On this laptop';
    case 'downloading':
      return `Downloading ${Math.floor(
        (file.receivedBytes / Math.max(1, file.sizeBytes)) * 100,
      )}%`;
    case 'failed':
      return file.message ?? 'Could not download';
    case 'waiting':
      return 'Waiting to download';
  }
}

const uploadLabel = computed(() => {
  const converting = upload.value?.converting;
  if (converting !== null && converting !== undefined) {
    return `Converting to 1080p ${Math.floor(converting * 100)}%`;
  }
  const progress = upload.value?.progress;
  if (!progress) return 'Checking the video…';
  if (progress.stage === 'checking') return 'Checking the video…';
  if (progress.stage === 'saving') return 'Adding it…';
  return `Uploading ${Math.floor(
    (progress.sentBytes / Math.max(1, progress.totalBytes)) * 100,
  )}%`;
});

/** Plays the picked file's metadata here, to measure it before uploading. */
function measure(
  url: string,
): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const measured = {
        width: video.videoWidth,
        height: video.videoHeight,
        durationMs: Math.round(video.duration * 1000),
      };
      video.removeAttribute('src');
      video.load();
      if (!measured.width || !measured.height || !measured.durationMs) {
        reject(new Error('This video has no picture Pakita can play.'));
      } else {
        resolve(measured);
      }
    };
    video.onerror = () =>
      reject(
        new Error(
          'Pakita cannot play this video. Use an MP4 (H.264) or WebM (VP9) file.',
        ),
      );
    video.src = url;
  });
}

async function uploadVideo(): Promise<void> {
  errorMessage.value = null;
  try {
    const chosen = await window.pakita.media.pick();
    if (!chosen) return;
    upload.value = { picked: chosen, converting: null, progress: null };
    // A video outside the spec (larger than 1080p, too fast, an unusual
    // codec, a .mov) becomes one every laptop plays, on this laptop.
    const report = await inspectVideo(chosen.url);
    let picked = chosen;
    if (report.transcodeReasons.length > 0 || report.needsRewrap) {
      upload.value = { picked: chosen, converting: 0, progress: null };
      picked = await normalizeVideo(chosen, report, (progress) => {
        if (upload.value)
          upload.value = { ...upload.value, converting: progress };
      });
      upload.value = { picked, converting: null, progress: null };
    }
    const measured = await measure(picked.url);
    const name =
      chosen.fileName
        .replace(/\.[^.]+$/, '')
        .slice(0, 80)
        .trim() || 'Video';
    const added = await window.pakita.media.upload({
      token: picked.token,
      name,
      ...measured,
    });
    selected.value = added.id;
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    upload.value = null;
  }
}

async function uploadImage(): Promise<void> {
  errorMessage.value = null;
  try {
    const picked = await window.pakita.media.pickImage();
    if (!picked) return;
    isUploadingImage.value = true;
    const name =
      picked.fileName
        .replace(/\.[^.]+$/, '')
        .slice(0, 80)
        .trim() || 'Image';
    const added = await window.pakita.media.uploadImage(picked.token, name);
    selected.value = added.id;
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isUploadingImage.value = false;
  }
}

async function remove(item: MediaItem): Promise<void> {
  errorMessage.value = null;
  try {
    await window.pakita.media.delete(item.id);
    if (selected.value === item.id) selected.value = null;
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

// One still frame at a time, from the local copy, a second in (or halfway
// through a shorter video), as a small WebP the main process keeps.
let isDrawing = false;
async function drawMissingPosters(): Promise<void> {
  if (isDrawing) return;
  isDrawing = true;
  try {
    for (const item of items.value) {
      if (item.kind !== 'video' || !item.url || item.posterUrl) continue;
      const webp = await drawPoster(item.url).catch(() => null);
      if (!webp) continue;
      await window.pakita.media.savePoster(item.sha256, webp);
      // Guarded like every reload; it does not draw again (isDrawing).
      await load();
    }
  } finally {
    isDrawing = false;
  }
}

function drawPoster(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    const done = () => {
      video.removeAttribute('src');
      video.load();
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = Math.round(
        (384 * video.videoHeight) / Math.max(1, video.videoWidth),
      );
      canvas
        .getContext('2d')
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      done();
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('No frame'));
          void blob
            .arrayBuffer()
            .then((buffer) => resolve(new Uint8Array(buffer)));
        },
        'image/webp',
        0.8,
      );
    };
    video.onerror = () => {
      done();
      reject(new Error('Unreadable video'));
    };
    video.src = url;
  });
}

const unsubscribers: Array<() => void> = [];
onMounted(async () => {
  unsubscribers.push(
    window.pakita.media.onFilesChanged((states) => {
      const byId = new Map(states.map((state) => [state.mediaId, state]));
      const wasReady = new Set(
        items.value
          .filter((item) => item.file.state === 'ready')
          .map((item) => item.id),
      );
      items.value = items.value.map((item) => ({
        ...item,
        file: byId.get(item.id) ?? item.file,
      }));
      // A video that just finished downloading: show it, and draw its frame.
      if (
        states.some(
          (state) => state.state === 'ready' && !wasReady.has(state.mediaId),
        )
      ) {
        void load();
      }
    }),
    window.pakita.media.onUploadProgress((progress) => {
      if (upload.value?.picked.token === progress.token) {
        upload.value = { ...upload.value, progress };
      }
    }),
    window.pakita.sync.onStatus((status) => {
      if (status.state === 'idle') void load();
    }),
  );
  await load();
});
onUnmounted(() => unsubscribers.forEach((unsubscribe) => unsubscribe()));
</script>

<template>
  <fieldset class="media-picker">
    <legend class="visually-hidden">
      {{ props.kind === 'image' ? 'Background image' : 'Background video' }}
    </legend>
    <p class="faint">
      {{
        props.kind === 'image'
          ? 'Fills the screen under the text.'
          : 'Loops under the text, muted.'
      }}
    </p>
    <ul class="tiles">
      <li v-for="item in shownItems" :key="item.id" class="tile-wrap">
        <button
          type="button"
          class="tile"
          :aria-pressed="selected === item.id"
          :data-testid="`media-${item.name}`"
          @click="selected = item.id"
        >
          <span class="frame">
            <img v-if="item.posterUrl" :src="item.posterUrl" alt="" />
          </span>
          <span class="tile-name">{{ item.name }}</span>
          <span
            class="tile-state"
            :class="{ failed: item.file.state === 'failed' }"
          >
            {{ stateOf(item) }} · {{ megabytes(item.sizeBytes) }}
          </span>
        </button>
        <button
          type="button"
          class="ghost danger sm remove"
          :aria-label="`Delete ${item.name}`"
          @click="remove(item)"
        >
          <AppIcon name="trash" />
        </button>
      </li>
      <li>
        <button
          v-if="props.kind === 'video'"
          type="button"
          class="tile upload"
          :disabled="upload !== null"
          data-testid="media-upload"
          @click="uploadVideo"
        >
          <span class="frame empty-frame"><AppIcon name="upload" /></span>
          <span class="tile-name">
            {{ upload ? uploadLabel : 'Upload a video' }}
          </span>
          <span class="tile-state">
            MP4, MOV or WebM. Larger than 1080p is converted.
          </span>
        </button>
        <button
          v-else
          type="button"
          class="tile upload"
          :disabled="isUploadingImage"
          data-testid="media-upload-image"
          @click="uploadImage"
        >
          <span class="frame empty-frame"><AppIcon name="upload" /></span>
          <span class="tile-name">
            {{ isUploadingImage ? 'Uploading…' : 'Upload an image' }}
          </span>
          <span class="tile-state">JPEG, PNG or WebP, up to 20 MB.</span>
        </button>
      </li>
    </ul>
    <p v-if="errorMessage" class="error" role="alert">
      <AppIcon name="alert" />
      <span>{{ errorMessage }}</span>
    </p>
  </fieldset>
</template>

<style scoped>
.media-picker {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 0.5rem;
}

legend {
  padding: 0;
  margin-bottom: 0.25rem;
}

.faint {
  margin: 0;
  font-size: 0.75rem;
}

.tiles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.5rem;
}

.tiles > li {
  min-width: 0;
}

.tile-wrap {
  position: relative;
}

/* A card, not a control: undo the global button's centring, single line and
   fixed height, which would shrink a frame to its icon and let long text
   push a tile over its neighbour. */
.tile {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  justify-content: stretch;
  gap: 0.2rem;
  padding: 0.35rem;
  white-space: normal;
  text-align: left;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: transparent;
}

.tile[aria-pressed='true'] {
  background: var(--accent-soft);
  border-color: rgb(139 108 255 / 0.28);
}

.frame {
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--canvas);
  display: grid;
  place-items: center;
}

.frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.empty-frame {
  color: var(--text-faint);
}

.tile-name {
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-state {
  font-size: 0.6875rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.tile-state.failed {
  color: var(--danger);
  opacity: 1;
}

.remove {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
</style>
