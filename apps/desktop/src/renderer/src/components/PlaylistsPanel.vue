<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
} from 'vue';

import type {
  PlaylistSummary,
  PlaylistView,
  SyncStatus,
  ThemeSummary,
} from '../../../shared/ipc-contract';
import { focusFirstEnabled, moveItem, useDragReorder } from '../drag-reorder';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

const playlists = ref<PlaylistSummary[]>([]);
const themes = ref<ThemeSummary[]>([]);
// Replaced whole, never changed in place: its entries stay plain objects,
// which IPC can send (a reactive proxy cannot be cloned).
const playlist = shallowRef<PlaylistView | null>(null);
const details = reactive({
  name: '',
  serviceDate: '',
  themeId: '' as string,
});
const newName = ref('');
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);

// Every change is saved on the server at once (and synchronised back), one
// save at a time: a change made while a save is in flight (a second quick
// move) stays on screen and goes in the next save, made from the version the
// first one returned, so the operator's own changes never conflict.
let hasUnsavedChange = false;

async function loadLists(): Promise<void> {
  [playlists.value, themes.value] = await Promise.all([
    window.pakita.playlists.list(),
    window.pakita.themes.list(),
  ]);
}

// A write succeeded but the laptop has not received it yet (offline right
// after saving): keep what is shown and say so.
const NOT_YET_RECEIVED =
  'Saved on the server. It appears here after the next synchronisation.';

function show(view: PlaylistView | null): void {
  if (!view) {
    errorMessage.value = NOT_YET_RECEIVED;
    return;
  }
  playlist.value = view;
  details.name = view.name;
  details.serviceDate = view.serviceDate ?? '';
  details.themeId = view.themeId ?? '';
}

async function open(playlistId: string): Promise<void> {
  errorMessage.value = null;
  // Another playlist: what was unsaved on the previous one is not saved here.
  if (playlist.value?.id !== playlistId) hasUnsavedChange = false;
  const view = await window.pakita.playlists.get(playlistId);
  // Null: deleted on the server since (or not received yet).
  if (view) show(view);
  else playlist.value = null;
}

// Saves the playlist as shown.
async function save(): Promise<void> {
  hasUnsavedChange = true;
  if (isSaving.value || !playlist.value) return;
  const playlistId = playlist.value.id;
  errorMessage.value = null;
  isSaving.value = true;
  try {
    while (hasUnsavedChange && playlist.value?.id === playlistId) {
      hasUnsavedChange = false;
      const shown = playlist.value;
      const view = await window.pakita.playlists.update(playlistId, {
        name: details.name.trim(),
        serviceDate: details.serviceDate || null,
        themeId: details.themeId || null,
        items: shown.entries.map((entry) => entry.input),
        expectedSyncVersion: shown.syncVersion,
      });
      if (playlist.value?.id !== playlistId) break;
      if (view && hasUnsavedChange) {
        // Newer changes are on screen: keep them, take the new version.
        playlist.value = { ...playlist.value, syncVersion: view.syncVersion };
      } else {
        // Not received yet (null): nothing newer to save against.
        show(view);
        hasUnsavedChange = false;
      }
    }
  } catch (error) {
    hasUnsavedChange = false;
    errorMessage.value = messageOf(error);
    // Changed elsewhere: bring the newer copy down, keeping the message.
    const message = errorMessage.value;
    await window.pakita.sync.now();
    await open(playlistId);
    errorMessage.value = message;
  } finally {
    isSaving.value = false;
  }
  // A change made while the lists reloaded, or while a failed save was
  // being replaced by the server's copy, still gets saved.
  if (hasUnsavedChange) {
    await save();
    return;
  }
  await loadLists();
}

