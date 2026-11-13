<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';

import type {
  BibleImportPreview,
  BibleImportProgress,
} from '../../../shared/ipc-contract';
import { apiConstraints } from '../../../shared/api/constraints';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// The longest value the server accepts for each field.
const limits = apiConstraints.CreateBibleTranslationDto;

const props = defineProps<{
  /** Short names of the translations this laptop already holds. */
  existingCodes: readonly string[];
}>();
const emit = defineEmits<{
  imported: [translation: { code: string; name: string }];
  close: [];
}>();

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

const errorElement = ref<HTMLElement | null>(null);
const isCodeTaken = computed(() =>
  props.existingCodes.includes(form.code.trim().toUpperCase()),
);

/** Shows the error where the person is looking, even below the fold. */
async function showError(error: unknown): Promise<void> {
  errorMessage.value = messageOf(error);
  await nextTick();
  errorElement.value?.scrollIntoView({ block: 'nearest' });
}

const isSuggested = computed(
  () => Object.keys(preview.value?.suggested ?? {}).length > 0,
);

async function chooseFolder(): Promise<void> {
  errorMessage.value = null;
  try {
    const chosen = await window.pakita.bible.chooseImportFolder();
    if (!chosen) return;
    preview.value = chosen;
    // Fill in what the folder states; keep what it does not.
    for (const detail of Object.keys(form) as Array<keyof typeof form>) {
      form[detail] = chosen.suggested[detail] ?? form[detail];
    }
  } catch (error) {
    await showError(error);
  }
}

async function submit(): Promise<void> {
  errorMessage.value = null;
  isImporting.value = true;
  progress.value = null;
  try {
    await window.pakita.bible.import({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      languageCode: form.languageCode.trim(),
      licence: form.licence.trim(),
      attribution: form.attribution.trim(),
      sourceUrl: form.sourceUrl.trim() || null,
    });
    emit('imported', {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
    });
  } catch (error) {
    await showError(error);
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
      <p
        v-if="isSuggested"
        class="wide suggested muted"
        data-testid="bible-import-suggested"
      >
        <AppIcon name="check" class="ok" />
        <span>
          Filled in from the folder’s copyright page. Check them, then import.
        </span>
      </p>
      <label>
        Short name
        <input
          v-model="form.code"
          required
          placeholder="WEB"
          aria-describedby="bible-import-code-help"
          data-testid="bible-import-code"
        />
        <span
          v-if="isCodeTaken"
          id="bible-import-code-help"
          class="field-help taken"
          data-testid="bible-import-code-taken"
        >
          {{ form.code.trim().toUpperCase() }} is already published. Give this
          translation another short name to import it as well.
        </span>
        <span v-else id="bible-import-code-help" class="field-help">
          A few letters or digits for the translation picker, e.g. WEB or KJV.
        </span>
      </label>
      <label>
        Full name
        <input
          v-model="form.name"
          required
          :maxlength="limits.name.maxLength"
          placeholder="World English Bible"
          aria-describedby="bible-import-name-help"
          data-testid="bible-import-name"
        />
        <span id="bible-import-name-help" class="field-help">
          The translation’s name, as its publisher writes it.
        </span>
      </label>
      <label>
        Language
        <input
          v-model="form.languageCode"
          required
          :maxlength="limits.languageCode.maxLength"
          placeholder="en"
          aria-describedby="bible-import-language-help"
          data-testid="bible-import-language"
        />
        <span id="bible-import-language-help" class="field-help">
          A language code: en for English, tl for Tagalog, ceb for Cebuano.
        </span>
      </label>
      <label>
        On-screen credit
        <input
          v-model="form.attribution"
          required
          :maxlength="limits.attribution.maxLength"
          placeholder="World English Bible (Public Domain)"
          aria-describedby="bible-import-attribution-help"
          data-testid="bible-import-attribution"
        />
        <span id="bible-import-attribution-help" class="field-help">
          Shown small under every verse: “John 3:16 · World English Bible
          (Public Domain)”.
        </span>
      </label>
      <label class="wide">
        Licence
        <textarea
          v-model="form.licence"
          required
          :maxlength="limits.licence.maxLength"
          rows="3"
          placeholder="Public Domain"
          aria-describedby="bible-import-licence-help"
          data-testid="bible-import-licence"
        ></textarea>
        <span id="bible-import-licence-help" class="field-help">
          What the publisher allows, kept with the translation for reference.
        </span>
      </label>
      <label class="wide">
        Source (optional)
        <input
          v-model="form.sourceUrl"
          type="url"
          :maxlength="limits.sourceUrl.maxLength"
          placeholder="https://ebible.org/…"
          aria-describedby="bible-import-source-help"
          data-testid="bible-import-source"
        />
        <span id="bible-import-source-help" class="field-help">
          The page the translation was downloaded from.
        </span>
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
    <p
      v-if="errorMessage"
      ref="errorElement"
      class="error"
      role="alert"
      data-testid="bible-import-error"
    >
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

.suggested {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.85rem;
}

.taken {
  color: var(--danger);
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
