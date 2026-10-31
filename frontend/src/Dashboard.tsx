import { useEffect, useState } from 'react';
import { api, type Account, type Category, type History, type Operation, type Screen } from './api';
import { AccountForm, CategoryForm, OperationForm } from './Forms';
import { ErrorNotice, Icon, dateLabel, message, money } from './ui';

type Editor = { type: 'account'; value?: Account } | { type: 'category'; kind: 'expense' | 'income'; value?: Category } | { type: 'operation'; value?: Operation };
export function Dashboard({ screen, revision, active, onChanged }: { screen: Screen; revision: number; active: boolean; onChanged: (notice: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState({ accountId: '', categoryId: '', from: '', to: '', page: 1 });
  const accounts = screen.accounts.filter(a => !a.archived);
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(`${screen.month}-01T12:00:00`));
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ ...filter, page: String(filter.page) });
    api<History>(`/transactions?${query}`, 'GET', undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (!result.transactions.length && result.total > 0 && filter.page > 1) {
          setFilter(f => ({ ...f, page: Math.max(1, Math.ceil(result.total / result.pageSize)) }));
        } else setHistory(result);
      })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, revision, active, retry]);
  function updateFilter(key: 'accountId' | 'categoryId' | 'from' | 'to', value: string) { setFilter(f => ({ ...f, [key]: value, page: 1 })); }
  const accountName = (id?: number) => screen.accounts.find(a => a.id === id)?.name || 'Счёт';
  const categoryName = (id?: number) => screen.categories.find(c => c.id === id)?.name || 'Категория';
  return <>
    <section className="overview-hero">
      <div><p className="eyebrow">Ваши деньги, перед глазами</p><h1>Обзор финансов</h1><p className="intro-copy">Счета — на сегодня. Доходы и расходы — за месяц.</p></div>
      <button className="primary-button" disabled={!accounts.length} onClick={() => setEditor({ type: 'operation' })}>+ Добавить операцию</button>
    </section>
    <section className="balance-banner" aria-label="Общий баланс">
      <div><p>Общий баланс</p><strong>{money(screen.totalBalanceMinor)}</strong><span>На всех активных счетах · за всё время</span></div>
      <span className="balance-decoration" aria-hidden="true">₽</span>
    </section>
    <section className="dashboard-section" aria-labelledby="accounts-title">
      <div className="section-heading"><div><h2 id="accounts-title">Счета <span className="count">{accounts.length}</span></h2><p>Остатки не зависят от выбранного месяца</p></div><button className="text-button" onClick={() => setEditor({ type: 'account' })}>+ Новый счёт</button></div>
      {accounts.length ? <div className="account-grid">{accounts.map(a => <button key={a.id} className="account-card" onClick={() => setEditor({ type: 'account', value: a })} aria-label={`Редактировать счёт ${a.name}`}>
        <div className="card-top"><Icon name={a.icon} color={a.color} /><span className="edit-hint" aria-hidden="true">↗</span></div><span className="card-name">{a.name}</span><strong>{money(a.balanceMinor)}</strong>
      </button>)}</div> : <div className="empty-result"><Icon name="wallet" color="#658c73" /><h3>Начните с первого счёта</h3><p>Добавьте карту или кошелёк и укажите начальный остаток.</p><button className="primary-button" onClick={() => setEditor({ type: 'account' })}>Создать счёт</button></div>}
    </section>
    {(['expense', 'income'] as const).map(kind => {
      const categories = screen.categories.filter(c => c.kind === kind && (!c.archived || c.amountMinor !== 0));
      return <section className="dashboard-section" key={kind} aria-labelledby={`${kind}-title`}>
        <div className="section-heading"><div><h2 id={`${kind}-title`}>{kind === 'expense' ? 'Расходы' : 'Доходы'}</h2><p className="month-label">{monthLabel}</p></div><button className="text-button" onClick={() => setEditor({ type: 'category', kind })}>+ Категория</button></div>
        <div className="category-grid">{categories.map(c => <article key={c.id} className={`category-card ${c.archived ? 'archived' : ''}`}>
          <div className="card-top"><Icon name={c.icon} color={c.color} />{!c.archived && <button className="icon-button edit-category" aria-label={`Редактировать категорию ${c.name}`} onClick={() => setEditor({ type: 'category', kind, value: c })}>···</button>}</div>
          <span className="card-name">{c.name}{c.archived && <small>В архиве</small>}</span><strong>{money(c.amountMinor)}</strong>
        </article>)}</div>
        {!categories.length && <p className="muted">Категорий пока нет. Добавьте первую.</p>}
      </section>;
    })}
    <section className="dashboard-section" aria-labelledby="history-title">
      <div className="section-heading"><div><h2 id="history-title">История операций</h2><p>Все даты, включая архивные счета и категории</p></div><span className="count">{history?.total ?? '—'}</span></div>
      <div className="history-filters">
        <label className="field">Счёт<select value={filter.accountId} onChange={e => updateFilter('accountId', e.target.value)}><option value="">Все счета</option>{screen.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · архив' : ''}</option>)}</select></label>
        <label className="field">Категория<select value={filter.categoryId} onChange={e => updateFilter('categoryId', e.target.value)}><option value="">Все категории</option>{screen.categories.map(c => <option key={c.id} value={c.id}>{c.kind === 'income' ? 'Доход · ' : ''}{c.name}{c.archived ? ' · архив' : ''}</option>)}</select></label>
        <label className="field">С даты<input type="date" min="1900-01-01" max="9999-12-31" value={filter.from} onChange={e => updateFilter('from', e.target.value)} /></label>
        <label className="field">По дату<input type="date" min="1900-01-01" max="9999-12-31" value={filter.to} onChange={e => updateFilter('to', e.target.value)} /></label>
      </div>
      <ErrorNotice error={error} />{error && <button className="text-button" onClick={() => setRetry(v => v + 1)}>Повторить загрузку</button>}
      {loading ? <p className="loading-note" role="status">Загружаем историю…</p> : !error && <div className="history-list">{history?.transactions.map(o => <button key={o.id} className="history-row" onClick={() => setEditor({ type: 'operation', value: o })}>
        <div className="history-date">{dateLabel(o.date)}<small>{o.importId ? 'Из выписки' : 'Вручную'}</small></div>
        <div className="history-detail"><strong>{o.kind === 'income' ? categoryName(o.categoryId) : accountName(o.sourceAccountId)} <span aria-hidden="true">→</span> {o.kind === 'expense' ? categoryName(o.categoryId) : accountName(o.destinationAccountId)}</strong>{o.description && <span>{o.description}</span>}{o.comment && <small>{o.comment}</small>}</div>
        <span className={`history-amount ${o.kind}`}>{o.kind === 'expense' ? '−' : o.kind === 'income' ? '+' : ''}{money(o.amountMinor)}</span><span className="edit-hint" aria-hidden="true">↗</span>
      </button>)}{history?.transactions.length === 0 && <div className="empty-result"><h3>Операций пока нет</h3><p>Добавьте операцию вручную или сохраните выписку. Если заданы фильтры, попробуйте их изменить.</p></div>}</div>}
      {history && history.total > history.pageSize && <div className="pagination"><button className="secondary-button" disabled={loading || filter.page === 1} onClick={() => setFilter(f => ({ ...f, page: f.page - 1 }))}>← Назад</button><span>{filter.page} / {Math.ceil(history.total / history.pageSize)}</span><button className="secondary-button" disabled={loading || filter.page >= Math.ceil(history.total / history.pageSize)} onClick={() => setFilter(f => ({ ...f, page: f.page + 1 }))}>Далее →</button></div>}
    </section>
    {editor?.type === 'account' && <AccountForm account={editor.value} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'category' && <CategoryForm category={editor.value} kind={editor.kind} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'operation' && <OperationForm operation={editor.value} screen={screen} onClose={() => setEditor(null)} onSaved={onChanged} />}
  </>;
}
