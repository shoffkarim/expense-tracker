import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { api } from './api';
import { Modal, ErrorNotice, message, useMoney, moneyInput, cleanMoneyInput, parseMoneyInput } from './ui';

export const limitValue = (text: string) => text.trim() ? parseMoneyInput(text) : null;
export function LimitField({value,onChange}:{value:string;onChange:(s:string)=>void}) {
 return <TextInput className="field" label="Месячный лимит расходов, ₽" description="Пустое поле — без лимита" inputMode="decimal" value={value} onChange={e=>onChange(cleanMoneyInput(e.target))}/>;
}
export function LimitAmount({amount,limit}:{amount:number;limit?:number|null}) {
  const money = useMoney();
 return <><span style={limit != null && amount>limit ? {color:'var(--mantine-color-red-7)'} : undefined}>{money(amount)}</span>{limit != null && <span className="expense-limit"> / {money(limit)}</span>}</>;
}
export function TotalLimitForm({limit,onClose,onSaved}:{limit?:number|null;onClose:()=>void;onSaved:(s:string)=>void}) {
 const [value,setValue]=useState(limit==null?'':moneyInput(limit));
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 return <Modal title="Общий месячный лимит" busy={busy} onClose={onClose}><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/settings/monthly-limit','PUT',{monthlyLimitMinor:limitValue(value)});onSaved('Лимит сохранён.');onClose()}catch(e){setError(message(e))}finally{setBusy(false)}}}><fieldset disabled={busy}><LimitField value={value} onChange={setValue}/><ErrorNotice error={error}/><Button type="submit">Сохранить</Button></fieldset></form></Modal>;
}
