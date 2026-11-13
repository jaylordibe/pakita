<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  AccountCapabilities,
  AccountSummary,
  Song,
  SongSummary,
  SyncStatus,
  WorkspaceSummary,
} from '../../../shared/ipc-contract';
import { buildSongSlides } from '../../../shared/slides';
import AddToPlaylist from '../components/AddToPlaylist.vue';
import AppIcon, { type IconName } from '../components/AppIcon.vue';
import AppShell from '../components/AppShell.vue';
import BiblePanel from '../components/BiblePanel.vue';
import CopyToWorkspace from '../components/CopyToWorkspace.vue';
import InvitationsPanel from '../components/InvitationsPanel.vue';
import PlaylistsPanel from '../components/PlaylistsPanel.vue';
import SongEditor from '../components/SongEditor.vue';
import ThemesPanel from '../components/ThemesPanel.vue';
import { messageOf } from '../errors';

const props = defineProps<{ account: AccountSummary; workspaceId: string }>();
const emit = defineEmits<{
  signedOut: [];
  signIn: [];
  changeWorkspace: [];
  stateChanged: [];
}>();

// The person's other churches, for copying songs (needs the server), and
// this church's name for the sidebar (unknown offline).
const otherWorkspaces = ref<WorkspaceSummary[]>([]);
const churchName = ref<string | null>(null);
async function loadOtherWorkspaces(): Promise<void> {
  if (!props.account.isSignedIn) return;
  try {
    const workspaces = await window.pakita.workspaces.list();
    churchName.value =
      workspaces.find((workspace) => workspace.id === props.workspaceId)
        ?.name ?? null;
    otherWorkspaces.value = workspaces.filter(
      (workspace) => workspace.id !== props.workspaceId,
    );
  } catch {
    // Offline: copying is not offered until the next time this view opens.
  }
}

type Tab = 'songs' | 'bible' | 'playlists' | 'themes' | 'members';
const CONTENT_TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> =
  [
    { id: 'songs', label: 'Songs', icon: 'songs' },
    { id: 'bible', label: 'Bible', icon: 'bible' },
    { id: 'playlists', label: 'Playlists', icon: 'playlists' },
    { id: 'themes', label: 'Themes', icon: 'themes' },
  ];

// Administration, offered only to whoever may do it (the server checks every
// request anyway). Unknown offline, so hidden until the server answers.
const capabilities = ref<AccountCapabilities | null>(null);
const TABS = computed(() => [
  ...CONTENT_TABS,
  ...(capabilities.value?.canInviteMembers
    ? [{ id: 'members' as const, label: 'People', icon: 'people' as const }]
    : []),
]);
async function loadCapabilities(): Promise<void> {
  if (!props.account.isSignedIn) return;
  capabilities.value = await window.pakita.account.getCapabilities();
}
const tab = ref<Tab>('songs');
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

// The selected song in its chosen arrangement, as a playlist entry.
const songEntry = computed(() => {
  const song = selectedSong.value;
  if (!song) return null;
  const arrangement = song.arrangements.find(
    (candidate) => candidate.id === arrangementId.value,
  );
  return {
    kind: 'song' as const,
    songId: song.id,
    ...(arrangement && !arrangement.isDefault
      ? { arrangementName: arrangement.name }
      : {}),
  };
});

