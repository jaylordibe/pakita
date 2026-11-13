<script setup lang="ts">
import { ref } from 'vue';

import type { ServerConnection } from '../../../shared/ipc-contract';
import pakitaMark from '../assets/pakita-mark.png';
import AppIcon from '../components/AppIcon.vue';
import { messageOf } from '../errors';

const props = defineProps<{ initialAddress: string | null }>();
const emit = defineEmits<{ connected: [connection: ServerConnection] }>();

const address = ref(props.initialAddress ?? '');
const errorMessage = ref<string | null>(null);
const isBusy = ref(false);

async function connect(): Promise<void> {
  isBusy.value = true;
  errorMessage.value = null;
  try {
    const connection = await window.pakita.server.connect(address.value);
    if (connection.compatibility.status !== 'compatible') {
      errorMessage.value = connection.compatibility.message;
      return;
    }
    emit('connected', connection);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <div class="auth">
    <form class="card" @submit.prevent="connect">
      <div class="brand">
        <img
          class="card-mark"
          :src="pakitaMark"
          alt=""
          width="48"
          height="48"
        />
        <div>
          <span class="wordmark">Pakita</span>
          <span class="tagline">Simply present.</span>
        </div>
      </div>
      <div class="card-head">
        <h1>Welcome to Pakita</h1>
        <p class="muted">Enter the address of your church's Pakita server.</p>
      </div>
      <label>
        Server address
        <input
          v-model="address"
          data-testid="server-address"
          placeholder="pakita.mychurch.org"
          autocomplete="url"
          spellcheck="false"
          required
        />
      </label>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
      <div class="actions">
        <button class="primary" type="submit" :disabled="isBusy">
          {{ isBusy ? 'Connecting…' : 'Connect' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.4rem;
}

.brand .card-mark {
  margin: 0;
}

.brand div {
  display: grid;
}

.wordmark {
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: 1.45rem;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.tagline {
  font-size: 0.8rem;
  color: var(--text-muted);
}
</style>
