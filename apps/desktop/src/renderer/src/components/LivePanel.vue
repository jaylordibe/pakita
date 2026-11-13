<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { DisplayInfo, LiveState } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';
import ThemePreview from './ThemePreview.vue';

const props = defineProps<{ state: LiveState }>();
const live = window.pakita.live;

const displays = ref<DisplayInfo[]>([]);
const errorMessage = ref<string | null>(null);

const PROJECTOR_NOTES: Record<LiveState['projector'], string> = {
  off: '',
  showing: 'On the projector.',
  'display-missing':
    'The projector display is disconnected. Reconnect it: the presentation continues where it is.',
  windowed: 'No second display: showing in a window.',
};

async function refreshDisplays(): Promise<void> {
  displays.value = await window.pakita.displays.list();
}

async function chooseDisplay(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  // Let go of focus, so the presenter keys never change the display.
  select.blur();
  const value = select.value === '' ? null : Number(select.value);
  if (value === null || Number.isInteger(value)) {
    await window.pakita.displays.choose(value);
    await refreshDisplays();
  }
}

async function run(action: () => Promise<unknown>): Promise<void> {
  errorMessage.value = null;
  try {
    await action();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

// Presenter keys work everywhere while live, except while typing in a text
// field. A focused drop-down would otherwise take the arrow keys itself and
// change the projector display or the arrangement mid-service.
function onKeydown(event: KeyboardEvent): void {
  if (!props.state.isLive) return;
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
    return;
  }
  const actions: Record<string, () => Promise<unknown>> = {
    ArrowRight: () => window.pakita.live.next(),
    ArrowDown: () => window.pakita.live.next(),
    PageDown: () => window.pakita.live.next(),
    ' ': () => window.pakita.live.next(),
    ArrowLeft: () => window.pakita.live.previous(),
    ArrowUp: () => window.pakita.live.previous(),
    PageUp: () => window.pakita.live.previous(),
    b: () => window.pakita.live.toggleBlackout(),
    B: () => window.pakita.live.toggleBlackout(),
    '.': () => window.pakita.live.toggleBlackout(),
  };
  const action = actions[event.key];
  if (action) {
    event.preventDefault();
    void run(action);
  }
}

const currentSlide = computed(() =>
  props.state.isLive ? props.state.slides[props.state.index] : undefined,
);

// Keep the slide on screen in view in the strip as the presenter moves.
const strip = ref<HTMLOListElement | null>(null);
watch(
  () => [props.state.index, props.state.isLive] as const,
  async () => {
    await nextTick();
    strip.value
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
);

let unsubscribe: (() => void) | null = null;
onMounted(() => {
  void refreshDisplays();
  unsubscribe = window.pakita.displays.onChanged(() => void refreshDisplays());
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <section
    class="dock"
    :class="{ 'is-live': state.isLive }"
    aria-label="Presentation"
  >
    <ThemePreview
      v-if="state.isLive"
      class="now"
      :look="state.look"
      :text="currentSlide?.text ?? ''"
      :caption="currentSlide?.caption"
      :is-dark="state.isBlackout"
      test-id="live-preview"
    />

    <div class="main">
      <div class="status">
        <span
          class="on-air-pill"
          :class="{ on: state.isLive }"
          aria-hidden="true"
        >
          <span class="dot"></span>
          <template v-if="state.isLive">Live</template>
        </span>
        <strong class="title" data-testid="live-title">
          <template v-if="state.isLive">
            <span class="visually-hidden">Live: </span>{{ state.title }}
          </template>
          <template v-else>Not presenting</template>
        </strong>
        <span
          class="projector-note"
          :class="{ warn: state.projector === 'display-missing' }"
          data-testid="projector-status"
        >
          {{ PROJECTOR_NOTES[state.projector] }}
        </span>
        <span class="grow"></span>
        <label class="display">
          <AppIcon name="monitor" />
          <span class="visually-hidden">Projector</span>
          <select data-testid="display-select" @change="chooseDisplay">
            <option value="" :selected="!displays.some((d) => d.isChosen)">
              Automatic
            </option>
            <option
              v-for="display in displays"
              :key="display.id"
              :value="display.id"
              :selected="display.isChosen"
            >
              {{ display.label }} ({{ display.width }}×{{ display.height
              }}{{ display.isPrimary ? ', this screen' : '' }})
            </option>
          </select>
        </label>
      </div>

      <template v-if="state.isLive">
        <div class="controls">
          <button
            data-testid="live-previous"
            :disabled="state.index <= 0"
            @click="run(() => live.previous())"
          >
            <AppIcon name="arrow-left" />
            Previous
          </button>
          <button
            class="primary next"
            data-testid="live-next"
            :disabled="state.index >= state.slides.length - 1"
            @click="run(() => live.next())"
          >
            Next
            <AppIcon name="arrow-right" />
          </button>
          <button
            :class="{ 'on-air': state.isBlackout }"
            :aria-pressed="state.isBlackout"
            data-testid="live-blackout"
            @click="run(() => live.toggleBlackout())"
          >
            <AppIcon :name="state.isBlackout ? 'eye' : 'eye-off'" />
            {{ state.isBlackout ? 'Show' : 'Blackout' }}
            <span class="kbd" aria-hidden="true">B</span>
          </button>
          <button
            class="ghost stop"
            data-testid="live-stop"
            @click="run(() => live.stop())"
          >
            <AppIcon name="stop" />
            Stop
          </button>
          <span class="grow"></span>
          <span class="hint" aria-hidden="true">
            <span class="kbd">←</span><span class="kbd">→</span> move
          </span>
        </div>
        <ol ref="strip" class="strip">
          <li v-for="(slide, index) in state.slides" :key="index">
            <button
              class="thumb"
              :aria-current="index === state.index ? 'true' : undefined"
              :data-testid="`live-slide-${index}`"
              @click="run(() => live.goTo(index))"
            >
              <span class="thumb-label">
                <span>{{ slide.sectionLabel }}</span>
                <span class="thumb-number">{{ index + 1 }}</span>
              </span>
              <span class="thumb-text">{{ slide.text }}</span>
            </button>
          </li>
        </ol>
      </template>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.dock {
  position: relative;
  display: flex;
  gap: 1rem;
  padding: 0.6rem 1rem;
  background: var(--canvas);
  border-top: 1px solid var(--border);
}

.dock.is-live {
  padding: 0.85rem 1rem;
  border-top-color: rgb(255 90 110 / 0.45);
  background:
    linear-gradient(180deg, rgb(255 90 110 / 0.06), transparent 40%),
    var(--canvas);
}

.now {
  flex: none;
  width: 15.5rem;
  align-self: flex-start;
  border-radius: var(--radius);
  box-shadow:
    0 0 0 2px var(--live),
    0 12px 30px -12px rgb(255 90 110 / 0.5);
}

.main {
  flex: 1;
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 0.6rem;
}

.status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.on-air-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 1.5rem;
  padding: 0 0.6rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--surface-raised);
}

.on-air-pill:not(.on) {
  width: 1.5rem;
  padding: 0;
  justify-content: center;
  background: transparent;
}

.on-air-pill .dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--text-faint);
}

