<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type {
  PlaylistItemInput,
  PlaylistSummary,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

// Appends one entry to a playlist chosen from the list (saved on the server).
const props = defineProps<{ entry: PlaylistItemInput | null }>();

const playlists = ref<PlaylistSummary[]>([]);
const message = ref<string | null>(null);

async function add(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  const playlistId = select.value;
  select.value = '';
  select.blur();
  if (!playlistId || !props.entry) return;
  message.value = null;
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
  }
}

onMounted(async () => {
  playlists.value = await window.pakita.playlists.list();
});
</script>

<template>
  <span class="row">
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
    <span v-if="message" class="muted" role="status">{{ message }}</span>
  </span>
</template>
