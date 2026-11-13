import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';

import type { ListPage, ListPageQuery } from '../../shared/ipc-contract';
import { messageOf } from './errors';

// A list the server searches and pages (the server administrator's Churches
// and People): typing asks the server again after a pause, "Show more" asks
// for the next page, and an answer overtaken by a newer question is dropped.
// Nothing is filtered from a copy loaded once.

/** Waits for a pause in typing before asking the server. */
export const SEARCH_DELAY_MILLISECONDS = 200;

export interface ServerList<Item> {
  readonly search: Ref<string>;
  readonly items: Readonly<Ref<readonly Item[]>>;
  readonly hasMore: Readonly<Ref<boolean>>;
  readonly isLoading: Readonly<Ref<boolean>>;
  readonly errorMessage: Readonly<Ref<string | null>>;
  /** Asks again from the first page, for the current search. */
  reload(): Promise<void>;
  /** Appends the next page. */
  loadMore(): Promise<void>;
}

export function useServerList<Item>(
  fetchPage: (query: ListPageQuery) => Promise<ListPage<Item>>,
): ServerList<Item> {
  const search = ref('');
  const items = shallowRef<readonly Item[]>([]);
  const hasMore = ref(false);
  const isLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  let page = 1;
  /** Numbers each request, so an answer overtaken by a newer one is dropped. */
  let latestRequest = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(pageNumber: number): Promise<void> {
    const requestNumber = ++latestRequest;
    isLoading.value = true;
    try {
      const result = await fetchPage({
        search: search.value.trim(),
        page: pageNumber,
      });
      if (requestNumber !== latestRequest) return;
      items.value =
        pageNumber === 1 ? result.items : [...items.value, ...result.items];
      hasMore.value = result.hasMore;
      page = pageNumber;
      errorMessage.value = null;
    } catch (error) {
      if (requestNumber !== latestRequest) return;
      errorMessage.value = messageOf(error);
    } finally {
      if (requestNumber === latestRequest) isLoading.value = false;
    }
  }

  function reload(): Promise<void> {
    clearTimeout(searchTimer);
    return load(1);
  }

  function loadMore(): Promise<void> {
    return hasMore.value ? load(page + 1) : Promise.resolve();
  }

  watch(search, () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(1), SEARCH_DELAY_MILLISECONDS);
  });
  onScopeDispose(() => clearTimeout(searchTimer));

  return { search, items, hasMore, isLoading, errorMessage, reload, loadMore };
}
