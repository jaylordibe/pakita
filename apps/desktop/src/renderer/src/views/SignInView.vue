<script setup lang="ts">
import { ref } from 'vue';

import type { AccountSummary } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

defineProps<{ serverOrigin: string; canGoBack: boolean }>();
const emit = defineEmits<{
  signedIn: [account: AccountSummary];
  changeServer: [];
  back: [];
}>();

const identifier = ref('');
const password = ref('');
const errorMessage = ref<string | null>(null);
const isBusy = ref(false);

async function signIn(): Promise<void> {
  isBusy.value = true;
  errorMessage.value = null;
  try {
    const account = await window.pakita.account.signIn(
      identifier.value,
      password.value,
    );
    password.value = '';
    emit('signedIn', account);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}
</script>

<template>
  <form class="card" @submit.prevent="signIn">
    <h1>Sign in</h1>
    <p class="muted">{{ serverOrigin }}</p>
    <label>
      Email or username
      <input
        v-model="identifier"
        data-testid="sign-in-identifier"
        autocomplete="username"
        required
      />
    </label>
    <label>
      Password
      <input
        v-model="password"
        data-testid="sign-in-password"
        type="password"
        autocomplete="current-password"
        required
      />
    </label>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    <div class="row">
      <button class="primary" type="submit" :disabled="isBusy">
        {{ isBusy ? 'Signing in…' : 'Sign in' }}
      </button>
      <button type="button" @click="emit('changeServer')">Change server</button>
    </div>
  </form>
</template>
