<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import {
  themeBackgroundValues,
  themeFontValues,
} from '../../../shared/api/enums';
import type {
  SyncStatus,
  ThemeInput,
  ThemeSummary,
} from '../../../shared/ipc-contract';
import {
  BACKGROUND_LABELS,
  DEFAULT_THEME_LOOK,
  FONT_LABELS,
} from '../../../shared/theme-look';
import { messageOf } from '../errors';
import ThemePreview from './ThemePreview.vue';

const themes = ref<ThemeSummary[]>([]);
/** The theme being edited; null for a new one. */
const themeId = ref<string | null>(null);
const isEditing = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);

const blank = (): ThemeInput => ({
  name: '',
  ...DEFAULT_THEME_LOOK,
  isDefault: false,
});
const form = reactive<ThemeInput>(blank());
const look = computed(() => ({ ...form }));

async function loadThemes(): Promise<void> {
  themes.value = await window.pakita.themes.list();
}

function startNew(): void {
  Object.assign(form, blank());
  themeId.value = null;
  isEditing.value = true;
  errorMessage.value = null;
}

async function open(id: string): Promise<void> {
  errorMessage.value = null;
  const theme = await window.pakita.themes.get(id);
  if (!theme) return;
  Object.assign(form, {
    name: theme.name,
    background: theme.background,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    font: theme.font,
    textScale: theme.textScale,
    textAlign: theme.textAlign,
    isDefault: theme.isDefault,
  });
  themeId.value = id;
  isEditing.value = true;
}

async function save(): Promise<void> {
  errorMessage.value = null;
  isSaving.value = true;
  try {
    const input = { ...form, name: form.name.trim() };
    const saved = themeId.value
      ? await window.pakita.themes.update(themeId.value, input)
      : await window.pakita.themes.create(input);
    themeId.value = saved.id;
    await loadThemes();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isSaving.value = false;
  }
}

async function remove(): Promise<void> {
  if (!themeId.value) return;
  errorMessage.value = null;
  try {
    await window.pakita.themes.delete(themeId.value);
    isEditing.value = false;
    themeId.value = null;
    await loadThemes();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(async () => {
  unsubscribe = window.pakita.sync.onStatus((status: SyncStatus) => {
    if (status.state === 'idle') void loadThemes();
  });
  await loadThemes();
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="panel">
    <aside class="list">
      <button data-testid="theme-new" @click="startNew">New theme</button>
      <ul>
        <li
          v-for="theme in themes"
          :key="theme.id"
          :class="{ selected: theme.id === themeId }"
          :data-testid="`theme-${theme.name}`"
          @click="open(theme.id)"
        >
          {{ theme.name }}
          <span v-if="theme.isDefault" class="muted">(default)</span>
        </li>
        <li v-if="themes.length === 0" class="muted empty">
          No themes yet: slides are white on black.
        </li>
      </ul>
    </aside>

    <main class="content">
      <form v-if="isEditing" class="editor" @submit.prevent="save">
        <div class="fields">
          <label class="wide">
            Name
            <input
              v-model="form.name"
              required
              maxlength="60"
              data-testid="theme-name"
            />
          </label>
          <label>
            Background
            <select v-model="form.background" data-testid="theme-background">
              <option
                v-for="background in themeBackgroundValues"
                :key="background"
                :value="background"
              >
                {{ BACKGROUND_LABELS[background] }}
              </option>
            </select>
          </label>
          <label v-if="form.background === 'solid'">
            Background colour
            <input v-model="form.backgroundColor" type="color" />
          </label>
          <label>
            Text colour
            <input
              v-model="form.textColor"
              type="color"
              data-testid="theme-text-colour"
            />
          </label>
          <label>
            Font
            <select v-model="form.font" data-testid="theme-font">
              <option v-for="font in themeFontValues" :key="font" :value="font">
                {{ FONT_LABELS[font] }}
              </option>
            </select>
          </label>
          <label>
            Text size ({{ form.textScale }}%)
            <input
              v-model.number="form.textScale"
              type="range"
              min="50"
              max="200"
              step="5"
            />
          </label>
          <label>
            Alignment
            <select v-model="form.textAlign">
              <option value="center">Centred</option>
              <option value="left">Left</option>
            </select>
          </label>
          <label class="check">
            <input
              v-model="form.isDefault"
              type="checkbox"
              data-testid="theme-default"
            />
            The church’s default theme
          </label>
        </div>
        <ThemePreview :look="look" />
        <div class="row">
          <button
            class="primary"
            type="submit"
            :disabled="isSaving"
            data-testid="theme-save"
          >
            {{ isSaving ? 'Saving…' : 'Save theme' }}
          </button>
          <button v-if="themeId" type="button" @click="remove">Delete</button>
        </div>
      </form>
      <p v-else class="muted">
        A theme sets how slides look on the projector. Choose one, or create
        one.
      </p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    </main>
  </div>
</template>

<style scoped>
.panel {
  display: grid;
  grid-template-columns: 18rem 1fr;
  height: 100%;
  min-height: 0;
}

.list {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.5rem;
  padding: 0.75rem;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}

.list li {
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.list li.selected {
  background: #e3ebf3;
}

.list li.empty {
  cursor: default;
}

.content {
  padding: 1rem 1.5rem;
  overflow: auto;
}

.editor {
  display: grid;
  gap: 1rem;
  max-width: 44rem;
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

.fields label.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.wide {
  grid-column: 1 / -1;
}
</style>
