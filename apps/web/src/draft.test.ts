import { randomUUID } from 'node:crypto';
import { expect, test } from 'vite-plus/test';
import { createDraftStore } from './draft';

function deviceStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test('drafts persist per user and never leak between users', () => {
  const storage = deviceStorage();
  const itemId = randomUUID();
  const first = createDraftStore('first', storage);
  first.getState().edit({ quantities: { [itemId]: 2 }, note: 'চিনি ছাড়া' });
  const second = createDraftStore('second', storage);
  expect(second.getState()).toMatchObject({ quantities: {}, note: '', attempted: null });
  second.getState().edit({ note: 'অন্য ব্যবহারকারী' });
  const reload = createDraftStore('first', storage);
  expect(reload.getState()).toMatchObject({ quantities: { [itemId]: 2 }, note: 'চিনি ছাড়া' });
  expect(reload.getState().attempt()).toMatchObject({
    items: [{ itemId, quantity: 2 }],
    note: 'চিনি ছাড়া',
  });
  expect(createDraftStore('second', storage).getState().note).toBe('অন্য ব্যবহারকারী');
});

test('ambiguous outcomes freeze the attempted payload and UUID across reload', () => {
  const storage = deviceStorage();
  const itemId = randomUUID();
  const first = createDraftStore('user', storage);
  first.getState().edit({ quantities: { [itemId]: 1 } });
  const attempted = first.getState().attempt();
  expect(attempted.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  first.getState().edit({ note: 'must not change', quantities: { [itemId]: 9 } });
  attempted.items[0].quantity = 99;
  const reload = createDraftStore('user', storage);
  const retry = reload.getState().attempt();
  expect(retry).toEqual({
    idempotencyKey: attempted.idempotencyKey,
    items: [{ itemId, quantity: 1 }],
    note: '',
  });
  expect(first.getState().attempt()).toEqual(retry);
  expect(reload.getState()).toMatchObject({ note: '', quantities: { [itemId]: 1 } });
});

test('confirmed rejection permits editing and a new key; confirmed commit clears the persisted draft', () => {
  const storage = deviceStorage();
  const store = createDraftStore('user', storage);
  const itemId = randomUUID();
  store.getState().edit({ quantities: { [itemId]: 2 } });
  const first = store.getState().attempt();
  store.getState().rejected();
  store.getState().edit({ note: 'new request' });
  const next = store.getState().attempt();
  expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(next.note).toBe('new request');
  store.getState().clear();
  expect(createDraftStore('user', storage).getState()).toMatchObject({
    quantities: {},
    note: '',
    attempted: null,
  });
  store.persist.clearStorage();
  expect(storage.getItem('office-draft:user')).toBeNull();
});

test('a retry cannot leave the device until its key and payload are persisted successfully', () => {
  const storage = deviceStorage();
  let writable = true;
  const store = createDraftStore('user', {
    ...storage,
    setItem: (key: string, value: string) => {
      if (!writable) throw new Error('Device storage is full');
      storage.setItem(key, value);
    },
  });
  store.getState().edit({ quantities: { [randomUUID()]: 1 } });
  writable = false;
  expect(() => store.getState().attempt()).toThrow('Device storage is full');
  const key = store.getState().attempted?.idempotencyKey;
  expect(key).toBeDefined();
  expect(() => store.getState().attempt()).toThrow('Device storage is full');
  writable = true;
  expect(store.getState().attempt().idempotencyKey).toBe(key);
  expect(createDraftStore('user', storage).getState().attempted?.idempotencyKey).toBe(key);
});

test('invalid drafts cannot become requests and corrupt device storage cannot hydrate a payload', () => {
  const storage = deviceStorage();
  const store = createDraftStore('user', storage);
  expect(() => store.getState().attempt()).toThrow();
  expect(store.getState().attempted).toBeNull();
  store.getState().edit({ quantities: { [randomUUID()]: 1 }, note: 'x'.repeat(501) });
  expect(() => store.getState().attempt()).toThrow();
  storage.setItem(
    'office-draft:user',
    JSON.stringify({
      state: { quantities: { bad: -1 }, attempted: { idempotencyKey: 'bad' } },
      version: 0,
    }),
  );
  expect(createDraftStore('user', storage).getState()).toMatchObject({
    quantities: {},
    attempted: null,
  });
});
