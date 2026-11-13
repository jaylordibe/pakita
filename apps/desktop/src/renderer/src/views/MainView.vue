<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  AccountSummary,
  Song,
  SongSummary,
  SyncStatus,
} from '../../../shared/ipc-contract';
import { buildSongSlides } from '../../../shared/slides';
import SongEditor from '../components/SongEditor.vue';
import { messageOf } from '../errors';

const props = defineProps<{ account: AccountSummary }>();
const emit = defineEmits<{
  signedOut: [];
  signIn: [];
  changeWorkspace: [];
  stateChanged: [];
}>();

const search = ref('');
const songs = ref<SongSummary[]>([]);
const selectedSong = ref<Song | null>(null);
const arrangementId = ref<string | null>(null);
const editing = ref<'new' | 'existing' | null>(null);
const syncStatus = ref<SyncStatus>({
  state: 'idle',
  lastSyncedAt: null,
  message: null,
});
const errorMessage = ref<string | null>(null);

const previewSlides = computed(() =>
  selectedSong.value
    ? (buildSongSlides(selectedSong.value, arrangementId.value ?? undefined) ??
      [])
    : [],
);

const syncLabel = computed(() => {
  const status = syncStatus.value;
  const last = status.lastSyncedAt
    ? `Synchronised ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
    : 'Not synchronised yet';
  if (status.state === 'syncing') return 'Synchronising…';
  if (status.message) return `${status.message} (${last})`;
  return last;
});

async function refreshLibrary(): Promise<void> {
  songs.value = await window.pakita.library.listSongs(search.value, false);
}

async function selectSong(songId: string): Promise<void> {
  errorMessage.value = null;
  // Keep the operator's arrangement across edits (ids change; names don't).
  const previous = selectedSong.value;
  const previousName =
    previous?.id === songId
      ? previous.arrangements.find(
          (arrangement) => arrangement.id === arrangementId.value,
        )?.name
      : undefined;
  selectedSong.value = await window.pakita.library.getSong(songId);
  const arrangements = selectedSong.value?.arrangements ?? [];
  arrangementId.value =
    arrangements.find((arrangement) => arrangement.name === previousName)?.id ??
    arrangements.find((arrangement) => arrangement.isDefault)?.id ??
    null;
}

// After a synchronisation, show the selected song as it now is.
async function refreshSelectedSong(): Promise<void> {
  if (selectedSong.value && editing.value === null) {
    await selectSong(selectedSong.value.id);
  }
}

async function goLive(): Promise<void> {
  if (!selectedSong.value) return;
  errorMessage.value = null;
  try {
    await window.pakita.live.start(selectedSong.value.id, arrangementId.value);
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

async function syncNow(): Promise<void> {
  syncStatus.value = await window.pakita.sync.now();
}

async function onSaved(song: Song): Promise<void> {
  editing.value = null;
  await refreshLibrary();
  await selectSong(song.id);
}

async function signOut(): Promise<void> {
  if ((await window.pakita.live.getState()).isLive) {
    errorMessage.value = 'Stop presenting before signing out.';
    return;
  }
  await window.pakita.account.signOut();
  emit('signedOut');
}

watch(search, () => void refreshLibrary());

const unsubscribes: Array<() => void> = [];
onMounted(async () => {
  unsubscribes.push(
    window.pakita.sync.onStatus((status) => {
      syncStatus.value = status;
      if (status.state === 'idle') {
        void refreshLibrary();
        void refreshSelectedSong();
        // A synchronisation succeeded: the session is live again.
        if (!props.account.isSignedIn) emit('stateChanged');
      }
    }),
  );
  syncStatus.value = await window.pakita.sync.getStatus();
  await refreshLibrary();
});
onUnmounted(() => unsubscribes.forEach((unsubscribe) => unsubscribe()));
</script>

<template>
  <div class="layout">
    <header class="row bar">
      <strong>Pakita</strong>
      <span class="muted" data-testid="sync-status">{{ syncLabel }}</span>
      <span class="grow"></span>
      <button
        data-testid="sync-now"
        :disabled="syncStatus.state === 'syncing'"
        @click="syncNow"
      >
        Sync now
      </button>
      <button
        v-if="
          !props.account.isSignedIn || syncStatus.state === 'sign-in-required'
        "
        class="primary"
        data-testid="sign-in-again"
        @click="emit('signIn')"
      >
        Sign in to synchronise
      </button>
      <button v-if="props.account.isSignedIn" @click="emit('changeWorkspace')">
        Change church
      </button>
      <span class="muted">{{ props.account.displayName }}</span>
      <button @click="signOut">Sign out</button>
    </header>

    <aside class="library">
      <input
        v-model="search"
        type="search"
        placeholder="Search songs"
        data-testid="library-search"
      />
      <button data-testid="new-song" @click="editing = 'new'">New song</button>
      <ul>
        <li
          v-for="song in songs"
          :key="song.id"
          :class="{ selected: selectedSong?.id === song.id }"
          :data-testid="`library-song-${song.title}`"
          @click="selectSong(song.id)"
        >
          {{ song.title }}
          <span v-if="song.artist" class="muted">— {{ song.artist }}</span>
        </li>
        <li v-if="songs.length === 0" class="muted empty">No songs yet.</li>
      </ul>
    </aside>

    <main class="content">
      <SongEditor
        v-if="editing"
        :key="editing === 'new' ? 'new' : selectedSong?.id"
        :song="editing === 'existing' ? selectedSong : null"
        @saved="onSaved"
        @cancel="editing = null"
      />
      <template v-else-if="selectedSong">
        <div class="row">
          <h2 class="grow">{{ selectedSong.title }}</h2>
          <select
            v-model="arrangementId"
            aria-label="Arrangement"
            data-testid="arrangement-select"
            @change="($event.target as HTMLSelectElement).blur()"
          >
            <option
              v-for="arrangement in selectedSong.arrangements"
              :key="arrangement.id"
              :value="arrangement.id"
            >
              {{ arrangement.name }}
            </option>
          </select>
          <button @click="editing = 'existing'">Edit</button>
          <button class="live" data-testid="go-live" @click="goLive">
            Go live
          </button>
        </div>
        <ol class="preview">
          <li v-for="(slide, index) in previewSlides" :key="index">
            <span class="muted">{{ slide.sectionLabel }}</span>
            <span class="text">{{ slide.text }}</span>
          </li>
        </ol>
      </template>
      <p v-else class="muted">Choose a song from the library.</p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 18rem 1fr;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    'bar bar'
    'library content';
  height: 100%;
}

.bar {
  grid-area: bar;
  padding: 0.6rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.grow {
  flex: 1;
}

.library {
  grid-area: library;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 0.5rem;
  padding: 0.75rem;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.library ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}

.library li {
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.library li.selected {
  background: #e3ebf3;
}

.library li.empty {
  cursor: default;
}

.content {
  grid-area: content;
  padding: 1rem 1.5rem;
  overflow: auto;
}

.preview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.6rem;
  padding: 0;
  list-style: none;
}

.preview li {
  background: #111;
  color: #fff;
  border-radius: 6px;
  padding: 0.8rem;
  display: grid;
  gap: 0.3rem;
  min-height: 5rem;
}

.text {
  white-space: pre-line;
  text-align: center;
}
</style>
