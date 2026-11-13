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
import AppIcon from './AppIcon.vue';
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
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Themes</h1>
        <button class="sm primary" data-testid="theme-new" @click="startNew">
          <AppIcon name="plus" />
          New theme
        </button>
      </div>
      <ul class="list">
        <li v-for="theme in themes" :key="theme.id">
          <button
            class="list-item theme-item"
            :aria-current="theme.id === themeId ? 'true' : undefined"
            :data-testid="`theme-${theme.name}`"
            @click="open(theme.id)"
          >
            <span class="item-title">{{ theme.name }}</span>
            <span v-if="theme.isDefault" class="badge">
              <AppIcon name="star" />
              <span class="visually-hidden">(</span>default<span
                class="visually-hidden"
                >)</span
              >
            </span>
          </button>
        </li>
        <li v-if="themes.length === 0" class="list-empty">
          No themes yet: slides are white on black.
        </li>
      </ul>
    </aside>

    <main class="panel-content">
      <form v-if="isEditing" class="editor" @submit.prevent="save">
        <div class="page-head">
          <div class="titles">
            <h2>{{ form.name || 'New theme' }}</h2>
          </div>
          <button
            v-if="themeId"
            type="button"
            class="ghost danger"
            @click="remove"
          >
            <AppIcon name="trash" />
            Delete
          </button>
          <button
            class="primary"
            type="submit"
            :disabled="isSaving"
            data-testid="theme-save"
          >
            <AppIcon name="check" />
            {{ isSaving ? 'Saving…' : 'Save theme' }}
          </button>
        </div>

        <div class="layout">
          <div class="stage">
            <ThemePreview :look="look" />
            <p class="faint">As it appears on the projector.</p>
          </div>

          <div class="sheet field-grid">
            <label class="wide">
              Name
              <input
                v-model="form.name"
                required
                maxlength="60"
                data-testid="theme-name"
              />
            </label>
            <label :class="{ wide: form.background !== 'solid' }">
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
              Font
              <select v-model="form.font" data-testid="theme-font">
                <option
                  v-for="font in themeFontValues"
                  :key="font"
                  :value="font"
                >
                  {{ FONT_LABELS[font] }}
                </option>
              </select>
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
              Alignment
              <select v-model="form.textAlign">
                <option value="center">Centred</option>
                <option value="left">Left</option>
              </select>
            </label>
            <label>
              <span class="scale-label">
                Text size <span class="value">{{ form.textScale }}%</span>
              </span>
              <input
                v-model.number="form.textScale"
                type="range"
                min="50"
                max="200"
                step="5"
              />
            </label>
            <label class="inline wide check">
              <input
                v-model="form.isDefault"
                type="checkbox"
                data-testid="theme-default"
              />
              The church’s default theme
            </label>
          </div>
        </div>
      </form>
      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="themes" /></span>
        <p>
          A theme sets how slides look on the projector. Choose one, or create
          one.
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
.theme-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.theme-item .item-title {
  flex: 1;
}

.badge .icon {
  width: 0.7rem;
  height: 0.7rem;
}

.panel-content {
  container-type: inline-size;
}

.layout {
  display: grid;
  gap: 1.25rem;
  max-width: 48rem;
}

.stage {
  display: grid;
  gap: 0.5rem;
}

.stage p {
  font-size: 0.75rem;
}

.stage :deep(.preview) {
  box-shadow: var(--shadow);
}

/* Room for both: the preview stays in view beside the settings. */
@container (min-width: 58rem) {
  .layout {
    max-width: none;
    grid-template-columns: minmax(0, 1.35fr) minmax(19rem, 1fr);
    align-items: start;
  }

  .stage {
    position: sticky;
    top: 0;
  }
}

.scale-label {
  display: flex;
  justify-content: space-between;
}

.value {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.check {
  padding-top: 0.25rem;
}

.error {
  margin-top: 1rem;
}
</style>
