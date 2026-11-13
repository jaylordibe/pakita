<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type {
  AppState,
  AvailableUpdate,
  LiveState,
} from '../../shared/ipc-contract';
import { DEFAULT_THEME_LOOK } from '../../shared/theme-look';
import pakitaMark from './assets/pakita-mark.png';
import AppIcon from './components/AppIcon.vue';
import LivePanel from './components/LivePanel.vue';
import ChangePasswordView from './views/ChangePasswordView.vue';
import ConnectView from './views/ConnectView.vue';
import MainView from './views/MainView.vue';
import SignInView from './views/SignInView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

type Screen =
  | 'loading'
  | 'connect'
  | 'sign-in'
  | 'change-password'
  | 'workspace'
  | 'main';

const state = ref<AppState | null>(null);
const screen = ref<Screen>('loading');
const isChangingServer = ref(false);
// The operator asked for the church list ("Change church"): show it even
// when there is only one church.
const isChurchListRequested = ref(false);
const liveState = ref<LiveState>({
  isLive: false,
  title: null,
  slides: [],
  index: 0,
  isBlackout: false,
  look: DEFAULT_THEME_LOOK,
  projector: 'off',
});

// A laptop that already holds an account's content opens straight into the
// library — signed in or not, online or not — so a service can be presented
// with no network at all.
function screenFor(appState: AppState): Screen {
  if (!appState.serverOrigin || isChangingServer.value) return 'connect';
  if (!appState.account) return 'sign-in';
  // A password an administrator chose: the server answers nothing else
  // until the person picks their own.
  if (appState.account.isSignedIn && appState.account.isPasswordChangeRequired)
    return 'change-password';
  if (!appState.workspaceId) {
    // Choosing a workspace needs the server, and so a live session.
    return appState.account.isSignedIn ? 'workspace' : 'sign-in';
  }
  return 'main';
}

// From sign-in or the church list, the operator can always return to a
// library the laptop already holds.
const canGoBack = computed(() =>
  Boolean(state.value?.account && state.value.workspaceId),
);

// The live controls stay on screen whatever else the operator opens, so a
// presentation can always be driven and stopped.
const isLivePanelShown = computed(
  () => screen.value === 'main' || liveState.value.isLive,
);

function showChurchList(): void {
  isChurchListRequested.value = true;
  screen.value = 'workspace';
}

function backToLibrary(): void {
  isChurchListRequested.value = false;
  screen.value = 'main';
}

async function onChurchSelected(): Promise<void> {
  isChurchListRequested.value = false;
  await refresh();
}

async function refresh(): Promise<void> {
  state.value = await window.pakita.app.getState();
  screen.value = screenFor(state.value);
}

function changeServer(): void {
  isChangingServer.value = true;
  screen.value = 'connect';
}

async function onConnected(): Promise<void> {
  isChangingServer.value = false;
  await refresh();
}

const update = ref<AvailableUpdate | null>(null);
const openUpdate = () => void window.pakita.app.openUpdate();

let unsubscribe: (() => void) | null = null;
let unsubscribeUpdate: (() => void) | null = null;
onMounted(async () => {
  unsubscribe = window.pakita.live.onState((live) => {
    liveState.value = live;
  });
  unsubscribeUpdate = window.pakita.app.onUpdateAvailable((available) => {
    update.value = available;
  });
  update.value = await window.pakita.app.getUpdate();
  liveState.value = await window.pakita.live.getState();
  await refresh();
});
onUnmounted(() => {
  unsubscribe?.();
  unsubscribeUpdate?.();
});
</script>

<template>
  <div class="app">
    <p v-if="update" class="update" role="status" data-testid="update-banner">
      <AppIcon name="sparkle" class="update-icon" />
      <span class="grow">Pakita {{ update.version }} is available.</span>
      <button class="sm primary" @click="openUpdate">
        <AppIcon name="download" />
        Download
      </button>
      <button
        class="sm ghost icon-only"
        aria-label="Dismiss"
        @click="update = null"
      >
        <AppIcon name="x" />
      </button>
    </p>
    <div class="screen">
      <div v-if="screen === 'loading'" class="loading">
        <img :src="pakitaMark" alt="" width="56" height="56" />
        <p class="muted">Loading…</p>
      </div>
      <ConnectView
        v-else-if="screen === 'connect'"
        :initial-address="state?.serverOrigin ?? null"
        @connected="onConnected"
      />
      <SignInView
        v-else-if="screen === 'sign-in'"
        :server-origin="state?.serverOrigin ?? ''"
        :can-go-back="canGoBack"
        @signed-in="refresh"
        @change-server="changeServer"
        @back="screen = 'main'"
      />
      <ChangePasswordView
        v-else-if="screen === 'change-password' && state?.account"
        :account="state.account"
        @changed="refresh"
        @signed-out="refresh"
      />
      <WorkspaceView
        v-else-if="screen === 'workspace'"
        :can-go-back="canGoBack"
        :opens-only-church="!isChurchListRequested"
        @selected="onChurchSelected"
        @back="backToLibrary"
      />
      <MainView
        v-else-if="screen === 'main' && state?.account"
        :account="state.account"
        :workspace-id="state.workspaceId ?? ''"
        @signed-out="refresh"
        @sign-in="screen = 'sign-in'"
        @state-changed="refresh"
        @change-workspace="showChurchList"
      />
    </div>
    <LivePanel v-if="isLivePanelShown" :state="liveState" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.update {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.75rem 0.45rem 1rem;
  font-weight: 500;
  color: var(--text);
  background:
    linear-gradient(90deg, rgb(122 77 255 / 0.22), rgb(34 211 238 / 0.1)),
    var(--canvas);
  border-bottom: 1px solid var(--border);
}

.update-icon {
  color: var(--brand-cyan);
}

.screen {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.loading {
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1rem;
}

.loading img {
  animation: breathe 1.6s var(--ease-out) infinite alternate;
  filter: drop-shadow(0 12px 28px rgb(98 72 255 / 0.55));
}

@keyframes breathe {
  from {
    opacity: 0.55;
    transform: scale(0.96);
  }
}
</style>