.on-air-pill.on {
  color: #fff;
  background: var(--live-solid);
}

.on-air-pill.on .dot {
  background: #fff;
  animation: on-air 1.6s ease-in-out infinite;
}

.title {
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dock:not(.is-live) .title {
  font-weight: 500;
  color: var(--text-muted);
}

.projector-note {
  min-width: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projector-note.warn {
  color: var(--warning);
  white-space: normal;
}

.display {
  position: relative;
  display: inline-flex;
  flex: none;
}

.display > .icon {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  translate: 0 -50%;
  color: var(--text-muted);
  pointer-events: none;
}

.display select {
  --control-height: 2rem;
  max-width: 17rem;
  padding-left: 2.1rem;
  font-size: 0.8rem;
  background-color: var(--surface);
}

.controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.next {
  min-width: 7rem;
}

.stop:hover:not(:disabled) {
  color: var(--live);
  background: var(--live-soft);
}

.controls .kbd {
  margin-left: 0.15rem;
}

button.on-air .kbd {
  color: #fff;
  background: rgb(255 255 255 / 0.12);
  border-color: rgb(255 255 255 / 0.3);
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-faint);
}

.strip {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0.15rem 0.15rem 0.35rem;
  list-style: none;
  overflow-x: auto;
  scroll-padding-inline: 1rem;
}

.thumb {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 9.5rem;
  aspect-ratio: 16 / 9;
  min-height: 0;
  padding: 1.15rem 0.5rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #05050c;
  color: #fff;
  white-space: normal;
  overflow: hidden;
}

.thumb:hover:not(:disabled) {
  background: #0c0b1a;
  border-color: var(--border-strong);
}

.thumb[aria-current='true'] {
  border-color: transparent;
  box-shadow:
    0 0 0 2px var(--live),
    0 6px 16px -6px rgb(255 90 110 / 0.55);
}

.thumb-label {
  position: absolute;
  inset: 0.3rem 0.45rem auto;
  display: flex;
  justify-content: space-between;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--text-muted);
}

.thumb[aria-current='true'] .thumb-label {
  color: var(--live);
}

.thumb-number {
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}

.thumb-text {
  font-size: 0.66rem;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.error {
  margin: 0;
}

@keyframes on-air {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 1000px) {
  .now {
    display: none;
  }
}
</style>
