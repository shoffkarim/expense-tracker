import { Choice, CalendarInput } from './Controls';
import type { Screen } from './api';
export type OperationFilter = {accountId:string; categoryId:string; tag:string; from:string; to:string};
export function OperationFilters({filter,updateFilter,screen,tags,analytics = false}:{filter:OperationFilter;updateFilter:(key:keyof OperationFilter,value:string)=>void;screen:Screen;tags:string[];analytics?:boolean}) {
return (      <div className="history-filters">
        <Choice label="Счёт" className="field" value={filter.accountId} onChange={e => updateFilter('accountId', e.target.value)}><option value="">Все счета</option>{screen.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' · архив' : ''}</option>)}</Choice>
        {!analytics && <Choice label="Категория" className="field" value={filter.categoryId} onChange={e => updateFilter('categoryId', e.target.value)}><option value="">Все категории</option>{screen.categories.map(c => <option key={c.id} value={c.id}>{c.kind === 'income' ? 'Доход · ' : ''}{c.name}{c.archived ? ' · архив' : ''}</option>)}</Choice>}
        {!analytics && <Choice label="Тег" className="field" value={filter.tag} onChange={e => updateFilter('tag', e.target.value)}><option value="">Все теги</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</Choice>}
        <CalendarInput label="С даты" className="field" min="1900-01-01" max="9999-12-31" value={filter.from} onChange={e => updateFilter('from', e.target.value)} />
        <CalendarInput label="По дату" className="field" min="1900-01-01" max="9999-12-31" value={filter.to} onChange={e => updateFilter('to', e.target.value)} />
      </div>);
}
