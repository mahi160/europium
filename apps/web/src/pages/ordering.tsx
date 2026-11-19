import { useId, useState } from 'react';
import { useStore } from 'zustand';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  menuCategorySchema, menuItemResponseSchema, menuResponseSchema, orderResponseSchema, ordersResponseSchema,
  type MenuItem, type PublicUser,
} from '@office-service/shared';
import { api, ApiError } from '../api';
import { draftFor } from '../draft';
import { number } from '../i18n';
import { OrderCard } from '../components/order-card';
import { ErrorNotice, Field, Form, text } from '../components/forms';
import { Button } from '../components/ui/button';
import { useOffline } from '../realtime';
import { OrderFocus } from '../components/order-focus';

// Quick instructions; kept in Bangla for staff like menu names, and stored in the order note.
const noteOptions = ['দুধ', 'চিনি', 'কম চিনি', 'চিনি ছাড়া'];

export function Ordering({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const offline = useOffline();
  const store = draftFor(user.id);
  const draft = useStore(store);
  const menu = useQuery({ queryKey: ['menu', user.id, user.role], queryFn: () => api('/menu', menuResponseSchema) });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const frozen = draft.attempted !== null;
  const selected = Object.entries(draft.quantities).filter(([, quantity]) => quantity > 0);
  const noteParts = draft.note.split(',').map((part) => part.trim()).filter(Boolean);
  function toggleOption(option: string) {
    const note = (noteParts.includes(option) ? noteParts.filter((part) => part !== option) : [...noteParts, option]).join(', ');
    if (note.length <= 500) draft.edit({ note });
  }
  const nameOf = (id: string) => menu.data?.items.find((item) => item.id === id)?.name ?? t('removedItem');
  async function submit() {
    if (!navigator.onLine || offline) throw new ApiError('NETWORK_ERROR');
    if (busy) return;
    setBusy(true); setSubmitted(false);
    try {
      const payload = store.getState().attempt();
      await api('/orders', orderResponseSchema, 'POST', payload);
      store.getState().clear();
      setSubmitted(true);
      await client.invalidateQueries({ queryKey: ['orders', user.id] });
    } catch (cause) {
      if (cause instanceof ApiError && ['VALIDATION_ERROR', 'ITEM_UNAVAILABLE'].includes(cause.code)) {
        store.getState().rejected();
        void menu.refetch();
      }
      throw cause instanceof z.ZodError && !store.getState().attempted ? new ApiError('VALIDATION_ERROR') : cause;
    } finally { setBusy(false); }
  }
  return <>
    <div className="ordering">
      <section aria-labelledby="refreshments-heading"><h2 id="refreshments-heading" className="section-title">{t('refreshments')}</h2>
        {menu.isPending && <p role="status" className="muted">{t('loading')}</p>}<ErrorNotice error={menu.error} retry={() => void menu.refetch()}/>
        <ul className="list">{menu.data?.items.filter((item) => !item.archived).map((item) => {
          const quantity = draft.quantities[item.id] ?? 0;
          return <li className={'menu-row' + (quantity > 0 ? ' chosen' : '')} key={item.id}>
            <div className="menu-copy"><strong>{item.name}</strong><span className="muted">{item.available ? item.unit : t('unavailable')}</span></div>
            <div className="stepper" role="group" aria-label={t('quantityFor', { name: item.name })}>
              <Button variant="ghost" aria-label={t('decrease', { name: item.name })} disabled={busy || frozen || quantity === 0} onClick={() => draft.edit({ quantities: { ...draft.quantities, [item.id]: quantity - 1 } })}>−</Button>
              <output aria-label={t('quantityFor', { name: item.name })}>{number(quantity)}</output>
              <Button variant="ghost" aria-label={t('increase', { name: item.name })} disabled={busy || frozen || !item.available || quantity >= Number.MAX_SAFE_INTEGER} onClick={() => { setSubmitted(false); draft.edit({ quantities: { ...draft.quantities, [item.id]: quantity + 1 } }); }}>+</Button>
            </div></li>;
        })}</ul>
        {menu.data && !menu.data.items.some((item) => !item.archived) && <p className="empty">{t('emptyMenu')}</p>}
      </section>
      <section className="panel basket"><Form title={t('yourOrder')} submit={t(frozen ? 'retryOrder' : 'placeOrder')} disabled={offline} showSaved={false} onSubmit={submit}>
        <ul className="basket-items" aria-live="polite">{selected.length === 0 ? <li className="muted">{t('chooseItems')}</li> : selected.map(([id, quantity]) => <li key={id}>
          <span>{nameOf(id)} <span className="muted">× {number(quantity)}</span></span>
          <Button variant="ghost" className="link-button" disabled={busy || frozen} aria-label={t('removeItem', { name: nameOf(id) })} onClick={() => draft.edit({ quantities: { ...draft.quantities, [id]: 0 } })}>{t('remove')}</Button>
        </li>)}</ul>
        <fieldset disabled={busy || frozen}>
          <div className="chips" role="group" aria-label={t('preferences')}>{noteOptions.map((option) => <Button key={option} variant="ghost" className="chip" aria-pressed={noteParts.includes(option)} onClick={() => toggleOption(option)}>{option}</Button>)}</div>
          <Field label={t('orderNote')} name="note" value={draft.note} maxLength={500} onChange={(e) => draft.edit({ note: e.target.value })}/></fieldset>
        {frozen && <p className="notice">{t('retryHelp')}</p>}
        {submitted && <p role="status" className="success">{t('orderPlaced')}</p>}
      </Form></section>
    </div>
    <MyOrders user={user}/>
  </>;
}
export function MyOrders({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const [error, setError] = useState<Error | null>(null);
  const result = useQuery({ queryKey: ['orders', user.id], queryFn: () => api('/orders', ordersResponseSchema) });
  return <section className="my-orders" aria-labelledby="my-orders-heading"><OrderFocus user={user}/>
    <div className="section-heading"><h2 id="my-orders-heading" className="section-title">{t('orders')}</h2><Button variant="ghost" className="link-button" onClick={() => void result.refetch()}>{t('refreshOrders')}</Button></div>
    <ErrorNotice error={error ?? result.error} retry={() => { setError(null); void result.refetch(); }}/>
    {result.isPending && <p role="status" className="muted">{t('loading')}</p>}{result.data?.orders.length === 0 && <p className="empty">{t('noOrders')}</p>}
    <div className="order-list">{result.data?.orders.map((order) => <OrderCard key={order.id + ':' + order.updatedAt + ':' + order.audit.length} order={order} user={user} onError={setError}/>)}</div>
  </section>;
}
export function MenuManagement({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const categoryId = useId();
  const client = useQueryClient();
  const result = useQuery({ queryKey: ['menu', user.id, user.role], queryFn: () => api('/menu', menuResponseSchema) });
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [revision, setRevision] = useState(0);
  return <div className="split"><section><div className="section-heading"><h2 className="section-title">{t('refreshments')}</h2><Button variant="secondary" onClick={() => { setSelected(null); setRevision(revision + 1); }}>{t('addItem')}</Button></div>
    <ErrorNotice error={result.error} retry={() => void result.refetch()}/>{result.isPending && <p role="status" className="muted">{t('loading')}</p>}
    {result.data?.items.length === 0 && <p className="empty">{t('emptyMenu')}</p>}
    <div className="list">{result.data?.items.map((item) => <button className={'row-button' + (selected?.id === item.id ? ' selected' : '')} key={item.id} onClick={() => { setSelected(item); setRevision(revision + 1); }}>
      <span className="menu-copy"><strong>{item.name}</strong><span className="muted">{t('categories.' + item.category)}, {item.unit}</span></span>
      <span className={'badge' + (item.available && !item.archived ? '' : ' badge-off')}>{t(item.archived ? 'archived' : item.available ? 'available' : 'unavailable')}</span>
    </button>)}</div>
    </section><section className="panel" key={revision}><Form title={t(selected ? 'editItem' : 'addItem')} submit={t('save')} onSubmit={async (data) => {
      await api('/menu' + (selected ? '/' + selected.id : ''), menuItemResponseSchema, selected ? 'PATCH' : 'POST', {
        name: text(data, 'name'), category: text(data, 'category'), unit: text(data, 'unit'), available: data.has('available'), archived: data.has('archived'),
      });
      setSelected(null); setRevision(revision + 1);
      await client.invalidateQueries({ queryKey: ['menu', user.id] });
    }}><Field label={t('itemName')} name="name" defaultValue={selected?.name ?? ''} required maxLength={100}/>
      <div className="field"><label htmlFor={categoryId}>{t('category')}</label><select id={categoryId} name="category" defaultValue={selected?.category ?? 'tea'}>{menuCategorySchema.options.map((category) => <option key={category} value={category}>{t('categories.' + category)}</option>)}</select></div>
      <Field label={t('banglaUnit')} name="unit" defaultValue={selected?.unit ?? 'কাপ'} required maxLength={30}/>
      <label className="check"><input type="checkbox" name="available" defaultChecked={selected?.available ?? true}/>{t('available')}</label>
      <label className="check"><input type="checkbox" name="archived" defaultChecked={selected?.archived ?? false}/>{t('archiveItem')}</label>
    </Form></section></div>;
}
