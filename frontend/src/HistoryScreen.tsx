import { Title, UnstyledButton, Button } from '@mantine/core';
import { Choice, CalendarInput } from './Controls';
import { TagLabels } from './Tags';
import { Fragment, useEffect, useRef, useState } from 'react';
import { api, type History, type Operation, type Screen } from './api';
import { OperationForm } from './Forms';
import { ErrorNotice, dateLabel, message, money } from './ui';

export function HistoryScreen({ screen, onChanged, initialFilter }: { initialFilter?: { accountId: string; categoryId: string; tag?: string }; screen: Screen; onChanged: (notice: string) => void }) {
  const [filter, setFilter] = useState({ accountId: initialFilter?.accountId || '', categoryId: initialFilter?.categoryId || '', tag: initialFilter?.tag || '', from: '', to: '' });
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { const c=new AbortController(); api<string[]>('/tags','GET',undefined,c.signal).then(setTags).catch(()=>{}); return ()=>c.abort(); }, [screen]);
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
  function monthLabel(date: string) {
    const [year, month] = date.split('-').map(Number);
    const name = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));
    return name[0].toUpperCase() + name.slice(1) + (year === new Date().getFullYear() ? '' : ` ${year}`);
  }
  const accountName = (id?: number) => screen.accounts.find(a => a.id === id)?.name || 'Счёт';
  const categoryName = (id?: number) => screen.categories.find(c => c.id === id)?.name || 'Категория';
  return <>
    <section className="dashboard-section" aria-labelledby="history-title">
      <div className="section-heading"><div><Title order={1} id="history-title">История операций</Title><p>Все даты, включая архивные счета и категории</p></div><span className="count">{history?.total ?? '—'}</span></div>
      <div className="history-filters">
        <Choice label="Счёт" className="field" value={filter.accountId} onChange={e => updateFilter('accountId', e.target.value)}><option value="">Все счета</option>{screen.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · архив' : ''}</option>)}</Choice>
        <Choice label="Категория" className="field" value={filter.categoryId} onChange={e => updateFilter('categoryId', e.target.value)}><option value="">Все категории</option>{screen.categories.map(c => <option key={c.id} value={c.id}>{c.kind === 'income' ? 'Доход · ' : ''}{c.name}{c.archived ? ' · архив' : ''}</option>)}</Choice>
        <Choice label="Тег" className="field" value={filter.tag} onChange={e => updateFilter('tag', e.target.value)}><option value="">Все теги</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</Choice>
        <CalendarInput label="С даты" className="field" min="1900-01-01" max="9999-12-31" value={filter.from} onChange={e => updateFilter('from', e.target.value)} />
        <CalendarInput label="По дату" className="field" min="1900-01-01" max="9999-12-31" value={filter.to} onChange={e => updateFilter('to', e.target.value)} />
      </div>
      <ErrorNotice error={error} />{error && <Button type="button" variant="subtle" className="text-button" onClick={() => setRetry(v => v + 1)}>Повторить загрузку</Button>}
      {loading && <p className="loading-note" role="status">Загружаем историю…</p>}<div className="history-list">{history?.transactions.map((o, index, rows) => <Fragment key={o.id}>
        {index > 0 && o.date.slice(0, 7) !== rows[index - 1].date.slice(0, 7) && <Title order={2} className="history-month">{monthLabel(o.date)}</Title>}
        <UnstyledButton className="history-row" onClick={() => setEditor(o)}>
        <div className="history-date">{dateLabel(o.date)}<small>{o.importId ? 'Из выписки' : 'Вручную'}</small></div>
        <div className="history-detail"><strong>{o.kind === 'income' ? categoryName(o.categoryId) : accountName(o.sourceAccountId)} <span aria-hidden="true">→</span> {o.kind === 'expense' ? categoryName(o.categoryId) : accountName(o.destinationAccountId)}</strong>{o.description && <span>{o.description}</span>}{o.comment && <small>{o.comment}</small>}<TagLabels tags={o.tags}/></div>
        <span className={`history-amount ${o.kind}`}>{o.kind === 'expense' ? '−' : o.kind === 'income' ? '+' : ''}{money(o.amountMinor)}</span><span className="edit-hint" aria-hidden="true">↗</span>
      </UnstyledButton></Fragment>)}{!loading && !error && history?.transactions.length === 0 && <div className="empty-result"><Title order={3}>Операций пока нет</Title><p>Добавьте операцию вручную или сохраните выписку. Если заданы фильтры, попробуйте их изменить.</p></div>}</div>
      <div ref={sentinel} aria-hidden="true" />
    </section>
    {editor && <OperationForm operation={editor} screen={screen} onClose={() => setEditor(null)} onSaved={text => { pending.current = true; setHistory(null); setPage(1); setRetry(value => value + 1); onChanged(text); }} />}
  </>;
}
