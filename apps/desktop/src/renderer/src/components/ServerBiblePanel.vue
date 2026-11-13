<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { ServerBibleTranslation } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';
import BibleImport from './BibleImport.vue';

// The server's Bible translations, for its administrator. A translation is
// shared by every church on the server; each church's laptops receive it when
// they next synchronise. Listed from the server itself: the administrator's
// laptop holds no church, so it keeps no copy.

const translations = ref<ServerBibleTranslation[]>([]);
const isImportShown = ref(false);
const isImportRunning = ref(false);
// Each opening starts a fresh form, even over one already open.
const importFormKey = ref(0);
const notice = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

const existingCodes = computed(() =>
  translations.value.map((translation) => translation.code),
);

async function load(): Promise<void> {
  try {
    translations.value = (
      await window.pakita.bible.listServerTranslations()
    ).sort((first, second) => first.name.localeCompare(second.name));
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

function openImport(): void {
  notice.value = null;
  importFormKey.value += 1;
  isImportShown.value = true;
}

async function onImported(imported: {
  code: string;
  name: string;
}): Promise<void> {
  isImportShown.value = false;
  isImportRunning.value = false;
  await load();
  notice.value = `${imported.name} is imported and published. Every church receives it when its laptops next synchronise.`;
}

onMounted(load);
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Bible</h1>
      </div>
      <ul class="list">
        <li
          v-for="translation in translations"
          :key="translation.id"
          :data-testid="`server-bible-${translation.code}`"
        >
          <span class="list-item static">
            <span class="item-title">{{ translation.name }}</span>
            <span class="item-sub"
              >{{ translation.code }} · {{ translation.languageCode }}</span
            >
          </span>
        </li>
        <li v-if="translations.length === 0" class="list-empty">
          No translation is published yet.
        </li>
      </ul>
      <button
        class="import-open"
        data-testid="bible-import-open"
        :disabled="isImportRunning"
        @click="openImport"
      >
        <AppIcon name="upload" />
        Import a translation…
      </button>
    </aside>

    <main class="panel-content">
      <BibleImport
        v-if="isImportShown"
        :key="importFormKey"
        :existing-codes="existingCodes"
        @importing="isImportRunning = $event"
        @imported="onImported"
        @close="isImportShown = false"
      />
      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="bible" /></span>
        <p v-if="notice" role="status" data-testid="bible-imported">
          {{ notice }}
        </p>
        <p v-else>
          Import a translation from a folder of USFM files. Every church on this
          server receives it.
        </p>
      </div>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.import-open {
  border-style: dashed;
  background: transparent;
  color: var(--text-muted);
}

.import-open:hover:not(:disabled) {
  border-style: dashed;
  color: var(--text);
}

.static {
  cursor: default;
}
</style>
