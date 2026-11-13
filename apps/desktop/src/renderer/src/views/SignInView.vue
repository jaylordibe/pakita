<script setup lang="ts">
import { ref } from 'vue';

import type { AccountSummary } from '../../../shared/ipc-contract';
import pakitaMark from '../assets/pakita-mark.png';
import AppIcon from '../components/AppIcon.vue';
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
  <div class="auth">
    <form class="card" @submit.prevent="signIn">
      <img class="card-mark" :src="pakitaMark" alt="" width="48" height="48" />
      <div class="card-head">
        <h1>Sign in</h1>
        <p class="server">
          <AppIcon name="church" />
          <span>{{ serverOrigin }}</span>
        </p>
      </div>
      <label>
        Email or username
        <input
          v-model="identifier"
          data-testid="sign-in-identifier"
          autocomplete="username"
          spellcheck="false"
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
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
      <div class="actions">
        <button class="primary" type="submit" :disabled="isBusy">
          {{ isBusy ? 'Signing in…' : 'Sign in' }}
        </button>
        <button type="button" @click="emit('changeServer')">
          Change server
        </button>
      </div>
      <button
        v-if="canGoBack"
        type="button"
        class="ghost back"
        @click="emit('back')"
      >
        <AppIcon name="arrow-left" />
        Back to the library
      </button>
    </form>
  </div>
</template>

<style scoped>
.server {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  color: var(--text-muted);
}

.server span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back {
  justify-self: start;
  margin: -0.4rem 0 -0.6rem -0.6rem;
}
</style>
