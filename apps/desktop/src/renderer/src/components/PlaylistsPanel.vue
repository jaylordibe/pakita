<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import type {
  PlaylistItemInput,
  PlaylistSummary,
  PlaylistView,
  SyncStatus,
  ThemeSummary,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

const playlists = ref<PlaylistSummary[]>([]);
const themes = ref<ThemeSummary[]>([]);
const playlist = ref<PlaylistView | null>(null);
const details = reactive({
  name: '',
  serviceDate: '',
  themeId: '' as string,
});
const newName = ref('');
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);

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
  const view = await window.pakita.playlists.get(playlistId);
  // Null: deleted on the server since (or not received yet).
  if (view) show(view);
  else playlist.value = null;
}

// Every change is saved on the server at once (and synchronised back).
async function save(items?: PlaylistItemInput[]): Promise<void> {
  if (!playlist.value) return;
  const playlistId = playlist.value.id;
  errorMessage.value = null;
  isSaving.value = true;
  try {
    show(
      await window.pakita.playlists.update(playlistId, {
        name: details.name.trim(),
        serviceDate: details.serviceDate || null,
        themeId: details.themeId || null,
        items: items ?? playlist.value.entries.map((entry) => entry.input),
        expectedSyncVersion: playlist.value.syncVersion,
      }),
    );
    await loadLists();
  } catch (error) {
    errorMessage.value = messageOf(error);
    // Changed elsewhere: bring the newer copy down, keeping the message.
    const message = errorMessage.value;
    await window.pakita.sync.now();
    await open(playlistId);
    errorMessage.value = message;
  } finally {
    isSaving.value = false;
  }
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

function inputs(): PlaylistItemInput[] {
  return playlist.value?.entries.map((entry) => entry.input) ?? [];
}

async function move(index: number, offset: number): Promise<void> {
  const items = inputs();
  const target = index + offset;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target]!, items[index]!];
  await save(items);
}

async function removeEntry(index: number): Promise<void> {
  const items = inputs();
  items.splice(index, 1);
  await save(items);
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
    // Readiness changes as content arrives.
    if (playlist.value) void open(playlist.value.id);
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
        <ol class="entries">
          <li
            v-for="(entry, index) in playlist.entries"
            :key="index"
            :class="{ missing: !entry.isReady }"
            :data-testid="`playlist-entry-${index}`"
          >
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
                class="sm ghost icon-only"
                aria-label="Move up"
                title="Move up"
                :disabled="index === 0"
                @click="move(index, -1)"
              >
                <AppIcon name="arrow-up" />
              </button>
              <button
                class="sm ghost icon-only"
                aria-label="Move down"
                title="Move down"
                :disabled="index === playlist.entries.length - 1"
                @click="move(index, 1)"
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
