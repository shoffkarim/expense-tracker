import { useState } from 'react';
import { Tooltip } from '@mantine/core';
import type { Category } from './api';
import { useMoney, palette } from './ui';

type Data = {totalMinor:number;categories:{categoryId:number;amountMinor:number}[]};
export function categoryColors(categories: Category[]) {
 const sorted=[...categories].sort((a,b)=>a.id-b.id);
 const reserved=new Set(sorted.map(c=>c.color.toLowerCase()));
 const used=new Set<string>();
 const colors=new Map<number,string>();
 for(const c of sorted) {
  let color=c.color.toLowerCase();
  if(used.has(color)) {
   const distance=(a:string,b:string)=>{
    const rgb=(v:string)=>[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));
    const x=rgb(a),y=rgb(b);
    return x.reduce((sum,v,i)=>sum+(v-y[i])**2,0);
   };
   const occupied=[...used,...reserved].filter(v=>/^#[0-9a-f]{6}$/.test(v));
   color=palette.filter(p=>!used.has(p)&&!reserved.has(p))
    .map(p=>({color:p,score:Math.min(...occupied.map(v=>distance(p,v)))}))
    .sort((a,b)=>b.score-a.score)[0]?.color || '';
   let i=0;
   while(!color || used.has(color) || reserved.has(color)) {
    // Deterministic extra colors after the curated palette is exhausted.
    const hue=(c.id*137.508+i++*47.73)%360;
    color=`hsl(${hue.toFixed(3)} 65% 42%)`;
   }
  }
  used.add(color);colors.set(c.id,color);
 }
 return colors;
}
export function CategoryDonut({categories,data}:{categories:Category[];data:Data}) {
 // Remount interaction state whenever the dataset changes.
 return <Donut key={JSON.stringify([categories,data])} categories={categories} data={data}/>;
}
function Donut({categories,data}:{categories:Category[];data:Data}) {
  const money = useMoney();
 const [active,setActive]=useState<number|null>(null);
 const colors=categoryColors(categories);
 const amounts=new Map(data.categories.map(c=>[c.categoryId,c.amountMinor]));
 const rows=categories.map(c=>({...c,amount:amounts.get(c.id)??0})).sort((a,b)=>b.amount-a.amount||a.id-b.id);
 const percent=(amount:number)=>data.totalMinor?100*amount/data.totalMinor:0;
 const label=(c:typeof rows[number])=>`${c.name}${c.archived?' · архив':''}: ${money(c.amount)} · ${percent(c.amount).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
 let offset=0;
 if(!rows.length) return <p>Категорий пока нет</p>;
 return <div className="analytics-chart" onKeyDown={e=>{if(e.key==='Escape')setActive(null)}}>
 <svg viewBox="0 0 240 240" aria-label="Распределение по категориям">
 {!data.totalMinor&&<circle cx="120" cy="120" r="90" fill="none" stroke="var(--mantine-color-gray-3)" strokeWidth="32"/>}
 {rows.filter(c=>c.amount>0).map(c=>{
 const size=percent(c.amount);const start=offset;offset+=size;
 return <Tooltip key={c.id} label={label(c)} opened={active===c.id} withinPortal multiline maw={300}>
 <circle tabIndex={0} role="img" aria-label={label(c)} data-category-id={c.id}
 className={active===c.id?'donut-sector active':'donut-sector'}
 onMouseEnter={()=>setActive(c.id)} onMouseLeave={()=>setActive(null)}
 onFocus={()=>setActive(c.id)} onBlur={()=>setActive(null)}
 cx="120" cy="120" r="90" fill="none" stroke={colors.get(c.id)} strokeWidth="32"
 pathLength="100" strokeDasharray={size+' '+(100-size)} strokeDashoffset={-start}/>
 </Tooltip>;
 })}
 <text x="120" y="115" textAnchor="middle" fill="currentColor" fontSize="12">Итого</text>
 <text x="120" y="137" textAnchor="middle" fill="currentColor" fontSize="14">{money(data.totalMinor)}</text>
 </svg>
 <ul>{rows.map(c=><li key={c.id} tabIndex={0} onMouseEnter={()=>setActive(c.amount?c.id:null)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(c.amount?c.id:null)} onBlur={()=>setActive(null)}>
 <span style={{color:colors.get(c.id)}} aria-hidden="true">● </span>{label(c)}
 </li>)}</ul>
 </div>;
}
