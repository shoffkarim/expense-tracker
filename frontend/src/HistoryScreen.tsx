import { useEffect, useRef, useState } from 'react';
import { api, type History, type Operation, type Screen } from './api';
import { OperationForm } from './Forms';
import { ErrorNotice, dateLabel, message, money } from './ui';

export function HistoryScreen({ screen, onChanged }: { screen: Screen; onChanged: (notice: string) => void }) {
  const [filter, setFilter] = useState({ accountId: '', categoryId: '', from: '', to: '' });
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Operation | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    pending.current = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ ...filter, page: String(page) });
    api<History>(`/transactions?${query}`, 'GET', undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setHistory(old => page === 1 ? result : { ...result, transactions: [...(old?.transactions ?? []), ...result.transactions.filter(row => !old?.transactions.some(existing => existing.id === row.id))] });
      })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) { pending.current = false; setLoading(false); } });
    return () => controller.abort();
  }, [filter, page, retry]);
  useEffect(() => {
    if (loading || error || !history || history.page * history.pageSize >= history.total || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !pending.current) {
        pending.current = true;
        setPage(value => value + 1);
      }
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, error, history]);
  function updateFilter(key: keyof typeof filter, value: string) {
    pending.current = true; setHistory(null); setPage(1);
    setFilter(current => ({ ...current, [key]: value }));
  }
  const accountName = (id?: number) => screen.accounts.find(a => a.id === id)?.name || 'Счёт';
  const categoryName = (id?: number) => screen.categories.find(c => c.id === id)?.name || 'Категория';
  return <>
    <section className="dashboard-section" aria-labelledby="history-title">
      <div className="section-heading"><div><h1 id="history-title">История операций</h1><p>Все даты, включая архивные счета и категории</p></div><span className="count">{history?.total ?? '—'}</span></div>
      <div className="history-filters">
        <label className="field">Счёт<select value={filter.accountId} onChange={e => updateFilter('accountId', e.target.value)}><option value="">Все счета</option>{screen.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · архив' : ''}</option>)}</select></label>
        <label className="field">Категория<select value={filter.categoryId} onChange={e => updateFilter('categoryId', e.target.value)}><option value="">Все категории</option>{screen.categories.map(c => <option key={c.id} value={c.id}>{c.kind === 'income' ? 'Доход · ' : ''}{c.name}{c.archived ? ' · архив' : ''}</option>)}</select></label>
        <label className="field">С даты<input type="date" min="1900-01-01" max="9999-12-31" value={filter.from} onChange={e => updateFilter('from', e.target.value)} /></label>
        <label className="field">По дату<input type="date" min="1900-01-01" max="9999-12-31" value={filter.to} onChange={e => updateFilter('to', e.target.value)} /></label>
      </div>
      <ErrorNotice error={error} />{error && <button className="text-button" onClick={() => setRetry(v => v + 1)}>Повторить загрузку</button>}
      {loading && <p className="loading-note" role="status">Загружаем историю…</p>}<div className="history-list">{history?.transactions.map(o => <button key={o.id} className="history-row" onClick={() => setEditor(o)}>
        <div className="history-date">{dateLabel(o.date)}<small>{o.importId ? 'Из выписки' : 'Вручную'}</small></div>
        <div className="history-detail"><strong>{o.kind === 'income' ? categoryName(o.categoryId) : accountName(o.sourceAccountId)} <span aria-hidden="true">→</span> {o.kind === 'expense' ? categoryName(o.categoryId) : accountName(o.destinationAccountId)}</strong>{o.description && <span>{o.description}</span>}{o.comment && <small>{o.comment}</small>}</div>
        <span className={`history-amount ${o.kind}`}>{o.kind === 'expense' ? '−' : o.kind === 'income' ? '+' : ''}{money(o.amountMinor)}</span><span className="edit-hint" aria-hidden="true">↗</span>
      </button>)}{!loading && !error && history?.transactions.length === 0 && <div className="empty-result"><h3>Операций пока нет</h3><p>Добавьте операцию вручную или сохраните выписку. Если заданы фильтры, попробуйте их изменить.</p></div>}</div>
      <div ref={sentinel} aria-hidden="true" />
    </section>
    {editor && <OperationForm operation={editor} screen={screen} onClose={() => setEditor(null)} onSaved={text => { pending.current = true; setHistory(null); setPage(1); setRetry(value => value + 1); onChanged(text); }} />}
  </>;
}
