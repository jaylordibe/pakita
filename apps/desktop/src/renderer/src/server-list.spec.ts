import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';

import type { ListPage, ListPageQuery } from '../../shared/ipc-contract';
import { SEARCH_DELAY_MILLISECONDS, useServerList } from './server-list';

type Fetch = (query: ListPageQuery) => Promise<ListPage<string>>;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('useServerList', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setUp(fetchPage: Fetch) {
    const scope = effectScope();
    const list = scope.run(() => useServerList(fetchPage))!;
    return { list, scope };
  }

  it('loads the first page, then appends the next', async () => {
    const fetchPage = vi.fn<Fetch>(async ({ page }) => ({
      items: [`row ${page}`],
      hasMore: page < 2,
    }));
    const { list } = setUp(fetchPage);

    await list.reload();
    expect(list.items.value).toEqual(['row 1']);
    expect(list.hasMore.value).toBe(true);

    await list.loadMore();
    expect(list.items.value).toEqual(['row 1', 'row 2']);
    expect(list.hasMore.value).toBe(false);
    expect(fetchPage).toHaveBeenLastCalledWith({ search: '', page: 2 });

    // Nothing more to ask for.
    await list.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('asks the server again, from the first page, after a pause in typing', async () => {
    const fetchPage = vi.fn<Fetch>(async ({ search }) => ({
      items: [search],
      hasMore: false,
    }));
    const { list } = setUp(fetchPage);

    list.search.value = 'no';
    await nextTick();
    list.search.value = ' nora ';
    await nextTick();
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MILLISECONDS);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ search: 'nora', page: 1 });
    expect(list.items.value).toEqual(['nora']);
  });

  it('drops an answer overtaken by a newer question', async () => {
    const slow = deferred<ListPage<string>>();
    const fetchPage = vi
      .fn<Fetch>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: ['new'], hasMore: false });
    const { list } = setUp(fetchPage);

    const first = list.reload();
    await list.reload();
    slow.resolve({ items: ['old'], hasMore: true });
    await first;

    expect(list.items.value).toEqual(['new']);
    expect(list.hasMore.value).toBe(false);
    expect(list.isLoading.value).toBe(false);
  });

  it('keeps what it has and says why when the server refuses', async () => {
    const fetchPage = vi
      .fn<Fetch>()
      .mockResolvedValueOnce({ items: ['kept'], hasMore: true })
      .mockRejectedValueOnce(new Error('The server is not reachable.'));
    const { list } = setUp(fetchPage);

    await list.reload();
    await list.loadMore();
    expect(list.items.value).toEqual(['kept']);
    expect(list.errorMessage.value).toBe('The server is not reachable.');
  });

  it('asks nothing after it is disposed', async () => {
    const fetchPage = vi.fn<Fetch>(async () => ({ items: [], hasMore: false }));
    const { list, scope } = setUp(fetchPage);

    list.search.value = 'nora';
    await nextTick();
    scope.stop();
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MILLISECONDS);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
