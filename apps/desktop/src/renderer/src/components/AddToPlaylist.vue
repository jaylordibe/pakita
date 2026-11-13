<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type {
  PlaylistItemInput,
  PlaylistSummary,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// Appends one entry to a playlist chosen from the list (saved on the server).
const props = defineProps<{ entry: PlaylistItemInput | null }>();

const playlists = ref<PlaylistSummary[]>([]);
const message = ref<string | null>(null);
const isError = ref(false);

async function add(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const playlistId = select.value;
  select.value = '';
  select.blur();
  if (!playlistId || !props.entry) return;
  message.value = null;
  isError.value = false;
  try {
    const playlist = await window.pakita.playlists.get(playlistId);
    if (!playlist) return;
    await window.pakita.playlists.update(playlistId, {
      name: playlist.name,
      serviceDate: playlist.serviceDate,
      themeId: playlist.themeId,
      items: [...playlist.entries.map((entry) => entry.input), props.entry],
      expectedSyncVersion: playlist.syncVersion,
    });
    message.value = `Added to ${playlist.name}.`;
  } catch (error) {
    message.value = messageOf(error);
    isError.value = true;
  }
}

onMounted(async () => {
  playlists.value = await window.pakita.playlists.list();
});
</script>

<template>
  <span class="picker">
    <span class="with-icon">
      <AppIcon name="list-plus" />
      <select
        aria-label="Add to playlist"
        data-testid="add-to-playlist"
        :disabled="!props.entry || playlists.length === 0"
        @change="add"
      >
        <option value="">Add to playlist…</option>
        <option
          v-for="playlist in playlists"
          :key="playlist.id"
          :value="playlist.id"
        >
          {{ playlist.name }}
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
