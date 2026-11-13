<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import type { Song, SongInput } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

type SectionKind = SongInput['sections'][number]['kind'];

interface EditableSection {
  key: string;
  kind: SectionKind;
  label: string;
  lyrics: string;
}
interface EditableArrangement {
  name: string;
  sectionKeys: string[];
}

const SECTION_KINDS: SectionKind[] = [
  'verse',
  'chorus',
  'bridge',
  'intro',
  'outro',
  'custom',
];

const props = defineProps<{ song: Song | null }>();
const emit = defineEmits<{ saved: [song: Song]; cancel: [] }>();

let newKeyCount = 0;
const nextKey = () => `new-${(newKeyCount += 1)}`;

// Existing sections keep their server ids as keys, so arrangements that refer
// to them survive the edit.
const title = ref(props.song?.title ?? '');
const artist = ref(props.song?.artist ?? '');
const sections = reactive<EditableSection[]>(
  props.song?.sections.map((section) => ({
    key: section.id,
    kind: section.kind,
    label: section.label,
    lyrics: section.lyrics,
  })) ?? [{ key: nextKey(), kind: 'verse', label: 'Verse 1', lyrics: '' }],
);
const arrangements = reactive<EditableArrangement[]>(
  props.song?.arrangements.map((arrangement) => ({
    name: arrangement.name,
    sectionKeys: [...arrangement.sectionIds],
  })) ?? [{ name: 'Default', sectionKeys: [sections[0]!.key] }],
);
const defaultIndex = ref(
  Math.max(
    0,
    props.song?.arrangements.findIndex(
      (arrangement) => arrangement.isDefault,
    ) ?? 0,
  ),
);
const errorMessage = ref<string | null>(null);
const isSaving = ref(false);

const labelOf = (key: string) =>
  sections.find((section) => section.key === key)?.label ?? '?';

const canSave = computed(
  () =>
    title.value.trim().length > 0 &&
    sections.length > 0 &&
    sections.every(
      (section) => section.label.trim() && section.lyrics.trim(),
    ) &&
    arrangements.every(
      (arrangement) =>
        arrangement.name.trim() && arrangement.sectionKeys.length > 0,
    ),
);

function addSection(): void {
  const section: EditableSection = {
    key: nextKey(),
    kind: 'verse',
    label: `Section ${sections.length + 1}`,
    lyrics: '',
  };
  sections.push(section);
  arrangements[defaultIndex.value]?.sectionKeys.push(section.key);
}

function removeSection(index: number): void {
  const [removed] = sections.splice(index, 1);
  if (!removed) return;
  for (const arrangement of arrangements) {
    arrangement.sectionKeys = arrangement.sectionKeys.filter(
      (key) => key !== removed.key,
    );
  }
}

function move<Value>(list: Value[], index: number, offset: number): void {
  const target = index + offset;
  if (target < 0 || target >= list.length) return;
  const [moved] = list.splice(index, 1);
  list.splice(target, 0, moved!);
}

function addArrangement(): void {
  arrangements.push({
    name: `Arrangement ${arrangements.length + 1}`,
    sectionKeys: sections.map((section) => section.key),
  });
}

function removeArrangement(index: number): void {
  if (arrangements.length === 1) return;
  arrangements.splice(index, 1);
  if (defaultIndex.value >= arrangements.length) defaultIndex.value = 0;
}

async function save(): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  const input: SongInput = {
    title: title.value.trim(),
    artist: artist.value.trim() || null,
    sections: sections.map((section) => ({
      key: section.key,
      kind: section.kind,
      label: section.label.trim(),
      lyrics: section.lyrics,
    })),
    arrangements: arrangements.map((arrangement, index) => ({
      name: arrangement.name.trim(),
      isDefault: index === defaultIndex.value,
      sectionKeys: [...arrangement.sectionKeys],
    })),
  };
  try {
    const song = props.song
      ? await window.pakita.songs.update(props.song.id, input)
      : await window.pakita.songs.create(input);
    emit('saved', song);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <form class="editor" @submit.prevent="save">
    <h2>{{ song ? 'Edit song' : 'New song' }}</h2>
    <div class="row">
      <label class="grow">
        Title
        <input v-model="title" data-testid="song-title" maxlength="200" />
      </label>
      <label class="grow">
        Artist
        <input v-model="artist" data-testid="song-artist" maxlength="200" />
      </label>
    </div>

    <h3>Sections</h3>
    <p class="muted">A blank line in the lyrics starts a new slide.</p>
    <fieldset
      v-for="(section, index) in sections"
      :key="section.key"
      class="section"
    >
      <div class="row">
        <select v-model="section.kind" aria-label="Section kind">
          <option v-for="kind in SECTION_KINDS" :key="kind" :value="kind">
            {{ kind }}
          </option>
        </select>
        <input
          v-model="section.label"
          :data-testid="`section-label-${index}`"
          aria-label="Section label"
          maxlength="60"
        />
        <button type="button" @click="move(sections, index, -1)">↑</button>
        <button type="button" @click="move(sections, index, 1)">↓</button>
        <button type="button" @click="removeSection(index)">Remove</button>
      </div>
      <textarea
        v-model="section.lyrics"
        :data-testid="`section-lyrics-${index}`"
        aria-label="Lyrics"
        rows="5"
        maxlength="10000"
      ></textarea>
    </fieldset>
    <button type="button" @click="addSection">Add section</button>

    <h3>Arrangements</h3>
    <fieldset
      v-for="(arrangement, index) in arrangements"
      :key="index"
      class="section"
    >
      <div class="row">
        <input
          v-model="arrangement.name"
          aria-label="Arrangement name"
          maxlength="60"
        />
        <label class="inline">
          <input v-model="defaultIndex" type="radio" :value="index" />
          Default
        </label>
        <button
          type="button"
          :disabled="arrangements.length === 1"
          @click="removeArrangement(index)"
        >
          Remove
        </button>
      </div>
      <ol class="sequence">
        <li v-for="(key, position) in arrangement.sectionKeys" :key="position">
          {{ labelOf(key) }}
          <button
            type="button"
            aria-label="Earlier"
            @click="move(arrangement.sectionKeys, position, -1)"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Later"
            @click="move(arrangement.sectionKeys, position, 1)"
          >
            →
          </button>
          <button
            type="button"
            aria-label="Remove from arrangement"
            @click="arrangement.sectionKeys.splice(position, 1)"
          >
            ×
          </button>
        </li>
      </ol>
      <select
        aria-label="Add a section to this arrangement"
        @change="
          (event) => {
            const select = event.target as HTMLSelectElement;
            if (select.value) arrangement.sectionKeys.push(select.value);
            select.value = '';
          }
        "
      >
        <option value="">Add section…</option>
        <option
          v-for="section in sections"
          :key="section.key"
          :value="section.key"
        >
          {{ section.label }}
        </option>
      </select>
    </fieldset>
    <button type="button" @click="addArrangement">Add arrangement</button>

    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    <div class="row">
      <button
        class="primary"
        type="submit"
        data-testid="song-save"
        :disabled="!canSave || isSaving"
      >
        {{ isSaving ? 'Saving…' : 'Save' }}
      </button>
      <button type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 0.75rem;
}

.grow {
  flex: 1;
}

.section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

textarea {
  width: 100%;
  resize: vertical;
}

.inline {
  display: flex;
  font-weight: 400;
  align-items: center;
}

.sequence {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.sequence li {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  display: flex;
  gap: 0.2rem;
  align-items: center;
}

.sequence button {
  padding: 0 0.3rem;
}
</style>
