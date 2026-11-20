<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import {
  themeBackgroundValues,
  themeFontValues,
} from '../../../shared/api/enums';
import type {
  MediaItem,
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
import MediaPicker from './MediaPicker.vue';
import ThemePreview from './ThemePreview.vue';

const themes = ref<ThemeSummary[]>([]);
/** The theme being edited; null for a new one. */
const themeId = ref<string | null>(null);
const isEditing = ref(false);
const isSaving = ref(false);
const errorMessage = ref<string | null>(null);

const blank = (): ThemeInput & { backgroundMediaId: string | null } => ({
  name: '',
  background: DEFAULT_THEME_LOOK.background,
  backgroundColor: DEFAULT_THEME_LOOK.backgroundColor,
  textColor: DEFAULT_THEME_LOOK.textColor,
  font: DEFAULT_THEME_LOOK.font,
  textScale: DEFAULT_THEME_LOOK.textScale,
  textAlign: DEFAULT_THEME_LOOK.textAlign,
  backgroundMediaId: null,
  isDefault: false,
});
const form = reactive(blank());
const mediaItems = ref<MediaItem[]>([]);

// One kind of background at a time, and only its settings shown. An image
// or a video keeps a colour too: what a laptop shows until it holds the file.
type BackgroundType = 'colour' | 'gradient' | 'image' | 'video';
const BACKGROUND_TYPES: ReadonlyArray<{
  value: BackgroundType;
  label: string;
}> = [
  { value: 'colour', label: 'Colour' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
];
const GRADIENTS = themeBackgroundValues.filter(
  (background) => background !== 'solid',
);
const backgroundType = ref<BackgroundType>('colour');

/** The type a stored theme shows, once its media's kind is known. */
function typeOf(): BackgroundType {
  if (form.backgroundMediaId) {
    return (
      mediaItems.value.find((item) => item.id === form.backgroundMediaId)
        ?.kind ?? backgroundType.value
    );
  }
  return form.background === 'solid' ? 'colour' : 'gradient';
}
// The library arrives after the theme: settle an opened theme's type then.
watch(mediaItems, () => {
  if (form.backgroundMediaId) backgroundType.value = typeOf();
});

function chooseType(type: BackgroundType): void {
  if (type === backgroundType.value) return;
  backgroundType.value = type;
  const chosen = mediaItems.value.find(
    (item) => item.id === form.backgroundMediaId,
  );
  if (chosen && chosen.kind !== type) form.backgroundMediaId = null;
  if (type === 'colour' || type === 'image' || type === 'video') {
    form.background = 'solid';
  } else if (form.background === 'solid') {
    form.background = GRADIENTS[0]!;
  }
  if (type === 'colour' || type === 'gradient') form.backgroundMediaId = null;
}

// The preview shows the chosen image, or the video's still frame, once this
// laptop has it.
const chosenMedia = computed(
  () =>
    mediaItems.value.find((item) => item.id === form.backgroundMediaId) ?? null,
);
const look = computed(() => ({
  ...form,
  backgroundVideoUrl:
    chosenMedia.value?.kind === 'video' ? chosenMedia.value.url : null,
  backgroundImageUrl:
    chosenMedia.value?.kind === 'image' ? chosenMedia.value.url : null,
}));

async function loadThemes(): Promise<void> {
  themes.value = await window.pakita.themes.list();
}

function startNew(): void {
  Object.assign(form, blank());
  backgroundType.value = 'colour';
  themeId.value = null;
  isEditing.value = true;
  errorMessage.value = null;
}

async function open(id: string): Promise<void> {
  errorMessage.value = null;
  const [theme, items] = await Promise.all([
    window.pakita.themes.get(id),
    window.pakita.media.list(),
  ]);
  if (!theme) return;
  mediaItems.value = items;
  Object.assign(form, {
    name: theme.name,
    background: theme.background,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    font: theme.font,
    textScale: theme.textScale,
    textAlign: theme.textAlign,
    backgroundMediaId: theme.backgroundMediaId,
    isDefault: theme.isDefault,
  });
  backgroundType.value = typeOf();
  themeId.value = id;
  isEditing.value = true;
}

async function save(): Promise<void> {
  errorMessage.value = null;
  const isMedia =
    backgroundType.value === 'image' || backgroundType.value === 'video';
  if (isMedia && !form.backgroundMediaId) {
    errorMessage.value = `Choose ${
      backgroundType.value === 'image' ? 'an image' : 'a video'
    }, or another kind of background.`;
    return;
  }
  isSaving.value = true;
  try {
    const input = {
      ...form,
      name: form.name.trim(),
      backgroundMediaId: isMedia ? form.backgroundMediaId : null,
    };
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
            <ThemePreview
              :look="look"
              :poster-url="chosenMedia?.posterUrl ?? null"
            />
            <p class="faint">
              A sample slide, as it would look on the projector.
            </p>
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
            <fieldset class="wide background-type">
              <legend>Background</legend>
              <div class="segmented" data-testid="theme-background-type">
                <label
                  v-for="type in BACKGROUND_TYPES"
                  :key="type.value"
                  :class="{ chosen: backgroundType === type.value }"
                >
                  <input
                    type="radio"
                    name="background-type"
                    :value="type.value"
                    :checked="backgroundType === type.value"
                    :data-testid="`theme-background-${type.value}`"
                    @change="chooseType(type.value)"
                  />
                  {{ type.label }}
                </label>
              </div>
            </fieldset>
            <label v-if="backgroundType === 'gradient'" class="wide">
              Gradient
              <select v-model="form.background" data-testid="theme-gradient">
                <option
                  v-for="gradient in GRADIENTS"
                  :key="gradient"
                  :value="gradient"
                >
                  {{ BACKGROUND_LABELS[gradient] }}
                </option>
              </select>
            </label>
            <div
              v-if="backgroundType === 'image' || backgroundType === 'video'"
              class="wide"
            >
              <MediaPicker
                v-model="form.backgroundMediaId"
                :kind="backgroundType"
                @changed="mediaItems = $event"
              />
            </div>
            <label v-if="backgroundType !== 'gradient'" class="wide">
              {{
                backgroundType === 'colour'
                  ? 'Background colour'
                  : 'Colour shown until this laptop has the ' + backgroundType
              }}
              <input
                v-model="form.backgroundColor"
                type="color"
                data-testid="theme-colour"
              />
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
.background-type {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 0.4rem;
}

.background-type legend {
  padding: 0;
  margin-bottom: 0.4rem;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
}
</style>
