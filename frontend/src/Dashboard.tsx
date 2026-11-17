import { LimitAmount, TotalLimitForm } from './Limits';
import { TileCarousel } from './TileCarousel';
import { ActionIcon, Title, Button, Switch } from '@mantine/core';
import { SortableGroup, SortableCard } from './Sortable';
import { api } from './api';
import { ErrorNotice, message } from './ui';
import { useState } from 'react';
import { type Account, type Category, type Operation, type Screen } from './api';
import { AccountForm, CategoryForm, OperationForm } from './Forms';
import { Icon, useMoney } from './ui';

type Editor = { type: 'account'; value?: Account } | { type: 'category'; kind: 'expense' | 'income'; value?: Category } | { type: 'operation'; value?: Operation };
export function Dashboard({ screen, onChanged }: { screen: Screen; onChanged: (notice: string) => void }) {
  const money = useMoney();
  const [limitEditor,setLimitEditor]=useState(false);
  const [showLimits,setShowLimits]=useState(()=>{try{return localStorage.getItem('account-limits')==='true'}catch{return false}});
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
  function monthlyTotal(kind: 'expense' | 'income') {
    const total = screen.categories.filter(c => c.kind === kind).reduce((sum,c) => sum + BigInt(c.amountMinor), 0n);
    return total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER) ? 'Сумма вне допустимого диапазона' : money(Number(total));
  }
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(`${screen.month}-01T12:00:00`));
  return <><ErrorNotice error={error}/>
    <section className="overview-hero">
      <div><p className="eyebrow">Ваши деньги, перед глазами</p><Title order={1}>Обзор финансов</Title><p className="intro-copy">Счета — на сегодня. Доходы и расходы — за месяц.</p></div>
      <Button type="button" className="primary-button" disabled={!accounts.length} onClick={() => setEditor({ type: 'operation' })}>+ Добавить операцию</Button>
    </section>
    <section className="balance-banner" aria-label="Общий баланс">
      <div><p>Общий баланс</p><strong>{money(screen.totalBalanceMinor)}</strong><span>На всех активных счетах · за всё время</span></div>
      <div className="balance-month"><span>{monthLabel}</span><div><p>Доход за месяц</p><strong>{monthlyTotal('income')}</strong></div><div><p>Расход за месяц</p><strong>{(()=>{const total=screen.categories.filter(c=>c.kind==='expense').reduce((sum,c)=>sum+BigInt(c.amountMinor),0n);return total>BigInt(Number.MAX_SAFE_INTEGER)?'Сумма вне допустимого диапазона':<LimitAmount amount={Number(total)} limit={screen.monthlyLimitMinor}/>})()}</strong><Button variant="subtle" onClick={()=>setLimitEditor(true)}>Настроить лимит</Button></div></div>
      <span className="balance-decoration" aria-hidden="true">₽</span>
    </section>
    <section className="dashboard-section" aria-labelledby="accounts-title">
      <div className="section-heading"><div><Title order={2} id="accounts-title">Счета <span className="count">{accounts.length}</span></Title><p>Остатки не зависят от выбранного месяца</p></div><Button type="button" variant="subtle" className="text-button" onClick={() => setEditor({ type: 'account' })}>+ Новый счёт</Button></div>
      <Switch label="Показывать траты и лимиты" checked={showLimits} onChange={e=>{const value=e.currentTarget.checked;setShowLimits(value);try{localStorage.setItem('account-limits',String(value))}catch{ /* Storage is optional. */ }}}/>
      {accounts.length ? <SortableGroup carousel ids={accounts.map(a=>a.id)} disabled={saving} onMove={(from,to)=>void reorder("accounts",from,to)}><TileCarousel accounts>{accounts.map((a,index) => <SortableCard key={a.id} id={a.id} index={index} disabled={saving} className="account-card">
        <div className="card-top"><Icon name={a.icon} color={a.color} /><ActionIcon type="button" variant="subtle" className="icon-button card-edit" aria-label={`Редактировать счёт ${a.name}`} onClick={() => setEditor({ type: 'account', value: a })}>···</ActionIcon></div><a draggable={false} title={a.name} className="card-name card-link" href={`#/history?accountId=${a.id}`} aria-label={`Операции по счёту ${a.name}`}>{a.name}</a><strong>{showLimits ? <LimitAmount amount={a.monthlyExpenseMinor ?? 0} limit={a.monthlyLimitMinor}/> : money(a.balanceMinor)}</strong>
      </SortableCard>)}</TileCarousel></SortableGroup> : <div className="empty-result"><Icon name="wallet" color="#658c73" /><Title order={3}>Начните с первого счёта</Title><p>Добавьте карту или кошелёк и укажите начальный остаток.</p><Button type="button" className="primary-button" onClick={() => setEditor({ type: 'account' })}>Создать счёт</Button></div>}
    </section>
    {(['expense', 'income'] as const).map(kind => {
      const categories = sorted(screen.categories,kind).filter(c => c.kind === kind && (!c.archived || c.amountMinor !== 0));
      return <section className="dashboard-section" key={kind} aria-labelledby={`${kind}-title`}>
        <div className="section-heading"><div><Title order={2} id={`${kind}-title`}>{kind === 'expense' ? 'Расходы' : 'Доходы'}</Title><p className="month-label">{monthLabel}</p></div><Button type="button" variant="subtle" className="text-button" onClick={() => setEditor({ type: 'category', kind })}>+ Категория</Button></div>
        <SortableGroup carousel ids={categories.map(c=>c.id)} disabled={saving} onMove={(from,to)=>void reorder(kind,from,to)}><TileCarousel>{categories.map((c,index) => <SortableCard id={c.id} index={index} disabled={saving} key={c.id} className={`category-card ${c.archived ? 'archived' : ''}`}>
          <div className="card-top"><Icon name={c.icon} color={c.color} />{!c.archived && <ActionIcon type="button" variant="subtle" className="icon-button edit-category card-edit" aria-label={`Редактировать категорию ${c.name}`} onClick={() => setEditor({ type: 'category', kind, value: c })}>···</ActionIcon>}</div>
          <a draggable={false} title={c.name} className="card-name card-link" href={`#/history?categoryId=${c.id}`} aria-label={`Операции по категории ${c.name}`}>{c.name}{c.archived && <small>В архиве</small>}</a><strong>{kind === 'expense' ? <LimitAmount amount={c.amountMinor} limit={c.monthlyLimitMinor}/> : money(c.amountMinor)}</strong>
        </SortableCard>)}</TileCarousel></SortableGroup>
        {!categories.length && <p className="muted">Категорий пока нет. Добавьте первую.</p>}
      </section>;
    })}
    {limitEditor && <TotalLimitForm limit={screen.monthlyLimitMinor} onClose={()=>setLimitEditor(false)} onSaved={onChanged}/>}
    {editor?.type === 'account' && <AccountForm account={editor.value} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'category' && <CategoryForm category={editor.value} kind={editor.kind} onClose={() => setEditor(null)} onSaved={onChanged} />}
    {editor?.type === 'operation' && <OperationForm operation={editor.value} screen={screen} onClose={() => setEditor(null)} onSaved={onChanged} />}
  </>;
}
