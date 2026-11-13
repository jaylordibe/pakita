<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { WorkspaceSummary } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

defineProps<{ canGoBack: boolean }>();
const emit = defineEmits<{ selected: [workspaceId: string]; back: [] }>();

const workspaces = ref<WorkspaceSummary[] | null>(null);
const errorMessage = ref<string | null>(null);
const isBusy = ref(false);
const newName = ref('');

async function create(): Promise<void> {
  if (newName.value.trim().length < 2) return;
  errorMessage.value = null;
  isBusy.value = true;
  try {
    const workspace = await window.pakita.workspaces.create(newName.value);
    isBusy.value = false;
    await select(workspace.id);
  } catch (error) {
    errorMessage.value = messageOf(error);
    isBusy.value = false;
  }
}

onMounted(async () => {
  try {
    workspaces.value = await window.pakita.workspaces.list();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
});

async function select(workspaceId: string): Promise<void> {
  isBusy.value = true;
  try {
    await window.pakita.workspaces.select(workspaceId);
    emit('selected', workspaceId);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <div class="card">
    <h1>Choose your church</h1>
    <p v-if="workspaces === null && !errorMessage" class="muted">Loading…</p>
    <p v-else-if="workspaces?.length === 0" class="muted">
      Your account does not belong to a church yet. Create one below, or ask
      your church's administrator to add you.
    </p>
    <button
      v-for="workspace in workspaces ?? []"
      :key="workspace.id"
      :data-testid="`workspace-${workspace.slug}`"
      :disabled="isBusy"
      @click="select(workspace.id)"
    >
      {{ workspace.name }}
    </button>
    <form class="row" @submit.prevent="create">
      <input
        v-model="newName"
        minlength="2"
        maxlength="120"
        placeholder="New church’s name"
        aria-label="New church's name"
        data-testid="workspace-new-name"
      />
      <button type="submit" :disabled="isBusy" data-testid="workspace-create">
        Create church
      </button>
    </form>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    <button v-if="canGoBack" type="button" @click="emit('back')">
      Back to the library
    </button>
  </div>
</template>
