<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import type {
  ChurchOwner,
  ListedAccount,
  WorkspaceSummary,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import { useServerList } from '../server-list';
import AccountPicker from './AccountPicker.vue';
import AppIcon from './AppIcon.vue';

// Every church on the server, for its administrator. The administrator never
// joins a church: a new church is owned by an existing account named here,
// and that owner runs it — its people, songs and services. When an owner's
// account is lost, or they leave, the administrator names a new one. Owners
// are chosen from the server's accounts, searched on the server as the
// administrator types: only an active account outside the server's staff can
// own a church. The list itself is searched and paged on the server.

const nameLimits = apiConstraints.CreateWorkspaceDto.name;

const OWNER_ROLE = 'workspace_owner';

const churchList = useServerList((query) =>
  window.pakita.workspaces.browse(query),
);
const { search, items: churches, hasMore, isLoading } = churchList;
/** Kept apart from the list: a new search must not close the open church. */
const selected = ref<WorkspaceSummary | null>(null);
const selectedId = computed(() => selected.value?.id ?? null);
const currentOwner = ref<ChurchOwner | null>(null);
const isOwnerLoading = ref(false);
const isCreating = ref(false);
const isBusy = ref(false);
const errorMessage = ref<string | null>(null);
const notice = ref<string | null>(null);

const newChurch = reactive<{ name: string; owner: ListedAccount | null }>({
  name: '',
  owner: null,
});
const renameTo = ref('');
const newOwner = ref<ListedAccount | null>(null);
/** Remounts the new-owner picker, clearing what was typed. */
const newOwnerPickerKey = ref(0);
/** Deleting asks once more, on the same button. */
const isDeleteArmed = ref(false);

const shownError = computed(
  () => errorMessage.value ?? churchList.errorMessage.value,
);

const searchPossibleOwners = (term: string) =>
  window.pakita.workspaces.searchPossibleOwners(term);

/** Who may not take over the selected church: its owner, or someone suspended in it. */
function isExcludedAsNewOwner(account: ListedAccount): boolean {
  const churchId = selectedId.value;
  const membership = account.churches.find((church) => church.id === churchId);
  return (
    account.id === currentOwner.value?.id ||
    membership?.roleName === OWNER_ROLE ||
    membership?.isSuspended === true
  );
}

/** Looks up the selected church's owner on the server. */
async function loadOwner(): Promise<void> {
  const churchId = selectedId.value;
  currentOwner.value = null;
  if (!churchId) return;
  isOwnerLoading.value = true;
  try {
    const owner = await window.pakita.workspaces.getOwner(churchId);
    if (selectedId.value === churchId) currentOwner.value = owner;
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    if (selectedId.value === churchId) isOwnerLoading.value = false;
  }
}

function reset(): void {
  errorMessage.value = null;
  notice.value = null;
  isDeleteArmed.value = false;
}

function startNew(): void {
  reset();
  Object.assign(newChurch, { name: '', owner: null });
  selected.value = null;
  isCreating.value = true;
}

function open(church: WorkspaceSummary): void {
  reset();
  selected.value = church;
  isCreating.value = false;
  renameTo.value = church.name;
  clearNewOwner();
  void loadOwner();
}

function clearNewOwner(): void {
  newOwner.value = null;
  newOwnerPickerKey.value += 1;
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
    await Promise.all([churchList.reload(), loadOwner()]);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function create(): Promise<void> {
  const owner = newChurch.owner;
  if (!owner) return;
  await act(async () => {
    const church = await window.pakita.workspaces.create({
      name: newChurch.name.trim(),
      ownerEmail: owner.email,
    });
    isCreating.value = false;
    selected.value = church;
    renameTo.value = church.name;
  }, `Created. ${owner.displayName} (${owner.email}) owns it and can now open it in Pakita.`);
}

async function rename(): Promise<void> {
  const church = selected.value;
  if (!church) return;
  await act(async () => {
    selected.value = await window.pakita.workspaces.rename(
      church.id,
      renameTo.value.trim(),
    );
  }, 'Renamed.');
}

async function replaceOwner(): Promise<void> {
  const church = selected.value;
  const owner = newOwner.value;
  if (!church || !owner) return;
  await act(async () => {
    await window.pakita.workspaces.replaceOwner(church.id, owner.email);
    clearNewOwner();
  }, `${owner.email} now owns ${church.name}. Its former owner stays on as an administrator.`);
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
    selected.value = null;
  }, `${church.name} is deleted.`);
  isDeleteArmed.value = false;
}

onMounted(() => void churchList.reload());
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
        <li v-for="church in churches" :key="church.id">
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
        <li v-if="churches.length === 0 && !isLoading" class="list-empty">
          {{ search.trim() ? 'No church matches.' : 'No churches yet.' }}
        </li>
        <li v-if="hasMore">
          <button
            class="ghost sm list-more"
            :disabled="isLoading"
            data-testid="churches-show-more"
            @click="churchList.loadMore"
          >
            {{ isLoading ? 'Loading…' : 'Show more' }}
          </button>
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
            :disabled="isBusy || !newChurch.owner"
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
          <AccountPicker
            v-model="newChurch.owner"
            label="Owner"
            :search="searchPossibleOwners"
            test-id="church-owner-email"
            no-match-hint="No account matches. Create the owner's account in People first."
            is-required
          />
        </div>
      </form>

      <template v-else-if="selected">
        <div class="page-head">
          <div class="titles">
            <h2>{{ selected.name }}</h2>
            <p>{{ selected.slug }}</p>
          </div>
        </div>

        <p class="owner" data-testid="church-owner">
          <span class="muted">Owner</span>
          <template v-if="currentOwner">
            {{ currentOwner.displayName }}
            <span class="muted">({{ currentOwner.email }})</span>
          </template>
          <span v-else class="muted">{{ isOwnerLoading ? '…' : 'None' }}</span>
        </p>

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
          <AccountPicker
            :key="newOwnerPickerKey"
            v-model="newOwner"
            class="grow"
            label="New owner"
            :search="searchPossibleOwners"
            :is-excluded="isExcludedAsNewOwner"
            test-id="church-new-owner"
            no-match-hint="No account matches. Create their account in People first."
            is-required
          />
          <button
            type="submit"
            :disabled="isBusy || !newOwner"
            data-testid="church-replace-owner"
          >
            <AppIcon name="key" />
            Make owner
          </button>
        </form>
        <p class="muted hint">
          For when the owner's account is lost, or they leave. Choose someone
          with an account; the current owner stays on as an administrator.
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
      <p v-if="shownError" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ shownError }}</span>
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

.owner {
  display: flex;
  gap: 0.6rem;
  margin: 0 0 1.25rem;
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
