<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { AppState } from '../../shared/ipc-contract';
import ConnectView from './views/ConnectView.vue';
import MainView from './views/MainView.vue';
import SignInView from './views/SignInView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

type Screen = 'loading' | 'connect' | 'sign-in' | 'workspace' | 'main';

const state = ref<AppState | null>(null);
const screen = ref<Screen>('loading');
const isChangingServer = ref(false);

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

onMounted(refresh);
</script>

<template>
  <p v-if="screen === 'loading'" class="muted card">Loading…</p>
  <ConnectView
    v-else-if="screen === 'connect'"
    :initial-address="state?.serverOrigin ?? null"
    @connected="onConnected"
  />
  <SignInView
    v-else-if="screen === 'sign-in'"
    :server-origin="state?.serverOrigin ?? ''"
    @signed-in="refresh"
    @change-server="changeServer"
  />
  <WorkspaceView v-else-if="screen === 'workspace'" @selected="refresh" />
  <MainView
    v-else-if="screen === 'main' && state?.account"
    :account="state.account"
    @signed-out="refresh"
    @sign-in="screen = 'sign-in'"
    @state-changed="refresh"
    @change-workspace="screen = 'workspace'"
  />
</template>
