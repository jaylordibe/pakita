<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type {
  AccountCapabilities,
  AccountSummary,
} from '../../../shared/ipc-contract';
import AccountsPanel from '../components/AccountsPanel.vue';
import AppIcon, { type IconName } from '../components/AppIcon.vue';
import AppShell from '../components/AppShell.vue';
import ChurchesPanel from '../components/ChurchesPanel.vue';
import ServerBiblePanel from '../components/ServerBiblePanel.vue';
import { messageOf } from '../errors';

// The Server screen: where the server's staff (a platform role) land instead
// of a church. They run the server and never belong to a church, so it shows
// no library — only the administration their role allows.

const props = defineProps<{
  account: AccountSummary;
  capabilities: AccountCapabilities;
}>();
const emit = defineEmits<{ signedOut: [] }>();

type Tab = 'churches' | 'people' | 'bible';
const TABS = computed(() => {
  const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [];
  if (props.capabilities.canManageChurches) {
    tabs.push({ id: 'churches', label: 'Churches', icon: 'church' });
  }
  if (props.capabilities.canManageAccounts) {
    tabs.push({ id: 'people', label: 'People', icon: 'key' });
  }
  if (props.capabilities.canImportBibles) {
    tabs.push({ id: 'bible', label: 'Bible', icon: 'bible' });
  }
  return tabs;
});
const tab = ref<Tab>('churches');
const errorMessage = ref<string | null>(null);

async function signOut(): Promise<void> {
  if ((await window.pakita.live.getState()).isLive) {
    errorMessage.value = 'Stop presenting before signing out.';
    return;
  }
  try {
    await window.pakita.account.signOut();
    emit('signedOut');
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

onMounted(() => {
  tab.value = TABS.value[0]?.id ?? 'churches';
});
</script>

<template>
  <AppShell
    subtitle="Server"
    :tabs="TABS"
    :active-tab="tab"
    :display-name="props.account.displayName"
    @select="tab = $event"
  >
    <template #account-actions>
      <button
        class="ghost sm icon-only"
        title="Sign out"
        data-testid="sign-out"
        @click="signOut"
      >
        <AppIcon name="log-out" />
        <span class="visually-hidden">Sign out</span>
      </button>
    </template>

    <p v-if="errorMessage" class="error" role="alert">
      <AppIcon name="alert" />
      <span>{{ errorMessage }}</span>
    </p>
    <template v-if="TABS.length > 0">
      <ChurchesPanel v-if="tab === 'churches'" />
      <AccountsPanel v-else-if="tab === 'people'" />
      <ServerBiblePanel v-else-if="tab === 'bible'" />
    </template>
    <div v-else class="panel single">
      <main class="panel-content">
        <div class="empty" data-testid="server-staff-note">
          <span class="empty-mark"><AppIcon name="info" /></span>
          <p>
            Your account looks after this church server. Your tools — job
            diagnostics and account support — are on the server itself, not in
            this app. To present at a church, sign in with your church account.
          </p>
        </div>
      </main>
    </div>
  </AppShell>
</template>
