<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import type { WorkspaceSummary } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// Every church on the server, for its administrator. The administrator never
// joins a church: a new church is owned by an existing account named here,
// and that owner runs it — its people, songs and services. When an owner's
// account is lost, or they leave, the administrator names a new one.

const nameLimits = apiConstraints.CreateWorkspaceDto.name;

const churches = ref<WorkspaceSummary[]>([]);
const search = ref('');
const selectedId = ref<string | null>(null);
const isCreating = ref(false);
const isBusy = ref(false);
const errorMessage = ref<string | null>(null);
const notice = ref<string | null>(null);

const newChurch = reactive({ name: '', ownerEmail: '' });
const renameTo = ref('');
const newOwnerEmail = ref('');
/** Deleting asks once more, on the same button. */
const isDeleteArmed = ref(false);

const visibleChurches = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return churches.value;
  return churches.value.filter((church) =>
    `${church.name} ${church.slug}`.toLowerCase().includes(term),
  );
});

const selected = computed(
  () => churches.value.find((church) => church.id === selectedId.value) ?? null,
);

async function load(): Promise<void> {
  try {
    churches.value = (await window.pakita.workspaces.list()).sort(
      (first, second) => first.name.localeCompare(second.name),
    );
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

function reset(): void {
  errorMessage.value = null;
  notice.value = null;
  isDeleteArmed.value = false;
}

function startNew(): void {
  reset();
  Object.assign(newChurch, { name: '', ownerEmail: '' });
  selectedId.value = null;
  isCreating.value = true;
}

function open(church: WorkspaceSummary): void {
  reset();
  selectedId.value = church.id;
  isCreating.value = false;
  renameTo.value = church.name;
  newOwnerEmail.value = '';
}

/** Runs one server action, showing its error or `success` when it finishes. */
async function act(
  action: () => Promise<void>,
  success: string,
): Promise<void> {
  errorMessage.value = null;
  notice.value = null;
  isBusy.value = true;
  try {
    await action();
    notice.value = success;
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function create(): Promise<void> {
  const ownerEmail = newChurch.ownerEmail.trim();
  await act(async () => {
    const church = await window.pakita.workspaces.create({
      name: newChurch.name.trim(),
      ownerEmail,
    });
    isCreating.value = false;
    selectedId.value = church.id;
    renameTo.value = church.name;
  }, `Created. ${ownerEmail} owns it and can now open it in Pakita.`);
}

async function rename(): Promise<void> {
  const church = selected.value;
  if (!church) return;
  await act(async () => {
    await window.pakita.workspaces.rename(church.id, renameTo.value.trim());
  }, 'Renamed.');
}

async function replaceOwner(): Promise<void> {
  const church = selected.value;
  const email = newOwnerEmail.value.trim();
  if (!church || !email) return;
  await act(async () => {
    await window.pakita.workspaces.replaceOwner(church.id, email);
    newOwnerEmail.value = '';
  }, `${email} now owns ${church.name}. Its former owner stays on as an administrator.`);
}

async function remove(): Promise<void> {
  const church = selected.value;
  if (!church) return;
  if (!isDeleteArmed.value) {
    isDeleteArmed.value = true;
    return;
  }
  await act(async () => {
    await window.pakita.workspaces.delete(church.id);
    selectedId.value = null;
  }, `${church.name} is deleted.`);
  isDeleteArmed.value = false;
}

onMounted(load);
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Churches</h1>
        <button class="sm primary" data-testid="church-new" @click="startNew">
          <AppIcon name="plus" />
          New church
        </button>
      </div>
      <div class="search-field">
        <AppIcon name="search" />
        <input
          v-model="search"
          type="search"
          placeholder="Search churches"
          aria-label="Search churches"
        />
      </div>
      <ul class="list">
        <li v-for="church in visibleChurches" :key="church.id">
          <button
            class="list-item"
            :aria-current="church.id === selectedId ? 'true' : undefined"
            :data-testid="`church-${church.slug}`"
            @click="open(church)"
          >
            <span class="item-title">{{ church.name }}</span>
            <span class="item-sub">{{ church.slug }}</span>
          </button>
        </li>
        <li v-if="visibleChurches.length === 0" class="list-empty">
          {{ search ? 'No church matches.' : 'No churches yet.' }}
        </li>
      </ul>
    </aside>

    <main class="panel-content">
      <form v-if="isCreating" class="editor" @submit.prevent="create">
        <div class="page-head">
          <div class="titles">
            <h2>New church</h2>
            <p class="muted">
              Its owner runs it: they invite its people and look after its songs
              and services. Create the owner's account in People first.
            </p>
          </div>
          <button
            class="primary"
            type="submit"
            :disabled="isBusy"
            data-testid="church-create"
          >
            <AppIcon name="check" />
            {{ isBusy ? 'Creating…' : 'Create church' }}
          </button>
        </div>
        <div class="fields">
          <label>
            Name
            <input
              v-model="newChurch.name"
              data-testid="church-name"
              :minlength="nameLimits.minLength"
              :maxlength="nameLimits.maxLength"
              required
            />
          </label>
          <label>
            Owner's email
            <input
              v-model="newChurch.ownerEmail"
              data-testid="church-owner-email"
              type="email"
              spellcheck="false"
              required
            />
          </label>
        </div>
      </form>

      <template v-else-if="selected">
        <div class="page-head">
          <div class="titles">
            <h2>{{ selected.name }}</h2>
            <p>{{ selected.slug }}</p>
          </div>
        </div>

        <form class="row" @submit.prevent="rename">
          <label class="grow">
            Name
            <input
              v-model="renameTo"
              data-testid="church-rename"
              :minlength="nameLimits.minLength"
              :maxlength="nameLimits.maxLength"
              required
            />
          </label>
          <button
            type="submit"
            :disabled="isBusy || renameTo.trim() === selected.name"
          >
            <AppIcon name="pencil" />
            Rename
          </button>
        </form>

        <form class="row" @submit.prevent="replaceOwner">
          <label class="grow">
            New owner's email
            <input
              v-model="newOwnerEmail"
              data-testid="church-new-owner"
              type="email"
              spellcheck="false"
              required
            />
          </label>
          <button
            type="submit"
            :disabled="isBusy"
            data-testid="church-replace-owner"
          >
            <AppIcon name="key" />
            Make owner
          </button>
        </form>
        <p class="muted hint">
          For when the owner's account is lost, or they leave. The person must
          already have an account; the current owner stays on as an
          administrator.
        </p>

        <div class="delete">
          <button
            class="danger"
            :disabled="isBusy"
            data-testid="church-delete"
            @click="remove"
          >
            <AppIcon name="trash" />
            {{
              isDeleteArmed
                ? `Delete ${selected.name} for everyone`
                : 'Delete church'
            }}
          </button>
          <p v-if="isDeleteArmed" class="muted">
            Its people lose its songs, services and themes on every laptop.
            Press again to delete, or choose another church to keep it.
          </p>
        </div>
      </template>

      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="church" /></span>
        <p>Choose a church, or create one for a new congregation.</p>
      </div>

      <p v-if="notice" class="notice" role="status" data-testid="church-notice">
        <AppIcon name="check" />
        <span>{{ notice }}</span>
      </p>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 1.2rem;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.9rem 1.2rem;
}

.fields input,
.row input {
  width: 100%;
}

.row {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.hint {
  margin: -0.4rem 0 1.5rem;
  font-size: 0.82rem;
}

.delete {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  color: var(--success);
}
</style>
