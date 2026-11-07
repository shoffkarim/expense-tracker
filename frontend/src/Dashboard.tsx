import { SortableGroup, SortableCard } from './Sortable';
import { api } from './api';
import { ErrorNotice, message } from './ui';
import { useState } from 'react';
import { type Account, type Category, type Operation, type Screen } from './api';
import { AccountForm, CategoryForm, OperationForm } from './Forms';
import { Icon, money } from './ui';

type Editor = { type: 'account'; value?: Account } | { type: 'category'; kind: 'expense' | 'income'; value?: Category } | { type: 'operation'; value?: Operation };
export function Dashboard({ screen, onChanged }: { screen: Screen; onChanged: (notice: string) => void }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [orders, setOrders] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function sorted<T extends {id:number; dashboardPosition?:number}>(items:T[],group:string):T[] {
    const ids=orders[group];
    return [...items].sort((a,b)=> ids ? (ids.includes(a.id)?ids.indexOf(a.id):Infinity)-(ids.includes(b.id)?ids.indexOf(b.id):Infinity) : (a.dashboardPosition ?? a.id)-(b.dashboardPosition ?? b.id));
  }
  async function reorder(group:string,from:number,to:number) {
    if(saving)return;
    const all=sorted<Account | Category>(group==='accounts'?screen.accounts:screen.categories.filter(c=>c.kind===group),group);
    const visible=all.filter(item=>group==='accounts'?!item.archived:!item.archived||('amountMinor' in item && item.amountMinor!==0)).map(item=>item.id);
    const start=visible.indexOf(from),end=visible.indexOf(to);
    if(start<0||end<0||start===end)return;
    visible.splice(end,0,visible.splice(start,1)[0]);
    let index=0;const ids=all.map(item=>visible.includes(item.id)?visible[index++]:item.id);
    const previous=orders;setOrders({...orders,[group]:ids});setSaving(true);setError('');
    try{await api('/dashboard/order','PUT',{group,ids});onChanged('Порядок сохранён.');}
    catch(e){setOrders(previous);setError(message(e));}finally{setSaving(false)}
  }
  const accounts = sorted(screen.accounts,'accounts').filter(a => !a.archived);
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(`${screen.month}-01T12:00:00`));
  return <><ErrorNotice error={error}/>
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
      {accounts.length ? <SortableGroup ids={accounts.map(a=>a.id)} disabled={saving} onMove={(from,to)=>void reorder("accounts",from,to)}><div className="account-grid">{accounts.map((a,index) => <SortableCard key={a.id} id={a.id} index={index} disabled={saving} className="account-card">
        <div className="card-top"><Icon name={a.icon} color={a.color} /><button className="icon-button card-edit" aria-label={`Редактировать счёт ${a.name}`} onClick={() => setEditor({ type: 'account', value: a })}>···</button></div><a draggable={false} className="card-name card-link" href={`#/history?accountId=${a.id}`} aria-label={`Операции по счёту ${a.name}`}>{a.name}</a><strong>{money(a.balanceMinor)}</strong>
      </SortableCard>)}</div></SortableGroup> : <div className="empty-result"><Icon name="wallet" color="#658c73" /><h3>Начните с первого счёта</h3><p>Добавьте карту или кошелёк и укажите начальный остаток.</p><button className="primary-button" onClick={() => setEditor({ type: 'account' })}>Создать счёт</button></div>}
    </section>
    {(['expense', 'income'] as const).map(kind => {
      const categories = sorted(screen.categories,kind).filter(c => c.kind === kind && (!c.archived || c.amountMinor !== 0));
      return <section className="dashboard-section" key={kind} aria-labelledby={`${kind}-title`}>
        <div className="section-heading"><div><h2 id={`${kind}-title`}>{kind === 'expense' ? 'Расходы' : 'Доходы'}</h2><p className="month-label">{monthLabel}</p></div><button className="text-button" onClick={() => setEditor({ type: 'category', kind })}>+ Категория</button></div>
        <SortableGroup ids={categories.map(c=>c.id)} disabled={saving} onMove={(from,to)=>void reorder(kind,from,to)}><div className="category-grid">{categories.map((c,index) => <SortableCard id={c.id} index={index} disabled={saving} key={c.id} className={`category-card ${c.archived ? 'archived' : ''}`}>
          <div className="card-top"><Icon name={c.icon} color={c.color} />{!c.archived && <button className="icon-button edit-category card-edit" aria-label={`Редактировать категорию ${c.name}`} onClick={() => setEditor({ type: 'category', kind, value: c })}>···</button>}</div>
          <a draggable={false} className="card-name card-link" href={`#/history?categoryId=${c.id}`} aria-label={`Операции по категории ${c.name}`}>{c.name}{c.archived && <small>В архиве</small>}</a><strong>{money(c.amountMinor)}</strong>
        </SortableCard>)}</div></SortableGroup>
        {!categories.length && <p className="muted">Категорий пока нет. Добавьте первую.</p>}
      </section>;
    })}
    {editor?.type === 'account' && <AccountForm account={editor.value} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'category' && <CategoryForm category={editor.value} kind={editor.kind} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'operation' && <OperationForm operation={editor.value} screen={screen} onClose={() => setEditor(null)} onSaved={onChanged} />}
  </>;
}
