import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { createOrderSchema, orderPayloadSchema, type CreateOrderInput, type OrderPayload } from '@office-service/shared';

const draftSchema = z.object({
  quantities: z.record(z.uuid(), z.number().int().min(0)),
  note: z.string().max(500),
  attempted: createOrderSchema.nullable(),
});
type DraftData = z.infer<typeof draftSchema>;
type Draft = DraftData & {
  edit: (patch: Partial<Pick<DraftData, 'quantities' | 'note'>>) => void;
  attempt: () => CreateOrderInput;
  rejected: () => void;
  clear: () => void;
};
const empty = (): DraftData => ({ quantities: {}, note: '', attempted: null });

export function createDraftStore(userId: string, storage: StateStorage) {
  return createStore<Draft>()(persist((set, get) => ({
    ...empty(),
    edit: (patch) => { if (!get().attempted) set(patch); },
    attempt: () => {
      const current = get();
      if (current.attempted) {
        set({ attempted: current.attempted });
        return structuredClone(current.attempted);
      }
      const payload: OrderPayload = orderPayloadSchema.parse({
        items: Object.entries(current.quantities).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity })),
        note: current.note,
      });
      const attempted = { ...payload, idempotencyKey: crypto.randomUUID() };
      set({ attempted });
      return structuredClone(attempted);
    },
    rejected: () => set({ attempted: null }),
    clear: () => set(empty()),
  }), {
    name: 'office-draft:' + userId,
    storage: createJSONStorage(() => storage),
    partialize: ({ quantities, note, attempted }) => ({ quantities, note, attempted }),
    merge: (persisted, current) => {
      const result = draftSchema.safeParse(persisted);
      return result.success ? { ...current, ...result.data } : current;
    },
  }));
}
const stores = new Map<string, ReturnType<typeof createDraftStore>>();
export function draftFor(userId: string) {
  let store = stores.get(userId);
  if (!store) {
    store = createDraftStore(userId, localStorage);
    stores.set(userId, store);
  }
  return store;
}
export function clearDraft(userId: string) {
  draftFor(userId).getState().clear();
  draftFor(userId).persist.clearStorage();
  stores.delete(userId);
}
