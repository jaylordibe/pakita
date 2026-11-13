<script setup lang="ts">
import { ref } from 'vue';

import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// A one-time password or invitation code, shown once so the operator can
// pass it on. The server keeps only a hash: once this is dismissed, the only
// way to get one again is to issue a new one.
const props = defineProps<{
  label: string;
  secret: string;
  /** What the person receiving it does with it. */
  instructions: string;
}>();
const emit = defineEmits<{ done: [] }>();

const isCopied = ref(false);
const errorMessage = ref<string | null>(null);

async function copy(): Promise<void> {
  errorMessage.value = null;
  try {
    await window.pakita.app.copyText(props.secret);
    isCopied.value = true;
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}
</script>

<template>
  <section class="issued" role="status" aria-live="polite">
    <p class="issued-label">{{ label }}</p>
    <div class="issued-row">
      <output class="secret" data-testid="issued-secret">{{ secret }}</output>
      <button type="button" class="sm" data-testid="issued-copy" @click="copy">
        <AppIcon :name="isCopied ? 'check' : 'copy'" />
        {{ isCopied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <p class="muted">{{ instructions }}</p>
    <p class="faint">
      Pakita shows this only once. If it is lost, issue a new one.
    </p>
    <p v-if="errorMessage" class="error" role="alert">
      <AppIcon name="alert" />
      <span>{{ errorMessage }}</span>
    </p>
    <button
      type="button"
      class="primary sm done"
      data-testid="issued-done"
      @click="emit('done')"
    >
      Done
    </button>
  </section>
</template>

<style scoped>
.issued {
  display: grid;
  gap: 0.6rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--accent-soft);
}

.issued-label {
  font-weight: 600;
}

.issued-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.secret {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius);
  background: var(--canvas);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
  overflow-wrap: anywhere;
  user-select: all;
}

.done {
  justify-self: start;
}
</style>
