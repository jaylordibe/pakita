<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type {
  AppState,
  AvailableUpdate,
  LiveState,
} from '../../shared/ipc-contract';
import { DEFAULT_THEME_LOOK } from '../../shared/theme-look';
import LivePanel from './components/LivePanel.vue';
import ConnectView from './views/ConnectView.vue';
import MainView from './views/MainView.vue';
import SignInView from './views/SignInView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

type Screen = 'loading' | 'connect' | 'sign-in' | 'workspace' | 'main';

const state = ref<AppState | null>(null);
const screen = ref<Screen>('loading');
const isChangingServer = ref(false);
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
      Pakita {{ update.version }} is available.
      <button @click="openUpdate">Download</button>
      <button aria-label="Dismiss" @click="update = null">✕</button>
    </p>
    <div class="screen">
      <p v-if="screen === 'loading'" class="muted card">Loading…</p>
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
      <WorkspaceView
        v-else-if="screen === 'workspace'"
        :can-go-back="canGoBack"
        @selected="refresh"
        @back="screen = 'main'"
      />
      <MainView
        v-else-if="screen === 'main' && state?.account"
        :account="state.account"
        :workspace-id="state.workspaceId ?? ''"
        @signed-out="refresh"
        @sign-in="screen = 'sign-in'"
        @state-changed="refresh"
        @change-workspace="screen = 'workspace'"
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
}

.update {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 1rem;
  background: #e3ebf3;
  border-bottom: 1px solid var(--border);
}

.screen {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
