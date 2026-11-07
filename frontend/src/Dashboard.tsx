import { useState } from 'react';
import { type Account, type Category, type Operation, type Screen } from './api';
import { AccountForm, CategoryForm, OperationForm } from './Forms';
import { Icon, money } from './ui';

type Editor = { type: 'account'; value?: Account } | { type: 'category'; kind: 'expense' | 'income'; value?: Category } | { type: 'operation'; value?: Operation };
export function Dashboard({ screen, onChanged }: { screen: Screen; onChanged: (notice: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const accounts = screen.accounts.filter(a => !a.archived);
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(`${screen.month}-01T12:00:00`));
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
      {accounts.length ? <div className="account-grid">{accounts.map(a => <article key={a.id} className="account-card">
        <div className="card-top"><Icon name={a.icon} color={a.color} /><button className="icon-button card-edit" aria-label={`Редактировать счёт ${a.name}`} onClick={() => setEditor({ type: 'account', value: a })}>···</button></div><a className="card-name card-link" href={`#/history?accountId=${a.id}`} aria-label={`Операции по счёту ${a.name}`}>{a.name}</a><strong>{money(a.balanceMinor)}</strong>
      </article>)}</div> : <div className="empty-result"><Icon name="wallet" color="#658c73" /><h3>Начните с первого счёта</h3><p>Добавьте карту или кошелёк и укажите начальный остаток.</p><button className="primary-button" onClick={() => setEditor({ type: 'account' })}>Создать счёт</button></div>}
    </section>
    {(['expense', 'income'] as const).map(kind => {
      const categories = screen.categories.filter(c => c.kind === kind && (!c.archived || c.amountMinor !== 0));
      return <section className="dashboard-section" key={kind} aria-labelledby={`${kind}-title`}>
        <div className="section-heading"><div><h2 id={`${kind}-title`}>{kind === 'expense' ? 'Расходы' : 'Доходы'}</h2><p className="month-label">{monthLabel}</p></div><button className="text-button" onClick={() => setEditor({ type: 'category', kind })}>+ Категория</button></div>
        <div className="category-grid">{categories.map(c => <article key={c.id} className={`category-card ${c.archived ? 'archived' : ''}`}>
          <div className="card-top"><Icon name={c.icon} color={c.color} />{!c.archived && <button className="icon-button edit-category card-edit" aria-label={`Редактировать категорию ${c.name}`} onClick={() => setEditor({ type: 'category', kind, value: c })}>···</button>}</div>
          <a className="card-name card-link" href={`#/history?categoryId=${c.id}`} aria-label={`Операции по категории ${c.name}`}>{c.name}{c.archived && <small>В архиве</small>}</a><strong>{money(c.amountMinor)}</strong>
        </article>)}</div>
        {!categories.length && <p className="muted">Категорий пока нет. Добавьте первую.</p>}
      </section>;
    })}
    {editor?.type === 'account' && <AccountForm account={editor.value} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'category' && <CategoryForm category={editor.value} kind={editor.kind} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'operation' && <OperationForm operation={editor.value} screen={screen} onClose={() => setEditor(null)} onSaved={onChanged} />}
  </>;
}
