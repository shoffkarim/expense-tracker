import { useConfirm } from './Confirm';
import { TextInput, Button, Textarea } from '@mantine/core';
import { Choice, CalendarInput } from './Controls';
import { TagInput } from './Tags';
import { useState, type FormEvent } from 'react';
import { api, type Account, type Category, type Kind, type Operation, type OperationInput, type Screen } from './api';
import { Appearance, ErrorNotice, Modal, message, money, moneyInput, cleanMoneyInput, parseMoneyInput, today } from './ui';

type FormProps = { onClose: () => void; onSaved: (notice: string) => void };
export function AccountForm({ account, onClose, onSaved }: FormProps & { account?: Account }) {
 const { confirm, confirming } = useConfirm();
  const [name, setName] = useState(account?.name || '');
  const [color, setColor] = useState(account?.color || '#658c73');
  const [icon, setIcon] = useState(account?.icon || 'wallet');
  const [balance, setBalance] = useState(moneyInput(account?.balanceMinor || 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || confirming) return; setError(''); setBusy(true);
    try {
      await api(`/accounts${account ? `/${account.id}` : ''}`, account ? 'PATCH' : 'POST', { name, color, icon, balanceMinor: parseMoneyInput(balance, true) });
      onSaved(account ? 'Счёт обновлён.' : 'Счёт создан.'); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archive() {
    if (!account || !await confirm(`Убрать счёт «${account.name}» в архив? Его остаток ${money(account.balanceMinor)} больше не войдёт в общий баланс. История сохранится.`)) return;
    setBusy(true); setError('');
    try { await api(`/accounts/${account.id}`, 'DELETE'); onSaved('Счёт перенесён в архив.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={account ? 'Редактировать счёт' : 'Новый счёт'} busy={busy || confirming} onClose={onClose}><form onSubmit={save}>
    <fieldset disabled={busy || confirming}>
      <TextInput label="Название" className="field" autoFocus data-autofocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Например, основная карта" disabled={busy || confirming} />
      <TextInput label={account ? 'Текущий баланс, ₽' : 'Начальный баланс, ₽'} className="field" required inputMode="decimal" value={balance} onChange={e => setBalance(cleanMoneyInput(e.target, true))} disabled={busy || confirming} />
      <p className="field-note">{account ? 'Изменение остатка не учитывается в доходах и расходах.' : 'Каждая сохранённая операция изменит этот остаток, независимо от её даты.'}</p>
      <Appearance disabled={busy || confirming} color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
      <ErrorNotice error={error} />
      <div className="form-actions">{account && <Button color="red" variant="light" type="button" className="danger-button" onClick={() => void archive()}>В архив</Button>}<Button className="primary-button" type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</Button></div>
    </fieldset>
  </form></Modal>;
}

export function CategoryForm({ category, kind, onClose, onSaved }: FormProps & { category?: Category; kind: 'expense' | 'income' }) {
 const { confirm, confirming } = useConfirm();
  const [name, setName] = useState(category?.name || '');
  const [color, setColor] = useState(category?.color || '#c87946');
  const [icon, setIcon] = useState(category?.icon || 'other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || confirming) return; setBusy(true); setError('');
    try { await api(`/categories${category ? `/${category.id}` : ''}`, category ? 'PATCH' : 'POST', { kind, name, color, icon }); onSaved('Категория сохранена.'); onClose(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archive() {
    if (!category || !await confirm(`Убрать категорию «${category.name}» в архив? Операции и их суммы сохранятся.`)) return;
    setBusy(true); setError('');
    try { await api(`/categories/${category.id}`, 'DELETE'); onSaved('Категория перенесена в архив.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={category ? 'Редактировать категорию' : kind === 'income' ? 'Новая категория дохода' : 'Новая категория расхода'} busy={busy || confirming} onClose={onClose}><form onSubmit={save}><fieldset disabled={busy || confirming}>
    <TextInput label="Название" className="field" autoFocus data-autofocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy || confirming} />
    <Appearance disabled={busy || confirming} color={color} icon={icon} onColor={setColor} onIcon={setIcon} /><ErrorNotice error={error} />
    <div className="form-actions">{category && <Button color="red" variant="light" type="button" className="danger-button" onClick={() => void archive()}>В архив</Button>}<Button type="submit" className="primary-button">{busy ? 'Сохраняем…' : 'Сохранить'}</Button></div>
  </fieldset></form></Modal>;
}

export function OperationForm({ operation, screen, onClose, onSaved }: FormProps & { operation?: Operation; screen: Screen }) {
 const { confirm, confirming } = useConfirm();
  const [kind, setKind] = useState<Kind>(operation?.kind || 'expense');
  const [date, setDate] = useState(operation?.date || today());
  const [amount, setAmount] = useState(operation ? moneyInput(operation.amountMinor) : '');
  const [source, setSource] = useState(operation?.sourceAccountId || 0);
  const [destination, setDestination] = useState(operation?.destinationAccountId || 0);
  const [category, setCategory] = useState(operation?.categoryId || 0);
  const [description, setDescription] = useState(operation?.description || '');
  const [tags, setTags] = useState<string[]>(operation?.tags || []);
  const [comment, setComment] = useState(operation?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accounts = screen.accounts.filter(a => !a.archived || a.id === operation?.sourceAccountId || a.id === operation?.destinationAccountId);
  const categories = screen.categories.filter(c => c.kind === kind && (!c.archived || c.id === operation?.categoryId));
  function accountSelect(label: string, value: number, change: (id: number) => void, exclude?: number) {
    return <Choice label={label} className="field" required value={value || ''} onChange={e => change(Number(e.target.value))} disabled={busy || confirming}><option value="">Выберите счёт</option>{accounts.filter(a => a.id !== exclude).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · в архиве' : ''}</option>)}</Choice>;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || confirming) return; setBusy(true); setError('');
    try {
      const amountMinor = parseMoneyInput(amount);
      if (amountMinor <= 0) throw new Error('Сумма должна быть больше нуля.');
      const input: OperationInput = { tags, kind, date, amountMinor, description, comment, ...(kind !== 'income' ? { sourceAccountId: source } : {}), ...(kind !== 'expense' ? { destinationAccountId: destination } : {}), ...(kind !== 'transfer' ? { categoryId: category } : {}) };
      await api(`/transactions${operation ? `/${operation.id}` : ''}`, operation ? 'PATCH' : 'POST', input);
      onSaved('Операция сохранена. Балансы и итоги обновлены.'); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!operation || !await confirm('Удалить операцию? Её влияние на балансы и суммы категорий будет отменено.')) return;
    setBusy(true); setError('');
    try { await api(`/transactions/${operation.id}`, 'DELETE'); onSaved('Операция удалена. Балансы и итоги обновлены.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={operation ? 'Редактировать операцию' : 'Новая операция'} busy={busy || confirming} onClose={onClose}><form onSubmit={save}><fieldset disabled={busy || confirming}>
    <Choice label="Тип операции" className="field" value={kind} onChange={e => { setKind(e.target.value as Kind); setCategory(0); }} disabled={busy || confirming}><option value="expense">Расход</option><option value="income">Доход</option><option value="transfer">Перевод</option></Choice>
    <div className="form-grid"><TextInput label="Сумма, ₽" className="field" autoFocus data-autofocus required inputMode="decimal" value={amount} onChange={e => setAmount(cleanMoneyInput(e.target))} placeholder="0,00" disabled={busy || confirming} /><CalendarInput label="Дата" className="field" required min="1900-01-01" max="9999-12-31" value={date} onChange={e => setDate(e.target.value)} disabled={busy || confirming} /></div>
    {kind !== 'income' && accountSelect('Откуда', source, setSource, kind === 'transfer' ? destination : undefined)}
    {kind !== 'expense' && accountSelect('Куда', destination, setDestination, kind === 'transfer' ? source : undefined)}
    {kind !== 'transfer' && <Choice label={kind === 'income' ? 'Источник дохода' : 'Категория расхода'} className="field" required value={category || ''} onChange={e => setCategory(Number(e.target.value))} disabled={busy || confirming}><option value="">Выберите категорию</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' · в архиве' : ''}</option>)}</Choice>}
    <TextInput label="Описание" className="field" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} disabled={busy || confirming} />
    <TagInput value={tags} onChange={setTags} disabled={busy || confirming} />
    <Textarea label="Комментарий" className="field" maxLength={2000} rows={2} value={comment} onChange={e => setComment(e.target.value)} disabled={busy || confirming} />
    <ErrorNotice error={error} /><div className="form-actions">{operation && <Button color="red" variant="light" className="danger-button" type="button" onClick={() => void remove()}>Удалить</Button>}<Button type="submit" className="primary-button">{busy ? 'Сохраняем…' : 'Сохранить'}</Button></div>
  </fieldset></form></Modal>;
}
