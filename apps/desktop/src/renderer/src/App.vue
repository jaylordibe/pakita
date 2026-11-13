<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { DatabaseHealth } from '../../shared/ipc-contract';

const version = ref<string | null>(null);
const databaseHealth = ref<DatabaseHealth | null>(null);
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  try {
    version.value = await window.pakita.app.getVersion();
    databaseHealth.value = await window.pakita.database.getHealth();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <main class="shell">
    <h1>Pakita</h1>
    <p class="tagline">Simply present.</p>
    <dl>
      <dt>Version</dt>
      <dd data-testid="app-version">{{ version ?? '…' }}</dd>
      <dt>Local database</dt>
      <dd data-testid="database-health">
        <template v-if="databaseHealth">
          {{ databaseHealth.journalMode }}, schema
          {{ databaseHealth.schemaVersion }} of
          {{ databaseHealth.latestSchemaVersion }}
        </template>
        <template v-else>…</template>
      </dd>
    </dl>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.shell {
  font-family: system-ui, sans-serif;
  margin: 3rem auto;
  max-width: 40rem;
}

.tagline {
  color: #555;
}

dt {
  font-weight: 600;
}
</style>
