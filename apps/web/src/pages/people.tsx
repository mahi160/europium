import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@office-service/shared';
import { api, userResponse, usersResponse, successResponse } from '../api';
import { number } from '../i18n';
import { Button } from '../components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '../components/ui/dialog';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../components/ui/collapsible';
import { Field as FieldGroup, FieldLabel, FieldSet, FieldLegend } from '../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { ErrorNotice, Field, Form, Password, text } from '../components/forms';

export function People({ current }: { current: PublicUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users', current.id, current.role], queryFn: () => api('/users', usersResponse) });
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [role, setRole] = useState('employee');
  const pin = role !== 'admin';
  const query = search.trim().toLocaleLowerCase();
  const people = users.data?.users.filter((person) => person.name.toLocaleLowerCase().includes(query) || person.username.toLocaleLowerCase().includes(query)) ?? [];
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['users'] });
    await client.invalidateQueries({ queryKey: ['session'] });
  }
  return <Dialog open={open} onOpenChange={setOpen}><section className="grid w-full max-w-3xl gap-4"><div className="flex flex-wrap items-center justify-between gap-4"><span>{t('peopleCount', { countText: number(people.length) })}</span><DialogTrigger render={<Button variant="secondary"/>} onClick={() => { setSelected(null); setRole('employee'); setAdding(true); setResetOpen(false); setRemoving(false); setFeedback(''); }}>{t('createUser')}</DialogTrigger></div>
    <Field label={t('searchPeople')} name="search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}/>
    <ErrorNotice error={users.error} retry={() => void users.refetch()}/>
    <p role="status">{feedback}</p>
    {users.isPending && <p role="status">{t('loading')}</p>}
    {users.data && people.length === 0 && <p>{t(query ? 'noPeopleFound' : 'emptyPeople')}</p>}
    <div className="grid gap-3">{people.map((person) => <Card key={person.id}><CardContent className="flex flex-wrap items-center gap-3">
      <Avatar aria-hidden="true"><AvatarFallback>{Array.from(person.name)[0]}</AvatarFallback></Avatar><div className="grid min-w-0 flex-1 gap-1"><DialogTrigger render={<Button variant="ghost" className="justify-self-start"/>} onClick={() => { setSelected(person); setRole(person.role); setAdding(false); setResetOpen(false); setRemoving(false); setFeedback(''); }}>{person.name}</DialogTrigger><p>{t(person.role)}{person.floor || person.desk ? ', ' + [person.floor && t('floor') + ' ' + person.floor, person.desk && t('desk') + ' ' + person.desk].filter(Boolean).join(', ') : ''}</p></div>{!person.isActive && <Badge variant="secondary">{t('inactive')}</Badge>}
    </CardContent></Card>)}</div>
  </section>
  {removing && selected ? <DialogContent key="remove" showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
    <DialogHeader><DialogTitle>{t('removeUser')}</DialogTitle><DialogDescription>{t('removeUserHelp')}</DialogDescription></DialogHeader>
    <p><strong>{selected.name}</strong> <span>({selected.username})</span></p>
    <Form title={t('removeUser')} hideTitle submit={t('confirmRemoveUser')} variant="destructive" showSaved={false} onSubmit={async () => {
      await api('/users/' + selected.id, successResponse, 'DELETE');
      await refresh();
      setFeedback(t('personRemoved', { name: selected.name }));
      setOpen(false);
    }}><Button variant="secondary" onClick={() => setRemoving(false)}>{t('keepPerson')}</Button></Form>
    <DialogClose render={<Button variant="secondary"/>}>{t('close')}</DialogClose>
  </DialogContent> : (adding || selected) && <DialogContent key="edit" showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>{t(adding ? 'createUser' : 'editUser')}</DialogTitle></DialogHeader><Form key={adding ? 'new' : selected?.id} title={t(adding ? 'createUser' : 'editUser')} hideTitle submit={t(adding ? 'createUser' : 'save')} onSubmit={async (data) => {
    const fields = { name: text(data,'name'), floor: text(data,'floor'), desk: text(data,'desk'), role: text(data,'role'), language: text(data,'language') };
    let roleCrossing = false;
    if (adding) await api('/users', userResponse, 'POST', { ...fields, username: text(data,'username'), password: text(data,'password') });
    else if (selected) {
      const result = await api('/users/' + selected.id, userResponse, 'PATCH', { ...fields, isActive: data.has('isActive') });
      roleCrossing = (result.user.role === 'admin') !== (selected.role === 'admin');
      setSelected(result.user); setRole(result.user.role);
      if (roleCrossing) setResetOpen(true);
    }
    await refresh();
    if (!roleCrossing) setOpen(false);
  }}>
    <Field label={t('name')} name="name" defaultValue={selected?.name ?? ''} required maxLength={100} autoComplete="name"/>
    {adding && <><Field label={t('username')} name="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]+"/><p>{t('usernameHelp')}</p><Password key={pin ? 'pin' : 'password'} pin={pin} defaultValue={pin ? '0000' : ''} label={t(pin ? 'pin' : 'password')} name="password"/><p>{t(pin ? 'defaultPinHelp' : 'passwordHelp')}</p></>}
    <FieldGroup><FieldLabel htmlFor="person-role">{t('role')}</FieldLabel><NativeSelect id="person-role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>{['employee','staff','admin'].map(role => <NativeSelectOption key={role} value={role}>{t(role)}</NativeSelectOption>)}</NativeSelect></FieldGroup>
    {selected && role !== selected.role && (role === 'admin') !== (selected.role === 'admin') && <p>{t('roleCredentialWarning')}</p>}
    <FieldGroup><FieldLabel htmlFor="person-language">{t('language')}</FieldLabel><NativeSelect id="person-language" name="language" defaultValue={selected?.language ?? 'bn'}><NativeSelectOption value="bn">বাংলা</NativeSelectOption><NativeSelectOption value="en">English</NativeSelectOption></NativeSelect></FieldGroup>
    <FieldSet><FieldLegend>{t('delivery')}</FieldLegend><div className="grid gap-4 sm:grid-cols-2"><Field label={t('floor')} name="floor" defaultValue={selected?.floor ?? ''} maxLength={100}/><Field label={t('desk')} name="desk" defaultValue={selected?.desk ?? ''} maxLength={100}/></div></FieldSet>
    {selected && <><FieldGroup orientation="horizontal"><Checkbox id="person-active" name="isActive" value="on" defaultChecked={selected.isActive}/><FieldLabel htmlFor="person-active">{t('active')}</FieldLabel></FieldGroup><p>{t('accessHelp')}</p></>}
  </Form>{selected && selected.id !== current.id && <Collapsible className="grid gap-4" open={resetOpen} onOpenChange={setResetOpen}><CollapsibleTrigger render={<Button variant="secondary"/>}>{t(selected.role === 'admin' ? 'resetPassword' : 'resetPin')}</CollapsibleTrigger><CollapsibleContent><Form key={selected.role} title={t(selected.role === 'admin' ? 'resetPassword' : 'resetPin')} hideTitle description={t(selected.role === 'admin' ? 'resetHelp' : 'resetPinHelp')} submit={t(selected.role === 'admin' ? 'resetPassword' : 'resetPin')} variant="secondary" onSubmit={async (data) => {
    await api('/users/' + selected.id + '/reset-password', successResponse, 'POST', { newPassword: text(data,'newPassword') }); await refresh();
  }}><Password key={selected.role === 'admin' ? 'password' : 'pin'} pin={selected.role !== 'admin'} label={t(selected.role === 'admin' ? 'newPassword' : 'newPin')} name="newPassword"/></Form></CollapsibleContent></Collapsible>}
    {selected && selected.id !== current.id && <div><Button variant="destructive" onClick={() => setRemoving(true)}>{t('removeUser')}</Button></div>}
    <DialogClose render={<Button variant="secondary"/>}>{t('close')}</DialogClose>
  </DialogContent>}
  </Dialog>;
}
