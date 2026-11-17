import { CategoryDonut } from './CategoryDonut';
import { Button, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api, type Screen } from './api';
import { OperationFilters, type OperationFilter } from './OperationFilters';
import { ErrorNotice, message, today } from './ui';

type Analytics = {totalMinor:number; categories:{categoryId:number;name:string;color:string;amountMinor:number}[]};
function monthDates(month:string) {
 const [y,m]=month.split('-').map(Number);
 return {from:month+'-01',to:month+'-'+new Date(y,m,0).getDate()};
}
export function AnalyticsScreen({screen,revision}:{screen:Screen;revision:number}) {
 const [month,setMonth]=useState(()=>today().slice(0,7));
 const [sliding,setSliding]=useState(true);
 const [kind,setKind]=useState<'expense'|'income'>('expense');
 const [filter,setFilter]=useState<OperationFilter>(()=>({accountId:'',categoryId:'',tag:'',...monthDates(today().slice(0,7))}));
 const [data,setData]=useState<Analytics|null>(null);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
 const c=new AbortController();setData(null);setError('');
 api<Analytics>('/analytics?'+new URLSearchParams({accountId:filter.accountId,from:filter.from,to:filter.to,kind}),'GET',undefined,c.signal)
 .then(v=>{if(!c.signal.aborted)setData(v)}).catch(e=>{if(!c.signal.aborted)setError(message(e))});
 return ()=>c.abort();
 },[filter,kind,revision,retry]);
 function move(delta:number) {
 const [y,m]=month.split('-').map(Number);const d=new Date(y,m-1+delta,1);
 const next=String(d.getFullYear()).padStart(4,'0')+'-'+String(d.getMonth()+1).padStart(2,'0');
 setMonth(next);setFilter(f=>({...f,...monthDates(next)}));
 }
 const allTime = !filter.from && !filter.to;
 return <section className="dashboard-section">
 <Title order={1}>Аналитика</Title>
 <OperationFilters filter={filter} updateFilter={(key,value)=>{setSliding(false);setFilter(f=>({...f,[key]:value}))}} screen={{...screen,categories:screen.categories.filter(c=>c.kind===kind)}} tags={[]} analytics/>
 <div className="analytics-toolbar">
 {(['expense','income'] as const).map(k=><Button key={k} variant={kind===k?'filled':'light'} aria-pressed={kind===k} onClick={()=>{if(k!==kind){setKind(k);setFilter(f=>({...f,categoryId:''}))}}}>{k==='expense'?'Расходы':'Доходы'}</Button>)}
 <Button variant="subtle" onClick={()=>{
  setSliding(allTime);
  setFilter(f=>({...f,...(allTime ? monthDates(month) : {from:'',to:''})}));
 }}>{allTime ? 'По месяцам' : 'За все время'}</Button>
 <Button variant="subtle" onClick={()=>{const m=today().slice(0,7);setMonth(m);setSliding(true);setFilter({accountId:'',categoryId:'',tag:'',...monthDates(m)})}}>Сбросить фильтры</Button>
 </div>
 <div className="analytics-toolbar">
 {sliding && <Button aria-label="Предыдущий месяц" disabled={month==='1900-01'} onClick={()=>move(-1)}>←</Button>}
 <Title order={2}>{sliding?new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00')):!filter.from&&!filter.to?'За все время':'Выбранный период'}</Title>
 {sliding && <Button aria-label="Следующий месяц" disabled={month==='9999-12'} onClick={()=>move(1)}>→</Button>}
 </div>
 <ErrorNotice error={error}/>{error&&<Button onClick={()=>setRetry(v=>v+1)}>Повторить загрузку</Button>}
 {!data&&!error&&<p role="status">Загружаем аналитику…</p>}
 {data && <CategoryDonut categories={screen.categories.filter(c=>c.kind===kind)} data={data}/>}
 </section>;
}
