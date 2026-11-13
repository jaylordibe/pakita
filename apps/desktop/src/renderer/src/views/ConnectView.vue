<script setup lang="ts">
import { ref } from 'vue';

import type { ServerConnection } from '../../../shared/ipc-contract';
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
  <form class="card" @submit.prevent="connect">
    <h1>Welcome to Pakita</h1>
    <p class="muted">Enter the address of your church's Pakita server.</p>
    <label>
      Server address
      <input
        v-model="address"
        data-testid="server-address"
        placeholder="pakita.mychurch.org"
        autocomplete="url"
        required
      />
    </label>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    <button class="primary" type="submit" :disabled="isBusy">
      {{ isBusy ? 'Connecting…' : 'Connect' }}
    </button>
  </form>
</template>
