import { useState, type FormEvent } from 'react';
import { api, type Account, type Category, type Kind, type Operation, type OperationInput, type Screen } from './api';
import { Appearance, ErrorNotice, Modal, message, money, moneyInput, parseMoneyInput, today } from './ui';

type FormProps = { onClose: () => void; onSaved: (notice: string) => void };
export function AccountForm({ account, onClose, onSaved }: FormProps & { account?: Account }) {
  const [name, setName] = useState(account?.name || '');
  const [color, setColor] = useState(account?.color || '#658c73');
  const [icon, setIcon] = useState(account?.icon || 'wallet');
  const [balance, setBalance] = useState(moneyInput(account?.balanceMinor || 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try {
      await api(`/accounts${account ? `/${account.id}` : ''}`, account ? 'PATCH' : 'POST', { name, color, icon, balanceMinor: parseMoneyInput(balance, true) });
      onSaved(account ? 'Счёт обновлён.' : 'Счёт создан.'); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archive() {
    if (!account || !window.confirm(`Убрать счёт «${account.name}» в архив? Его остаток ${money(account.balanceMinor)} больше не войдёт в общий баланс. История сохранится.`)) return;
    setBusy(true); setError('');
    try { await api(`/accounts/${account.id}`, 'DELETE'); onSaved('Счёт перенесён в архив.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={account ? 'Редактировать счёт' : 'Новый счёт'} busy={busy} onClose={onClose}><form onSubmit={save}>
    <fieldset disabled={busy}>
      <label className="field">Название<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Например, основная карта" /></label>
      <label className="field">{account ? 'Текущий баланс, ₽' : 'Начальный баланс, ₽'}<input required inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} /></label>
      <p className="field-note">{account ? 'Изменение остатка не учитывается в доходах и расходах.' : 'Каждая сохранённая операция изменит этот остаток, независимо от её даты.'}</p>
      <Appearance color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
      <ErrorNotice error={error} />
      <div className="form-actions">{account && <button type="button" className="danger-button" onClick={() => void archive()}>В архив</button>}<button className="primary-button" type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>
    </fieldset>
  </form></Modal>;
}

export function CategoryForm({ category, kind, onClose, onSaved }: FormProps & { category?: Category; kind: 'expense' | 'income' }) {
  const [name, setName] = useState(category?.name || '');
  const [color, setColor] = useState(category?.color || '#c87946');
  const [icon, setIcon] = useState(category?.icon || 'other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await api(`/categories${category ? `/${category.id}` : ''}`, category ? 'PATCH' : 'POST', { kind, name, color, icon }); onSaved('Категория сохранена.'); onClose(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archive() {
    if (!category || !window.confirm(`Убрать категорию «${category.name}» в архив? Операции и их суммы сохранятся.`)) return;
    setBusy(true); setError('');
    try { await api(`/categories/${category.id}`, 'DELETE'); onSaved('Категория перенесена в архив.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={category ? 'Редактировать категорию' : kind === 'income' ? 'Новая категория дохода' : 'Новая категория расхода'} busy={busy} onClose={onClose}><form onSubmit={save}><fieldset disabled={busy}>
    <label className="field">Название<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
    <Appearance color={color} icon={icon} onColor={setColor} onIcon={setIcon} /><ErrorNotice error={error} />
    <div className="form-actions">{category && <button type="button" className="danger-button" onClick={() => void archive()}>В архив</button>}<button type="submit" className="primary-button">{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </fieldset></form></Modal>;
}

export function OperationForm({ operation, screen, onClose, onSaved }: FormProps & { operation?: Operation; screen: Screen }) {
  const [kind, setKind] = useState<Kind>(operation?.kind || 'expense');
  const [date, setDate] = useState(operation?.date || today());
  const [amount, setAmount] = useState(operation ? moneyInput(operation.amountMinor) : '');
  const [source, setSource] = useState(operation?.sourceAccountId || 0);
  const [destination, setDestination] = useState(operation?.destinationAccountId || 0);
  const [category, setCategory] = useState(operation?.categoryId || 0);
  const [description, setDescription] = useState(operation?.description || '');
  const [comment, setComment] = useState(operation?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accounts = screen.accounts.filter(a => !a.archived || a.id === operation?.sourceAccountId || a.id === operation?.destinationAccountId);
  const categories = screen.categories.filter(c => c.kind === kind && (!c.archived || c.id === operation?.categoryId));
  function accountSelect(label: string, value: number, change: (id: number) => void, exclude?: number) {
    return <label className="field">{label}<select required value={value || ''} onChange={e => change(Number(e.target.value))}><option value="">Выберите счёт</option>{accounts.filter(a => a.id !== exclude).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · в архиве' : ''}</option>)}</select></label>;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const amountMinor = parseMoneyInput(amount);
      if (amountMinor <= 0) throw new Error('Сумма должна быть больше нуля.');
      const input: OperationInput = { kind, date, amountMinor, description, comment, ...(kind !== 'income' ? { sourceAccountId: source } : {}), ...(kind !== 'expense' ? { destinationAccountId: destination } : {}), ...(kind !== 'transfer' ? { categoryId: category } : {}) };
      await api(`/transactions${operation ? `/${operation.id}` : ''}`, operation ? 'PATCH' : 'POST', input);
      onSaved('Операция сохранена. Балансы и итоги обновлены.'); onClose();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!operation || !window.confirm('Удалить операцию? Её влияние на балансы и суммы категорий будет отменено.')) return;
    setBusy(true); setError('');
    try { await api(`/transactions/${operation.id}`, 'DELETE'); onSaved('Операция удалена. Балансы и итоги обновлены.'); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={operation ? 'Редактировать операцию' : 'Новая операция'} busy={busy} onClose={onClose}><form onSubmit={save}><fieldset disabled={busy}>
    <label className="field">Тип операции<select value={kind} onChange={e => { setKind(e.target.value as Kind); setCategory(0); }}><option value="expense">Расход</option><option value="income">Доход</option><option value="transfer">Перевод</option></select></label>
    <div className="form-grid"><label className="field">Сумма, ₽<input autoFocus required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" /></label><label className="field">Дата<input required type="date" min="1900-01-01" max="9999-12-31" value={date} onChange={e => setDate(e.target.value)} /></label></div>
    {kind !== 'income' && accountSelect('Откуда', source, setSource, kind === 'transfer' ? destination : undefined)}
    {kind !== 'expense' && accountSelect('Куда', destination, setDestination, kind === 'transfer' ? source : undefined)}
    {kind !== 'transfer' && <label className="field">{kind === 'income' ? 'Источник дохода' : 'Категория расхода'}<select required value={category || ''} onChange={e => setCategory(Number(e.target.value))}><option value="">Выберите категорию</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' · в архиве' : ''}</option>)}</select></label>}
    <label className="field">Описание<input maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label>
    <label className="field">Комментарий<textarea maxLength={2000} rows={2} value={comment} onChange={e => setComment(e.target.value)} /></label>
    <ErrorNotice error={error} /><div className="form-actions">{operation && <button className="danger-button" type="button" onClick={() => void remove()}>Удалить</button>}<button type="submit" className="primary-button">{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>
  </fieldset></form></Modal>;
}