const syncLabel = computed(() => {
  const status = syncStatus.value;
  const last = status.lastSyncedAt
    ? `Synchronised ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
    : 'Not synchronised yet';
  if (status.state === 'syncing') return 'Synchronising…';
  if (status.message) return `${status.message} (${last})`;
  return last;
});

// How the sidebar's status light reads: working, fine, or needs a look.
const syncTone = computed(() => {
  const status = syncStatus.value;
  if (status.state === 'syncing') return 'busy';
  if (status.state === 'idle' && !status.message && status.lastSyncedAt) {
    return 'ok';
  }
  if (status.state === 'idle' && !status.message) return 'idle';
  return 'attention';
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

// For a laptop whose copy seems wrong: everything is downloaded again, and
// the current copy stays presentable until the new one is complete.
async function rebuild(): Promise<void> {
  errorMessage.value = null;
  try {
    syncStatus.value = await window.pakita.sync.rebuild();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
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
// Inviting is granted per church: ask again when another church opens, and
// leave a tab this church does not offer.
watch(
  () => props.workspaceId,
  async () => {
    await loadCapabilities();
    if (!TABS.value.some((item) => item.id === tab.value)) tab.value = 'songs';
  },
);

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
  void loadOtherWorkspaces();
  void loadCapabilities();
});
onUnmounted(() => unsubscribes.forEach((unsubscribe) => unsubscribe()));
</script>

<template>
  <AppShell
    :subtitle="churchName"
    :tabs="TABS"
    :active-tab="tab"
    :display-name="props.account.displayName"
    @select="tab = $event"
  >
    <template #status>
      <section class="sync" aria-label="Synchronisation">
        <p class="sync-line" :title="syncLabel">
          <span class="light" :class="syncTone" aria-hidden="true"></span>
          <span class="label" data-testid="sync-status">{{ syncLabel }}</span>
        </p>
        <div class="sync-actions">
          <button
            class="sm"
            data-testid="sync-now"
            :disabled="syncStatus.state === 'syncing'"
            title="Sync now"
            @click="syncNow"
          >
            <AppIcon
              name="sync"
              :class="{ spinning: syncStatus.state === 'syncing' }"
            />
            <span class="label">Sync now</span>
          </button>
          <button
            v-if="props.account.isSignedIn"
            class="sm ghost"
            data-testid="sync-rebuild"
            title="Download this church's content again"
            :disabled="syncStatus.state === 'syncing'"
            @click="rebuild"
          >
            <AppIcon name="download" />
            <span class="label">Re-download all</span>
          </button>
        </div>
        <button
          v-if="
            !props.account.isSignedIn || syncStatus.state === 'sign-in-required'
          "
          class="primary sm sign-in"
          data-testid="sign-in-again"
          title="Sign in to synchronise"
          @click="emit('signIn')"
        >
          <AppIcon name="sync" />
          <span class="label">Sign in to synchronise</span>
        </button>
      </section>
    </template>
    <template #account-actions>
      <button
        v-if="props.account.isSignedIn"
        class="ghost sm icon-only"
        title="Change church"
        @click="emit('changeWorkspace')"
      >
        <AppIcon name="church" />
        <span class="visually-hidden">Change church</span>
      </button>
      <button class="ghost sm icon-only" title="Sign out" @click="signOut">
        <AppIcon name="log-out" />
        <span class="visually-hidden">Sign out</span>
      </button>
    </template>

    <div class="workspace">
      <BiblePanel v-if="tab === 'bible'" />
      <PlaylistsPanel v-else-if="tab === 'playlists'" />
      <ThemesPanel v-else-if="tab === 'themes'" />
      <InvitationsPanel v-else-if="tab === 'members'" />
      <div v-else class="panel">
        <aside class="panel-list">
          <div class="panel-head">
            <h1>Songs</h1>
            <button
              class="sm primary"
              data-testid="new-song"
              @click="editing = 'new'"
            >
              <AppIcon name="plus" />
              New song
            </button>
          </div>
          <div class="search-field">
            <AppIcon name="search" />
            <input
              v-model="search"
              type="search"
              placeholder="Search songs"
              aria-label="Search songs"
              data-testid="library-search"
            />
          </div>
          <ul class="list">
            <li v-for="song in songs" :key="song.id">
              <button
                class="list-item"
                :aria-current="
                  selectedSong?.id === song.id ? 'true' : undefined
                "
                :data-testid="`library-song-${song.title}`"
                @click="selectSong(song.id)"
              >
                <span class="item-title">{{ song.title }}</span>
                <span v-if="song.artist" class="item-sub">{{
                  song.artist
                }}</span>
              </button>
            </li>
            <li v-if="songs.length === 0" class="list-empty">No songs yet.</li>
          </ul>
        </aside>

        <main class="panel-content">
          <SongEditor
            v-if="editing"
            :key="editing === 'new' ? 'new' : selectedSong?.id"
            :song="editing === 'existing' ? selectedSong : null"
            @saved="onSaved"
            @cancel="editing = null"
          />
          <template v-else-if="selectedSong">
            <div class="page-head">
              <div class="titles">
                <h2>{{ selectedSong.title }}</h2>
                <p v-if="selectedSong.artist">{{ selectedSong.artist }}</p>
              </div>
              <button class="go-live" data-testid="go-live" @click="goLive">
                <AppIcon name="play" />
                Go live
              </button>
            </div>
            <div class="toolbar">
              <label class="inline">
                <span class="muted">Arrangement</span>
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
              </label>
              <span class="grow"></span>
              <AddToPlaylist :entry="songEntry" />
              <CopyToWorkspace
                :key="selectedSong.id"
                :song-id="selectedSong.id"
                :workspaces="otherWorkspaces"
              />
              <button @click="editing = 'existing'">
                <AppIcon name="pencil" />
                Edit
              </button>
            </div>
            <p v-if="errorMessage" class="error" role="alert">
              <AppIcon name="alert" />
              <span>{{ errorMessage }}</span>
            </p>
            <ol class="slides">
              <li v-for="(slide, index) in previewSlides" :key="index">
                <span class="slide-label">
                  <span>{{ slide.sectionLabel }}</span>
                  <span class="slide-number">{{ index + 1 }}</span>
                </span>
                <span class="slide-text">{{ slide.text }}</span>
              </li>
            </ol>
          </template>
          <div v-else class="empty">
            <span class="empty-mark"><AppIcon name="songs" /></span>
            <p>Choose a song from the library.</p>
          </div>
          <p v-if="errorMessage && !selectedSong" class="error" role="alert">
            <AppIcon name="alert" />
            <span>{{ errorMessage }}</span>
          </p>
        </main>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
/* ---------- Sidebar: synchronisation ---------- */

.sync {
  display: grid;
  gap: 0.55rem;
  margin-bottom: 0.4rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--canvas);
}

.sync-line {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--text-muted);
}

.light {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.3rem;
  border-radius: 50%;
  background: var(--text-faint);
}

.light.ok {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.light.busy {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.light.attention {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.sync-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.sync-actions button {
  flex: 1 1 auto;
}

.spinning {
  animation: spin 1s linear infinite;
}

/* A narrow window: the shell drops the words; the sync box narrows to icons. */
@media (max-width: 1100px) {
  .sync-actions button,
  .sign-in {
    width: 2.6rem;
    padding: 0;
    justify-content: center;
  }

  .sync {
    padding: 0.5rem 0;
    border: none;
    background: none;
    justify-items: center;
  }

  .sync-line {
    justify-content: center;
  }

  .sync-actions {
    flex-direction: column;
  }
}

/* ---------- Content ---------- */

.workspace {
  /* Fills the shell's content area, so every panel runs the full height. */
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-bottom: 1.25rem;
  margin-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}

.slides {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.slides li {
  position: relative;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  padding: 2rem 1.1rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background:
    radial-gradient(
      ellipse at 50% 120%,
      rgb(77 98 255 / 0.12),
      transparent 60%
    ),
    #05050c;
  color: #fff;
  overflow: hidden;
  transition:
    border-color 160ms var(--ease-out),
    transform 200ms var(--ease-out);
}

.slides li:hover {
  border-color: var(--border-strong);
}

.slide-label {
  position: absolute;
  inset: 0.6rem 0.65rem auto;
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}

.slide-number {
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}

.slide-text {
  font-size: 0.85rem;
  font-weight: 500;
  line-height: 1.4;
  text-align: center;
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.page-head + .toolbar {
  margin-top: -0.4rem;
}

.error {
  margin-bottom: 1rem;
}

@keyframes pulse {
  50% {
    box-shadow: 0 0 0 5px var(--accent-soft);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
