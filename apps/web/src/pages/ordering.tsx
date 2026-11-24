import { useEffect, useId, useRef, useState } from 'react';
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
import { cacheOrder, refreshOrders } from '../order-cache';
import { OrderCard } from '../components/order-card';
import { ErrorNotice, Field, Form, text } from '../components/forms';
import { Button } from '../components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Card, CardContent } from '../components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Field as FieldRoot, FieldDescription, FieldLabel } from '../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { RealtimeStatus, useOffline } from '../realtime';

export function Ordering({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const offline = useOffline();
  const store = draftFor(user.id);
  const draft = useStore(store);
  const menu = useQuery({ queryKey: ['menu', user.id, user.role], queryFn: () => api('/menu', menuResponseSchema) });
  const orders = useQuery({ queryKey: ['orders', user.id], queryFn: () => api('/orders', ordersResponseSchema) });
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<Error | null>(null);
  const confirmation = useRef<HTMLElement>(null);

  const [added, setAdded] = useState('');
  const [noteOpen, setNoteOpen] = useState(draft.note !== '');
  const items = (menu.data?.items ?? []).filter((item) => !item.archived);
  useEffect(() => {
    if (submittedId) { confirmation.current?.focus(); confirmation.current?.scrollIntoView({ block: 'start' }); }
  }, [submittedId]);
  const frozen = draft.attempted !== null;
  const selected = Object.entries(draft.quantities).filter(([, quantity]) => quantity > 0);
  const total = selected.reduce((sum, [, quantity]) => sum + quantity, 0);
  const location = [user.floor && t('floor') + ' ' + user.floor, user.desk && t('desk') + ' ' + user.desk].filter(Boolean).join(' · ');
  async function submit() {
    if (!navigator.onLine || offline) throw new ApiError('NETWORK_ERROR');
    if (busy) return;
    setBusy(true);
    try {
      const payload = store.getState().attempt();
      const result = await api('/orders', orderResponseSchema, 'POST', payload);
      store.getState().clear();
      await cacheOrder(client, user, result.order);
      setSubmittedId(result.order.id);
      void refreshOrders(client, user.id);
    } catch (cause) {
      if (cause instanceof ApiError && ['VALIDATION_ERROR', 'ITEM_UNAVAILABLE'].includes(cause.code)) {
        store.getState().rejected();
        void menu.refetch();
      }
      throw cause instanceof z.ZodError && !store.getState().attempted ? new ApiError('VALIDATION_ERROR') : cause;
    } finally { setBusy(false); }
  }
  function changeQuantity(id: string, delta: number) {
    const state = store.getState();
    const quantity = (state.quantities[id] ?? 0) + delta;
    if (busy || state.attempted || quantity < 0 || !Number.isSafeInteger(quantity)) return;
    state.edit({ quantities: { ...state.quantities, [id]: quantity } });
    setSubmittedId(null);
    if (delta > 0) setAdded(t('kiosk.added', { name: items.find((item) => item.id === id)?.name }));
    else setAdded('');
  }
  return <div className="kiosk-ordering">
    <div className="flex flex-wrap items-baseline justify-between gap-3"><h1>{t('refreshments')}</h1><RealtimeStatus/></div>
    <p className="kiosk-delivery">{location ? <>{t('kiosk.delivery')} <strong>{location}</strong></> : t('kiosk.locationHelp')}</p>
    {menu.isPending && <p role="status">{t('loading')}</p>}
    <ErrorNotice error={menu.error} retry={() => void menu.refetch()}/>
    <div className="kiosk-choices" role="group" aria-label={t('kiosk.selection')}>
      {items.map((item) => <Button key={item.id} variant="outline" disabled={busy || frozen || !item.available || draft.quantities[item.id] === Number.MAX_SAFE_INTEGER} onClick={() => changeQuantity(item.id, 1)}>
        {item.name}{!item.available && <span> · {t('unavailable')}</span>}
      </Button>)}
    </div>
    {menu.data && items.length === 0 && <FieldDescription>{t('emptyMenu')}</FieldDescription>}
    <p className="sr-only" role="status">{added}</p>
    <section className="kiosk-review" aria-label={t('kiosk.review')}>
      <h2>{t('yourOrder')}</h2>
      <Form title={t('yourOrder')} hideTitle submit={frozen ? t('retryOrder') : t('sendOrder', { countText: number(total) })} submitClassName="order-send-bar" disabled={offline || (!selected.length && !frozen)} showSaved={false} onSubmit={submit}>
        {selected.length === 0 ? <FieldDescription>{t('chooseItems')}</FieldDescription> : <ul className="kiosk-order-lines">{selected.map(([id, quantity]) => {
          const item = items.find((item) => item.id === id);
          const name = item?.name ?? t('removedItem');
          return <li key={id}><div><strong>{name}</strong>{!item?.available && <FieldDescription>{t('unavailable')}</FieldDescription>}</div>
            <Button type="button" variant="outline" size="icon" aria-label={t('decrease', { name })} disabled={busy || frozen} onClick={() => changeQuantity(id, -1)}><IconMinus aria-hidden="true"/></Button>
            <span>{number(quantity)}</span>
            <Button type="button" variant="outline" size="icon" aria-label={t('increase', { name })} disabled={busy || frozen || !item?.available || quantity === Number.MAX_SAFE_INTEGER} onClick={() => changeQuantity(id, 1)}><IconPlus aria-hidden="true"/></Button>
          </li>;
        })}</ul>}
        <Collapsible open={noteOpen} onOpenChange={setNoteOpen}>
          <CollapsibleTrigger render={<Button variant="ghost"/>}>{t('orderNote')}</CollapsibleTrigger>
          <CollapsibleContent><Field label={t('orderNote')} name="note" value={draft.note} disabled={busy || frozen} maxLength={500} onChange={(event) => draft.edit({ note: event.target.value })}/></CollapsibleContent>
        </Collapsible>
        {frozen && <Alert role="status"><AlertDescription>{t('retryHelp')}</AlertDescription></Alert>}
      </Form>
      {submittedId && <section className="kiosk-confirmation" ref={confirmation} tabIndex={-1} aria-label={t('orderPlaced')}><p role="status">{t('orderPlaced')}</p></section>}
    </section>
    <section className="kiosk-history" aria-labelledby="orders-heading">
      <h2 id="orders-heading">{t('orders')}</h2>
      <ErrorNotice error={orderError ?? orders.error} retry={() => { setOrderError(null); void orders.refetch(); }}/>
      {orders.isPending && <p role="status">{t('loading')}</p>}
      {orders.data?.orders.length === 0 && <FieldDescription>{t('noOrders')}</FieldDescription>}
      <div className="kiosk-order-history">{orders.data?.orders.map((order) => <OrderCard key={order.id} order={order} user={user} onError={setOrderError}/>)}</div>
    </section>
  </div>;
}

export function MenuManagement({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const categoryId = useId();
  const availableId = useId();
  const archivedId = useId();
  const client = useQueryClient();
  const result = useQuery({ queryKey: ['menu', user.id, user.role], queryFn: () => api('/menu', menuResponseSchema) });
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><section className="grid max-w-3xl gap-4" aria-label={t('menu')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><FieldDescription>{t('refreshments')}</FieldDescription><DialogTrigger render={<Button variant="secondary"/>} onClick={() => setSelected(null)}>{t('addItem')}</DialogTrigger></div>
    <ErrorNotice error={result.error} retry={() => void result.refetch()}/>{result.isPending && <p role="status">{t('loading')}</p>}
    {result.data?.items.length === 0 && <FieldDescription>{t('emptyMenu')}</FieldDescription>}
    <div className="grid gap-2">{result.data?.items.map((item) => <Card key={item.id}><CardContent className="flex flex-wrap items-center justify-between gap-3"><div className="grid gap-1"><DialogTrigger render={<Button variant="ghost"/>} onClick={() => setSelected(item)}>{item.name}</DialogTrigger><FieldDescription>{t('categories.' + item.category)}, {item.unit}</FieldDescription></div>
      <Badge variant={item.available && !item.archived ? 'default' : 'secondary'}>{t(item.archived ? 'archived' : item.available ? 'available' : 'unavailable')}</Badge>
    </CardContent></Card>)}</div>
  </section><DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t(selected ? 'editItem' : 'addItem')}</DialogTitle></DialogHeader>
    <Form key={selected?.id ?? 'new'} hideTitle title={t(selected ? 'editItem' : 'addItem')} submit={t('save')} onSubmit={async (data) => {
      await api('/menu' + (selected ? '/' + selected.id : ''), menuItemResponseSchema, selected ? 'PATCH' : 'POST', {
        name: text(data, 'name'), category: text(data, 'category'), unit: text(data, 'unit'), available: data.has('available'), archived: data.has('archived'),
      });
      await client.invalidateQueries({ queryKey: ['menu'] });
      setOpen(false);
    }}><Field label={t('itemName')} name="name" defaultValue={selected?.name ?? ''} required maxLength={100}/>
      <FieldRoot><FieldLabel htmlFor={categoryId}>{t('category')}</FieldLabel><NativeSelect id={categoryId} name="category" defaultValue={selected?.category ?? 'tea'}>{menuCategorySchema.options.map((category) => <NativeSelectOption key={category} value={category}>{t('categories.' + category)}</NativeSelectOption>)}</NativeSelect></FieldRoot>
      <Field label={t('banglaUnit')} name="unit" defaultValue={selected?.unit ?? 'কাপ'} required maxLength={30}/>
      <FieldRoot orientation="horizontal"><Checkbox id={availableId} name="available" defaultChecked={selected?.available ?? true}/><FieldLabel htmlFor={availableId}>{t('available')}</FieldLabel></FieldRoot>
      <FieldRoot orientation="horizontal"><Checkbox id={archivedId} name="archived" defaultChecked={selected?.archived ?? false}/><FieldLabel htmlFor={archivedId}>{t('archiveItem')}</FieldLabel></FieldRoot>
    </Form><DialogClose render={<Button variant="outline"/>}>{t('close')}</DialogClose>
  </DialogContent></Dialog>;
}
