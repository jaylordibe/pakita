<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';

import type {
  BibleImportPreview,
  BibleImportProgress,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

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
  <section class="card import" data-testid="bible-import">
    <div class="row">
      <h2 class="grow">Import a Bible translation</h2>
      <button :disabled="isImporting" @click="emit('close')">Close</button>
    </div>
    <p class="muted">
      Choose a folder of USFM files (for example, an unzipped download from
      eBible.org). The translation is published to everyone in this church once
      it has been imported. Only import a translation its licence lets you
      share.
    </p>
    <div class="row">
      <button
        data-testid="bible-import-choose"
        :disabled="isImporting"
        @click="chooseFolder"
      >
        Choose folder…
      </button>
      <span v-if="preview" class="muted" data-testid="bible-import-preview">
        {{ preview.folderName }}: {{ preview.bookCount }} books ({{
          preview.firstBook
        }}
        to {{ preview.lastBook }}), {{ preview.verseCount }} verses
        <template v-if="preview.skippedCodes.length > 0">
          — left out: {{ preview.skippedCodes.join(', ') }}
        </template>
      </span>
    </div>

    <form v-if="preview" class="fields" @submit.prevent="submit">
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
      <div class="row wide">
        <button
          class="primary"
          type="submit"
          :disabled="isImporting"
          data-testid="bible-import-submit"
        >
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
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.import {
  display: grid;
  gap: 0.75rem;
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem 1rem;
}

.fields label {
  display: grid;
  gap: 0.25rem;
}

.wide {
  grid-column: 1 / -1;
}

.grow {
  flex: 1;
}

textarea {
  font: inherit;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
