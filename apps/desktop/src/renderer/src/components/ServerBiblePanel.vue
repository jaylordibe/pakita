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
const selectedId = ref<string | null>(null);
const isImportShown = ref(false);
const isImportRunning = ref(false);
// Each opening starts a fresh form, even over one already open.
const importFormKey = ref(0);
const notice = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

const existingCodes = computed(() =>
  translations.value.map((translation) => translation.code),
);

const selected = computed(
  () =>
    translations.value.find(
      (translation) => translation.id === selectedId.value,
    ) ?? null,
);

const publishedOn = computed(() =>
  selected.value
    ? new Date(selected.value.publishedAt).toLocaleDateString(undefined, {
        dateStyle: 'long',
      })
    : '',
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

function open(translation: ServerBibleTranslation): void {
  notice.value = null;
  isImportShown.value = false;
  selectedId.value = translation.id;
}

function openImport(): void {
  notice.value = null;
  selectedId.value = null;
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
  selectedId.value =
    translations.value.find((translation) => translation.code === imported.code)
      ?.id ?? null;
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
          <button
            class="list-item"
            :aria-current="translation.id === selectedId ? 'true' : undefined"
            @click="open(translation)"
          >
            <span class="item-title">{{ translation.name }}</span>
            <span class="item-sub"
              >{{ translation.code }} · {{ translation.languageCode }}</span
            >
          </button>
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
      <template v-else-if="selected">
        <div class="page-head">
          <div class="titles">
            <h2 data-testid="server-bible-title">{{ selected.name }}</h2>
            <p>{{ selected.code }} · {{ selected.languageCode }}</p>
          </div>
        </div>
        <p
          v-if="notice"
          class="notice"
          role="status"
          data-testid="bible-imported"
        >
          <AppIcon name="check" />
          <span>{{ notice }}</span>
        </p>
        <dl class="facts" data-testid="server-bible-details">
          <dt>Verses</dt>
          <dd>{{ selected.verseCount.toLocaleString() }}</dd>
          <dt>Published</dt>
          <dd>{{ publishedOn }}</dd>
          <dt>Attribution</dt>
          <dd>{{ selected.attribution }}</dd>
          <dt>Licence</dt>
          <dd class="licence">{{ selected.licence }}</dd>
          <template v-if="selected.sourceUrl">
            <dt>Source</dt>
            <dd>{{ selected.sourceUrl }}</dd>
          </template>
        </dl>
        <p class="muted hint">
          Every church on this server has this translation. A published
          translation cannot be changed.
        </p>
      </template>

      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="bible" /></span>
        <p>
          Choose a translation, or import one from a folder of USFM files. Every
          church on this server receives it.
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

.notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  color: var(--success);
}

.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.6rem 1.5rem;
  margin: 0 0 1.5rem;
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.facts .licence {
  white-space: pre-line;
}

.hint {
  font-size: 0.82rem;
}
</style>
