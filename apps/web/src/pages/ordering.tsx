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
import { OrderCard } from '../components/order-card';
import { ErrorNotice, Field, Form, text } from '../components/forms';
import { Button } from '../components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Card, CardContent } from '../components/ui/card';
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
  const review = useRef<HTMLElement>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [servings, setServings] = useState(1);
  const [added, setAdded] = useState('');
  const items = (menu.data?.items ?? []).filter((item) => !item.archived);
  const chosen = items.find((item) => item.id === chosenId) ?? items[0];
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
      await client.invalidateQueries({ queryKey: ['orders', user.id] });
      setSubmittedId(result.order.id);
    } catch (cause) {
      if (cause instanceof ApiError && ['VALIDATION_ERROR', 'ITEM_UNAVAILABLE'].includes(cause.code)) {
        store.getState().rejected();
        void menu.refetch();
      }
      throw cause instanceof z.ZodError && !store.getState().attempted ? new ApiError('VALIDATION_ERROR') : cause;
    } finally { setBusy(false); }
  }
  return <div className="kiosk-ordering">
    <div className="kiosk-toolbar"><RealtimeStatus/><Button className="kiosk-basket" variant="secondary" onClick={() => { review.current?.focus(); review.current?.scrollIntoView({ block: 'start' }); }}>{t('yourOrder')} <span>{number(total)}</span></Button></div>
    <div className="kiosk-content">
      <section className="kiosk-copy" aria-labelledby="kiosk-heading">
        <h1 id="kiosk-heading">{t('kiosk.title')}</h1>
        <p>{t('kiosk.intro')}</p>
        <h2 className="sr-only">{t('refreshments')}</h2>
        {menu.isPending && <p role="status">{t('loading')}</p>}
        <ErrorNotice error={menu.error} retry={() => void menu.refetch()}/>
        <div className="kiosk-choices" role="group" aria-label={t('kiosk.selection')}>
          {items.map((item) => <Button key={item.id} variant="outline" aria-pressed={chosen?.id === item.id} onClick={() => { setChosenId(item.id); setServings(1); setAdded(''); }}>{item.name}{!item.available && <span className="sr-only"> · {t('unavailable')}</span>}</Button>)}
        </div>
        {menu.data && items.length === 0 && <FieldDescription>{t('emptyMenu')}</FieldDescription>}
      </section>
      {chosen && <section className="kiosk-product" aria-labelledby="chosen-name">
        <div className="kiosk-stage"><RefreshmentArt category={chosen.category}/><p>{t('kiosk.prepared')}</p></div>
        <div className="kiosk-choice">
          <div><h2 id="chosen-name">{chosen.name}</h2><p>{chosen.available ? chosen.unit : t('unavailable')}</p></div>
          <div className="kiosk-stepper" role="group" aria-label={t('kiosk.servings')}>
            <Button variant="outline" size="icon" aria-label={t('kiosk.decrease')} disabled={busy || frozen || servings === 1} onClick={() => setServings(servings - 1)}><IconMinus aria-hidden="true"/></Button>
            <output aria-label={t('kiosk.servings')}>{number(servings)}</output>
            <Button variant="outline" size="icon" aria-label={t('kiosk.increase')} disabled={busy || frozen || servings >= Number.MAX_SAFE_INTEGER - (draft.quantities[chosen.id] ?? 0)} onClick={() => setServings(servings + 1)}><IconPlus aria-hidden="true"/></Button>
          </div>
        </div>
        <Button className="kiosk-add" disabled={busy || frozen || !chosen.available || servings > Number.MAX_SAFE_INTEGER - (draft.quantities[chosen.id] ?? 0)} onClick={() => {
          draft.edit({ quantities: { ...draft.quantities, [chosen.id]: (draft.quantities[chosen.id] ?? 0) + servings } });
          setSubmittedId(null);
          setAdded(t('kiosk.added', { name: chosen.name }));
        }}>{t('kiosk.add', { quantity: number(servings) })}<span aria-hidden="true">→</span></Button>
        <p className="kiosk-added" role="status">{added}</p>
      </section>}
    </div>
    <footer className="kiosk-delivery"><p>{location ? <>{t('kiosk.delivery')} <strong>{location}</strong></> : t('kiosk.locationHelp')}</p><p>{t('kiosk.footer')}</p></footer>
    <section className="kiosk-review" ref={review} tabIndex={-1} aria-label={t('kiosk.review')}>
      <div className="kiosk-section-heading"><h2>{t('yourOrder')}</h2><span>{t('kiosk.count', { quantity: number(total) })}</span></div>
      {selected.length > 0 || frozen || draft.note !== '' ? <Form title={t('yourOrder')} hideTitle submit={t(frozen ? 'retryOrder' : 'placeOrder')} disabled={offline || (selected.length === 0 && !frozen)} showSaved={false} onSubmit={submit}>
        <ul className="kiosk-order-lines">{selected.map(([id, quantity]) => {
          const item = items.find((item) => item.id === id);
          const name = item?.name ?? t('removedItem');
          return <li key={id}><div><strong>{name}</strong>{item && !item.available && <FieldDescription>{t('unavailable')}</FieldDescription>}</div><span>× {number(quantity)}</span><Button variant="ghost" aria-label={t('removeItem', { name })} disabled={busy || frozen} onClick={() => { draft.edit({ quantities: { ...draft.quantities, [id]: 0 } }); setAdded(''); }}>{t('remove')}</Button></li>;
        })}</ul>
        <Field label={t('orderNote')} name="note" value={draft.note} disabled={busy || frozen} maxLength={500} onChange={(event) => draft.edit({ note: event.target.value })}/>
        {frozen && <Alert role="status"><AlertDescription>{t('retryHelp')}</AlertDescription></Alert>}
      </Form> : <FieldDescription>{t('chooseItems')}</FieldDescription>}
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
function RefreshmentArt({ category }: { category: MenuItem['category'] }) {
  return <svg className="refreshment-art" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {category === 'water' ? <><path d="M30 20h40l-5 64H35L30 20Z"/><path d="M33 46c12 7 22-7 35 0M39 72h16"/></>
      : category === 'snack' ? <><path d="M15 46h70c-4 41-65 41-70 0ZM28 38l6-10 9 9 8-15 10 13 9-6 7 10M40 84h21"/></>
      : <><path d="M22 42h49v22c0 17-49 17-49 0V42Z"/><path d="M71 45h7c17 0 17 20-7 20M16 84h62M37 16v14M52 12v18"/></>}
  </svg>;
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
