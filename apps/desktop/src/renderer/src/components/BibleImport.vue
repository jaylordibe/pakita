<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';

import type {
  BibleImportPreview,
  BibleImportProgress,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

const emit = defineEmits<{ imported: []; close: [] }>();

const preview = ref<BibleImportPreview | null>(null);
const progress = ref<BibleImportProgress | null>(null);
const isImporting = ref(false);
const errorMessage = ref<string | null>(null);
const form = reactive({
  code: '',
  name: '',
  languageCode: 'en',
  licence: '',
  attribution: '',
  sourceUrl: '',
});

async function chooseFolder(): Promise<void> {
  errorMessage.value = null;
  try {
    preview.value =
      (await window.pakita.bible.chooseImportFolder()) ?? preview.value;
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

async function submit(): Promise<void> {
  errorMessage.value = null;
  isImporting.value = true;
  progress.value = null;
  try {
    await window.pakita.bible.import({
      code: form.code.trim(),
      name: form.name.trim(),
      languageCode: form.languageCode.trim(),
      licence: form.licence.trim(),
      attribution: form.attribution.trim(),
      sourceUrl: form.sourceUrl.trim() || null,
    });
    emit('imported');
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isImporting.value = false;
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(() => {
  unsubscribe = window.pakita.bible.onImportProgress((update) => {
    progress.value = update;
  });
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <section class="import" data-testid="bible-import">
    <div class="page-head">
      <div class="titles">
        <h2>Import a Bible translation</h2>
      </div>
      <button class="ghost" :disabled="isImporting" @click="emit('close')">
        <AppIcon name="x" />
        Close
      </button>
    </div>
    <p class="intro muted">
      Choose a folder of USFM files (for example, an unzipped download from
      eBible.org). The translation is published to everyone in this church once
      it has been imported. Only import a translation its licence lets you
      share.
    </p>

    <div class="sheet source">
      <button
        data-testid="bible-import-choose"
        :disabled="isImporting"
        @click="chooseFolder"
      >
        <AppIcon name="folder" />
        Choose folder…
      </button>
      <span
        v-if="preview"
        class="source-summary"
        data-testid="bible-import-preview"
      >
        <AppIcon name="check" class="ok" />
        <span>
          {{ preview.folderName }}: {{ preview.bookCount }} books ({{
            preview.firstBook
          }}
          to {{ preview.lastBook }}), {{ preview.verseCount }} verses
          <template v-if="preview.skippedCodes.length > 0">
            — left out: {{ preview.skippedCodes.join(', ') }}
          </template>
        </span>
      </span>
    </div>

    <form v-if="preview" class="sheet field-grid" @submit.prevent="submit">
      <label>
        Code
        <input
          v-model="form.code"
          required
          maxlength="12"
          placeholder="WEB"
          data-testid="bible-import-code"
        />
      </label>
      <label>
        Name
        <input
          v-model="form.name"
          required
          maxlength="120"
          placeholder="World English Bible"
          data-testid="bible-import-name"
        />
      </label>
      <label>
        Language (BCP 47)
        <input
          v-model="form.languageCode"
          required
          maxlength="40"
          placeholder="en"
          data-testid="bible-import-language"
        />
      </label>
      <label>
        Shown with every passage
        <input
          v-model="form.attribution"
          required
          maxlength="200"
          placeholder="World English Bible (public domain)"
          data-testid="bible-import-attribution"
        />
      </label>
      <label class="wide">
        Licence
        <textarea
          v-model="form.licence"
          required
          maxlength="2000"
          rows="3"
          placeholder="The terms the publisher states"
          data-testid="bible-import-licence"
        ></textarea>
      </label>
      <label class="wide">
        Source (optional)
        <input
          v-model="form.sourceUrl"
          type="url"
          maxlength="500"
          placeholder="https://ebible.org/…"
        />
      </label>
      <div class="row wide submit">
        <button
          class="primary"
          type="submit"
          :disabled="isImporting"
          data-testid="bible-import-submit"
        >
          <AppIcon name="upload" />
          {{ isImporting ? 'Importing…' : 'Import and publish' }}
        </button>
        <progress
          v-if="isImporting && progress"
          :value="progress.done"
          :max="progress.total"
        ></progress>
        <span v-if="isImporting && progress" class="muted">
          {{ progress.bookName }} ({{ progress.done }} of
          {{ progress.total }} chapters)
        </span>
      </div>
    </form>
    <p v-if="errorMessage" class="error" role="alert">
      <AppIcon name="alert" />
      <span>{{ errorMessage }}</span>
    </p>
  </section>
</template>

<style scoped>
.import {
  display: grid;
  gap: 1rem;
  max-width: 46rem;
}

.import .page-head {
  margin-bottom: 0;
}

.intro {
  max-width: 65ch;
  line-height: 1.6;
}

.source {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
}

.source-summary {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.45rem;
  flex: 1 1 16rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.ok {
  margin-top: 0.1rem;
  color: var(--success);
}

.submit {
  padding-top: 0.25rem;
  gap: 0.85rem;
}
</style>
