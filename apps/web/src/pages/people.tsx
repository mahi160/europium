import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@office-service/shared';
import { api, userResponse, usersResponse, successResponse } from '../api';
import { Button } from '../components/ui/button';
import { ErrorNotice, Field, Form, Password, text } from '../components/forms';

export function People({ current }: { current: PublicUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users', current.id, current.role], queryFn: () => api('/users', usersResponse) });
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [adding, setAdding] = useState(false);
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['users'] });
    await client.invalidateQueries({ queryKey: ['session'] });
  }
  return <div className="split"><section><div className="section-heading"><h2 className="section-title">{t('users')}</h2><Button variant="secondary" onClick={() => { setSelected(null); setAdding(true); }}>{t('createUser')}</Button></div>
    <ErrorNotice error={users.error} retry={() => void users.refetch()}/>
    {users.isPending && <p role="status" className="muted">{t('loading')}</p>}
    <div className="list">{users.data?.users.map((person) => <button type="button" className={'row-button' + (selected?.id === person.id ? ' selected' : '')} key={person.id} onClick={() => { setSelected(person); setAdding(false); }}>
      <span className="avatar" aria-hidden="true">{person.name.slice(0,1)}</span><span className="menu-copy"><strong>{person.name}</strong><span className="muted">{t(person.role)}{person.floor || person.desk ? ', ' + [person.floor && t('floor') + ' ' + person.floor, person.desk && t('desk') + ' ' + person.desk].filter(Boolean).join(', ') : ''}</span></span>{!person.isActive && <span className="badge badge-off">{t('inactive')}</span>}
    </button>)}</div>
  </section><section className="panel" key={adding ? 'new' : selected?.id ?? 'empty'}>
  {adding || selected ? <><Form title={t(adding ? 'createUser' : 'editUser')} submit={t(adding ? 'createUser' : 'save')} onSubmit={async (data) => {
    const fields = { name: text(data,'name'), floor: text(data,'floor'), desk: text(data,'desk'), role: text(data,'role'), language: text(data,'language') };
    if (adding) await api('/users', userResponse, 'POST', { ...fields, username: text(data,'username'), password: text(data,'password') });
    else if (selected) {
      const result = await api('/users/' + selected.id, userResponse, 'PATCH', { ...fields, isActive: data.has('isActive') }); setSelected(result.user);
    }
    await refresh();
    if (adding) { setAdding(false); }
  }}>
    <Field label={t('name')} name="name" defaultValue={selected?.name ?? ''} required maxLength={100} autoComplete="name"/>
    {adding && <><Field label={t('username')} name="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]+"/><p className="hint">{t('usernameHelp')}</p><Password label={t('password')} name="password"/><p className="hint">{t('passwordHelp')}</p></>}
    <div className="field"><label htmlFor="person-role">{t('role')}</label><select id="person-role" name="role" defaultValue={selected?.role ?? 'employee'}>{['employee','staff','admin'].map(role => <option key={role} value={role}>{t(role)}</option>)}</select></div>
    <div className="field"><label htmlFor="person-language">{t('language')}</label><select id="person-language" name="language" defaultValue={selected?.language ?? 'bn'}><option value="bn">বাংলা</option><option value="en">English</option></select></div>
    <fieldset><legend>{t('delivery')}</legend><div className="field-pair"><Field label={t('floor')} name="floor" defaultValue={selected?.floor ?? ''} maxLength={100}/><Field label={t('desk')} name="desk" defaultValue={selected?.desk ?? ''} maxLength={100}/></div></fieldset>
    {selected && <><label className="check"><input name="isActive" type="checkbox" defaultChecked={selected.isActive}/>{t('active')}</label><p className="hint">{t('accessHelp')}</p></>}
  </Form>{selected && selected.id !== current.id && <div className="reset-section"><Form title={t('resetPassword')} description={t('resetHelp')} submit={t('resetPassword')} onSubmit={async (data) => {
    await api('/users/' + selected.id + '/reset-password', successResponse, 'POST', { newPassword: text(data,'newPassword') }); await refresh();
  }}><Password label={t('newPassword')} name="newPassword"/></Form></div>}</> : <p className="empty">{t('choosePerson')}</p>}
  </section></div>;
}
