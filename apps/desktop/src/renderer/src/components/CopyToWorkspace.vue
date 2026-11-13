<script setup lang="ts">
import { ref } from 'vue';

import type { WorkspaceSummary } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// Copies a song to another of the person's churches (branches), chosen from
// `workspaces` (loaded once by the main view; empty offline).
const props = defineProps<{
  songId: string;
  workspaces: readonly WorkspaceSummary[];
}>();

const message = ref<string | null>(null);
const isError = ref(false);

async function copy(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const targetId = select.value;
  select.value = '';
  select.blur();
  if (!targetId) return;
  message.value = null;
  isError.value = false;
  try {
    await window.pakita.songs.copy(props.songId, targetId);
    const target = props.workspaces.find((entry) => entry.id === targetId);
    message.value = `Copied to ${target?.name ?? 'the other church'}.`;
  } catch (error) {
    message.value = messageOf(error);
    isError.value = true;
  }
}
</script>

<template>
  <span v-if="props.workspaces.length > 0" class="picker">
    <span class="with-icon">
      <AppIcon name="copy" />
      <select
        aria-label="Copy to another church"
        data-testid="copy-to-workspace"
        @change="copy"
      >
        <option value="">Copy to another church…</option>
        <option
          v-for="workspace in props.workspaces"
          :key="workspace.id"
          :value="workspace.id"
        >
          {{ workspace.name }}
        </option>
      </select>
    </span>
    <span
      v-if="message"
      class="status-note"
      :class="{ failed: isError }"
      role="status"
    >
      <AppIcon :name="isError ? 'alert' : 'check'" />
      {{ message }}
    </span>
  </span>
</template>