async function create(): Promise<void> {
  const name = newName.value.trim();
  if (!name) return;
  errorMessage.value = null;
  try {
    show(
      await window.pakita.playlists.create({
        name,
        serviceDate: null,
        themeId: null,
        items: [],
      }),
    );
    newName.value = '';
    await loadLists();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

async function remove(): Promise<void> {
  if (!playlist.value) return;
  errorMessage.value = null;
  try {
    await window.pakita.playlists.delete(playlist.value.id);
    playlist.value = null;
    await loadLists();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

// Read out after every move, by drag or by button.
const moveAnnouncement = ref('');

// The new order shows at once; the save follows (and a failed save brings
// the server's order back).
async function moveEntry(from: number, to: number): Promise<void> {
  if (!playlist.value || from === to) return;
  const entries = moveItem(playlist.value.entries, from, to);
  const moved = entries[to];
  if (!moved) return;
  playlist.value = { ...playlist.value, entries };
  moveAnnouncement.value = `Moved ${moved.title} to position ${to + 1} of ${entries.length}.`;
  await save();
}

async function moveByButton(index: number, offset: -1 | 1): Promise<void> {
  const to = index + offset;
  const direction = offset < 0 ? 'up' : 'down';
  const opposite = offset < 0 ? 'down' : 'up';
  const moving = moveEntry(index, to);
  // Keep focus on the entry that moved, so the next press moves it again.
  await focusFirstEnabled(
    `[data-move="${to}-${direction}"]`,
    `[data-move="${to}-${opposite}"]`,
  );
  await moving;
}

const reorder = useDragReorder<'entries'>({
  axis: 'vertical',
  onMove: (_list, from, to) => void moveEntry(from, to),
});

function startDrag(index: number, event: DragEvent): void {
  const row = (event.currentTarget as HTMLElement).closest('li');
  reorder.start('entries', index, event, row ?? undefined);
}

async function removeEntry(index: number): Promise<void> {
  if (!playlist.value) return;
  playlist.value = {
    ...playlist.value,
    entries: playlist.value.entries.filter((_entry, at) => at !== index),
  };
  await save();
}

async function present(entryIndex: number): Promise<void> {
  if (!playlist.value) return;
  errorMessage.value = null;
  try {
    await window.pakita.live.startPlaylist(playlist.value.id, entryIndex);
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

const readyCount = computed(
  () => playlist.value?.entries.filter((entry) => entry.isReady).length ?? 0,
);
const readyShare = computed(() => {
  const total = playlist.value?.entries.length ?? 0;
  return total === 0 ? 0 : (100 * readyCount.value) / total;
});

function firstReadyIndex(): number {
  return playlist.value?.entries.findIndex((entry) => entry.isReady) ?? -1;
}

let unsubscribe: (() => void) | null = null;
onMounted(async () => {
  unsubscribe = window.pakita.sync.onStatus((status: SyncStatus) => {
    if (status.state !== 'idle') return;
    void loadLists();
    // Readiness changes as content arrives. Not during a save: it shows
    // the result itself, and a refresh would replace changes still unsaved.
    if (playlist.value && !isSaving.value) void open(playlist.value.id);
  });
  await loadLists();
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Playlists</h1>
      </div>
      <form class="create" @submit.prevent="create">
        <input
          v-model="newName"
          maxlength="120"
          placeholder="New playlist"
          aria-label="New playlist"
          data-testid="playlist-new-name"
        />
        <button
          type="submit"
          class="icon-only"
          title="Add playlist"
          data-testid="playlist-create"
        >
          <AppIcon name="plus" />
          <span class="visually-hidden">Add</span>
        </button>
      </form>
      <ul class="list">
        <li v-for="summary in playlists" :key="summary.id">
          <button
            class="list-item"
            :aria-current="summary.id === playlist?.id ? 'true' : undefined"
            :data-testid="`playlist-${summary.name}`"
            @click="open(summary.id)"
          >
            <span class="item-title">{{ summary.name }}</span>
            <span v-if="summary.serviceDate" class="item-sub">
              {{ summary.serviceDate }}
            </span>
          </button>
        </li>
        <li v-if="playlists.length === 0" class="list-empty">
          No playlists yet.
        </li>
      </ul>
    </aside>

    <main class="panel-content">
      <template v-if="playlist">
        <form class="details" @submit.prevent="save()">
          <div class="page-head">
            <input
              v-model="details.name"
              class="name"
              required
              maxlength="120"
              aria-label="Name"
              data-testid="playlist-name"
            />
            <button type="button" class="ghost danger" @click="remove">
              <AppIcon name="trash" />
              Delete
            </button>
            <button
              class="go-live"
              data-testid="playlist-present"
              :disabled="firstReadyIndex() < 0"
              @click.prevent="present(firstReadyIndex())"
            >
              <AppIcon name="play" />
              Present playlist
            </button>
          </div>
          <div class="toolbar">
            <label class="inline">
              <span class="muted">Service date</span>
              <input
                v-model="details.serviceDate"
                type="date"
                aria-label="Service date"
                data-testid="playlist-date"
              />
            </label>
            <label class="inline">
              <span class="muted">Theme</span>
              <select
                v-model="details.themeId"
                aria-label="Theme"
                data-testid="playlist-theme"
              >
                <option value="">Church default theme</option>
                <option
                  v-for="theme in themes"
                  :key="theme.id"
                  :value="theme.id"
                >
                  {{ theme.name }}
                </option>
              </select>
            </label>
            <button type="submit" :disabled="isSaving">
              <AppIcon name="check" />
              Save
            </button>
          </div>
        </form>

        <p v-if="errorMessage" class="error" role="alert">
          <AppIcon name="alert" />
          <span>{{ errorMessage }}</span>
        </p>

        <div class="readiness">
          <span
            class="meter"
            aria-hidden="true"
            :style="{ '--ready': `${readyShare}%` }"
          ></span>
          <p class="muted" data-testid="playlist-readiness">
            {{ readyCount }} of {{ playlist.entries.length }} ready on this
            laptop
          </p>
        </div>
        <ol class="entries" @dragleave="reorder.leave">
          <li
            v-for="(entry, index) in playlist.entries"
            :key="index"
            :class="{
              missing: !entry.isReady,
              dragged: reorder.isDragged('entries', index),
              [`drop-${reorder.markerAt('entries', index)}`]: reorder.markerAt(
                'entries',
                index,
              ),
            }"
            :data-testid="`playlist-entry-${index}`"
            @dragover="reorder.over('entries', index, $event)"
            @drop="reorder.drop('entries', $event)"
          >
            <span
              class="grip"
              draggable="true"
              title="Drag to reorder"
              :data-testid="`playlist-entry-grip-${index}`"
              @dragstart="startDrag(index, $event)"
              @dragend="reorder.end"
            >
              <AppIcon name="grip" />
            </span>
            <span class="position">{{ index + 1 }}</span>
            <span class="state" :title="entry.isReady ? 'Ready' : 'Not ready'">
              <AppIcon :name="entry.isReady ? 'check' : 'alert'" />
              <span class="visually-hidden">{{
                entry.isReady ? 'Ready' : 'Not ready'
              }}</span>
            </span>
            <span class="entry-text">
              <span class="entry-title">
                <strong>{{ entry.title }}</strong>
                <span v-if="entry.detail" class="muted">
                  · {{ entry.detail }}</span
                >
              </span>
              <span v-if="entry.note" class="note">{{ entry.note }}</span>
            </span>
            <span class="entry-actions">
              <button
                class="sm"
                :disabled="!entry.isReady"
                :data-testid="`playlist-entry-present-${index}`"
                @click="present(index)"
              >
                <AppIcon name="play" />
                Present from here
              </button>
              <button
                class="sm ghost icon-only reorder"
                aria-label="Move up"
                title="Move up"
                :data-move="`${index}-up`"
                :disabled="index === 0"
                @click="moveByButton(index, -1)"
              >
                <AppIcon name="arrow-up" />
              </button>
              <button
                class="sm ghost icon-only reorder"
                aria-label="Move down"
                title="Move down"
                :data-move="`${index}-down`"
                :disabled="index === playlist.entries.length - 1"
                @click="moveByButton(index, 1)"
              >
                <AppIcon name="arrow-down" />
              </button>
              <button
                class="sm ghost danger icon-only"
                aria-label="Remove"
                title="Remove"
                @click="removeEntry(index)"
              >
                <AppIcon name="x" />
              </button>
            </span>
          </li>
          <li v-if="playlist.entries.length === 0" class="entries-empty">
            Add songs from the Songs tab and passages from the Bible tab.
          </li>
        </ol>
        <p class="visually-hidden" aria-live="polite">
          {{ moveAnnouncement }}
        </p>
      </template>
      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="playlists" /></span>
        <p>Choose a playlist, or create one.</p>
      </div>
      <p v-if="errorMessage && !playlist" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.create {
  display: flex;
  gap: 0.4rem;
}

.create input {
  flex: 1;
}

.page-head {
  margin-bottom: 0.9rem;
}

/* The playlist's name reads as the page title and edits in place. */
.name {
  flex: 1 1 16rem;
  min-height: 2.6rem;
  padding: 0 0.6rem;
  margin-left: -0.6rem;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.018em;
  background: transparent;
  border-color: transparent;
}

.name:hover:not(:focus) {
  border-color: var(--border);
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  padding-bottom: 1.25rem;
  margin-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}

.error {
  margin-bottom: 1rem;
}

.readiness {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  font-size: 0.82rem;
}

.meter {
  position: relative;
  width: 6rem;
  height: 0.35rem;
  border-radius: 999px;
  background: var(--surface-hover);
  overflow: hidden;
}

.meter::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--ready);
  border-radius: inherit;
  background: var(--success);
  transition: width 240ms var(--ease-out);
}

.entries {
  display: grid;
  gap: 0.45rem;
  max-width: 56rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.entries > li:not(.entries-empty) {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.6rem 0.6rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 160ms var(--ease-out);
}

.entries > li:not(.entries-empty):hover {
  border-color: var(--border-strong);
}

.entries > li.missing {
  border-color: rgb(255 190 92 / 0.35);
  background:
    linear-gradient(90deg, var(--warning-soft), transparent 60%), var(--surface);
}

/* Drag to reorder: the grip is the handle; the row is what moves. */
.grip {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 2rem;
  margin: 0 -0.35rem 0 -0.4rem;
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  cursor: grab;
  transition: color 120ms var(--ease-out);
}

.grip .icon {
  width: 0.95rem;
  height: 0.95rem;
}

.entries > li:hover .grip {
  color: var(--text-muted);
}

.grip:active {
  cursor: grabbing;
}

.entries > li.dragged {
  opacity: 0.45;
}

/* Where the row will land: a violet line in the gap. */
.entries > li.drop-before::before,
.entries > li.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 1px rgb(139 108 255 / 0.25);
  pointer-events: none;
}

.entries > li.drop-before::before {
  top: calc(-0.225rem - 2px);
}

.entries > li.drop-after::after {
  bottom: calc(-0.225rem - 2px);
}

/* The step buttons stay for keyboard and for anyone who cannot drag, but
   only show on the row being pointed at or focused. */
.entry-actions .reorder {
  opacity: 0;
  transition: opacity 120ms var(--ease-out);
}

.entries > li:hover .reorder,
.entries > li:focus-within .reorder {
  opacity: 1;
}

.position {
  width: 1.2rem;
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
  text-align: right;
}

.state {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  color: var(--success);
  background: var(--success-soft);
}

.state .icon {
  width: 0.9rem;
  height: 0.9rem;
}

.missing .state {
  color: var(--warning);
  background: var(--warning-soft);
}

.entry-text {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.1rem;
}

.entry-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-title strong {
  font-weight: 600;
}

.note {
  font-size: 0.8rem;
  color: var(--warning);
}

.entry-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.entry-actions > :first-child {
  margin-right: 0.35rem;
}

.entries-empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  text-align: center;
  color: var(--text-muted);
}
</style>
