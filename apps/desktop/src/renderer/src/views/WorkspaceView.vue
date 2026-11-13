<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { WorkspaceSummary } from '../../../shared/ipc-contract';
import pakitaMark from '../assets/pakita-mark.png';
import AppIcon from '../components/AppIcon.vue';
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
  <div class="auth">
    <div class="card">
      <img class="card-mark" :src="pakitaMark" alt="" width="48" height="48" />
      <div class="card-head">
        <h1>Choose your church</h1>
        <p v-if="workspaces === null && !errorMessage" class="muted">
          Loading…
        </p>
        <p v-else-if="workspaces?.length === 0" class="muted">
          Your account does not belong to a church yet. Create one below, or ask
          your church's administrator to add you.
        </p>
      </div>
      <ul v-if="workspaces?.length" class="churches">
        <li v-for="workspace in workspaces" :key="workspace.id">
          <button
            class="church"
            :data-testid="`workspace-${workspace.slug}`"
            :disabled="isBusy"
            @click="select(workspace.id)"
          >
            <span class="church-icon"><AppIcon name="church" /></span>
            <span class="grow">{{ workspace.name }}</span>
            <AppIcon name="chevron-right" class="chevron" />
          </button>
        </li>
      </ul>
      <form class="create" @submit.prevent="create">
        <input
          v-model="newName"
          minlength="2"
          maxlength="120"
          placeholder="New church’s name"
          aria-label="New church's name"
          data-testid="workspace-new-name"
        />
        <button type="submit" :disabled="isBusy" data-testid="workspace-create">
          <AppIcon name="plus" />
          Create church
        </button>
      </form>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
      <button
        v-if="canGoBack"
        type="button"
        class="ghost back"
        @click="emit('back')"
      >
        <AppIcon name="arrow-left" />
        Back to the library
      </button>
    </div>
  </div>
</template>

<style scoped>
.churches {
  display: grid;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 18rem;
  overflow: auto;
}

.church {
  width: 100%;
  min-height: 3rem;
  justify-content: flex-start;
  gap: 0.75rem;
  padding: 0 0.75rem 0 0.5rem;
  text-align: left;
  font-size: 0.9rem;
  background: var(--surface);
}

.church:hover:not(:disabled) {
  background: var(--accent-softer);
  border-color: rgb(139 108 255 / 0.45);
}

.church-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 8px;
  color: #d6ccff;
  background: var(--accent-soft);
}

.chevron {
  color: var(--text-faint);
  transition: transform 160ms var(--ease-out);
}

.church:hover .chevron {
  color: var(--text);
  transform: translateX(2px);
}

.create {
  display: flex;
  gap: 0.5rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border);
}

.create input {
  flex: 1;
}

.back {
  justify-self: start;
  margin: -0.4rem 0 -0.6rem -0.6rem;
}
</style>
