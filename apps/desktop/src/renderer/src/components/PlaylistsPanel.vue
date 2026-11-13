<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';

import type {
  PlaylistItemInput,
  PlaylistSummary,
  PlaylistView,
  SyncStatus,
  ThemeSummary,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

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
    <aside class="list">
      <form class="row" @submit.prevent="create">
        <input
          v-model="newName"
          class="grow"
          maxlength="120"
          placeholder="New playlist"
          data-testid="playlist-new-name"
        />
        <button type="submit" data-testid="playlist-create">Add</button>
      </form>
      <ul>
        <li
          v-for="summary in playlists"
          :key="summary.id"
          :class="{ selected: summary.id === playlist?.id }"
          :data-testid="`playlist-${summary.name}`"
          @click="open(summary.id)"
        >
          {{ summary.name }}
          <span v-if="summary.serviceDate" class="muted">
            {{ summary.serviceDate }}
          </span>
        </li>
        <li v-if="playlists.length === 0" class="muted empty">
          No playlists yet.
        </li>
      </ul>
    </aside>

    <main class="content">
      <template v-if="playlist">
        <form class="row" @submit.prevent="save()">
          <input
            v-model="details.name"
            required
            maxlength="120"
            aria-label="Name"
            data-testid="playlist-name"
          />
          <input
            v-model="details.serviceDate"
            type="date"
            aria-label="Service date"
            data-testid="playlist-date"
          />
          <select
            v-model="details.themeId"
            aria-label="Theme"
            data-testid="playlist-theme"
          >
            <option value="">Church default theme</option>
            <option v-for="theme in themes" :key="theme.id" :value="theme.id">
              {{ theme.name }}
            </option>
          </select>
          <button type="submit" :disabled="isSaving">Save</button>
          <span class="grow"></span>
          <button
            class="live"
            data-testid="playlist-present"
            :disabled="firstReadyIndex() < 0"
            @click.prevent="present(firstReadyIndex())"
          >
            Present playlist
          </button>
          <button type="button" @click="remove">Delete</button>
        </form>

        <p class="muted" data-testid="playlist-readiness">
          {{ playlist.entries.filter((entry) => entry.isReady).length }} of
          {{ playlist.entries.length }} ready on this laptop
        </p>
        <ol class="entries">
          <li
            v-for="(entry, index) in playlist.entries"
            :key="index"
            :class="{ missing: !entry.isReady }"
            :data-testid="`playlist-entry-${index}`"
          >
            <span class="state" :title="entry.isReady ? 'Ready' : 'Not ready'">
              {{ entry.isReady ? '✓' : '!' }}
            </span>
            <span class="grow">
              <strong>{{ entry.title }}</strong>
              <span v-if="entry.detail" class="muted">
                · {{ entry.detail }}
              </span>
              <span v-if="entry.note" class="note">{{ entry.note }}</span>
            </span>
            <button
              :disabled="!entry.isReady"
              :data-testid="`playlist-entry-present-${index}`"
              @click="present(index)"
            >
              Present from here
            </button>
            <button aria-label="Move up" @click="move(index, -1)">↑</button>
            <button aria-label="Move down" @click="move(index, 1)">↓</button>
            <button aria-label="Remove" @click="removeEntry(index)">✕</button>
          </li>
          <li v-if="playlist.entries.length === 0" class="muted">
            Add songs from the Songs tab and passages from the Bible tab.
          </li>
        </ol>
      </template>
      <p v-else class="muted">Choose a playlist, or create one.</p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    </main>
  </div>
</template>

<style scoped>
.panel {
  display: grid;
  grid-template-columns: 18rem 1fr;
  height: 100%;
  min-height: 0;
}

.list {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.5rem;
  padding: 0.75rem;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}

.list li {
  display: grid;
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.list li.selected {
  background: #e3ebf3;
}

.list li.empty {
  cursor: default;
}

.grow {
  flex: 1;
}

.content {
  display: grid;
  align-content: start;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  overflow: auto;
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.entries li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.entries li.missing {
  border-color: var(--danger);
}

.state {
  width: 1.2rem;
  text-align: center;
  font-weight: 700;
}

.entries li.missing .state,
.note {
  color: var(--danger);
}

.note {
  display: block;
  font-size: 0.85rem;
}
</style>
