import { useEffect, useRef, type ReactNode } from 'react';

export const palette = ['#c87946', '#658c73', '#627eaa', '#b66a7e', '#8c7aa9', '#b69a48', '#528e91', '#626866'];
export const iconNames: Record<string, string> = { wallet: 'Кошелёк', bank: 'Банк', card: 'Карта', cash: 'Наличные', food: 'Еда', home: 'Дом', car: 'Машина', health: 'Здоровье', other: 'Прочее', work: 'Работа', chart: 'Инвестиции', gift: 'Подарок', travel: 'Путешествия', shopping: 'Покупки', coffee: 'Кофе', education: 'Образование' };
const paths: Record<string, string> = {
  wallet: 'M4 5h15v4H5a2 2 0 0 1 0-4Zm0 2v12h16V9H5m11 4h4v3h-4z',
  bank: 'm3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18',
  card: 'M3 5h18v14H3zM3 10h18M6 15h4',
  cash: 'M2 6h20v12H2zM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 12h.01M19 12h.01',
  food: 'M5 3v6m3-6v6m-6-6v6h6M5 9v12M17 3c-3 3-3 8 0 8h2V3h-2Zm2 8v10',
  home: 'm3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7',
  car: 'm4 9 2-5h12l2 5M3 9h18v9H3zM6 18v3m12-3v3M6 13h2m8 0h2',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  other: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  work: 'M3 7h18v14H3zM8 7V3h8v4M3 12l9 3 9-3M12 12v5',
  chart: 'M3 3v18h18M7 16l5-6 4 3 5-8M17 5h4v4',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C4 9 4 2 8 3c3 0 4 6 4 6Zm0 0c8 0 8-7 4-6-3 0-4 6-4 6Z',
  travel: 'm2 13 8-3V4a2 2 0 0 1 4 0v6l8 3v3l-8-2v5l3 2H7l3-2v-5l-8 2z',
  shopping: 'M4 7h16l1 14H3L4 7Zm4 0V5a4 4 0 0 1 8 0v2',
  coffee: 'M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m5-3v3',
  education: 'm2 8 10-5 10 5-10 5L2 8Zm4 3v6l6 3 6-3v-6M22 8v10',
};
export function Icon({ name, color }: { name: string; color?: string }) {
  return <span className="tile-icon" style={color ? { color, backgroundColor: `${color}18` } : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.other} /></svg></span>;
}
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
export function money(minor: number) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const formatted = rubles.formatToParts(absolute / 100n)
    .map(part => part.type === 'fraction' ? String(absolute % 100n).padStart(2, '0') : part.value).join('');
  return `${value < 0n ? '−' : ''}${formatted}`;
}
export function moneyInput(minor: number) {
  const amount = BigInt(minor); const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function parseMoneyInput(raw: string, allowNegative = false): number {
  const value = raw.trim().replace(',', '.');
  if (!(allowNegative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) throw new Error('Введите сумму в рублях, не более двух знаков после запятой.');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (value.startsWith('-') ? -1n : 1n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Сумма слишком большая.');
  return Number(amount);
}
export const dateLabel = (iso: string) => iso.split('-').reverse().join('.');
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
export function ErrorNotice({ error }: { error: string }) { return error ? <div className="error-panel" role="alert">{error}</div> : null; }
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog className="modal" ref={dialog} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</button></div>{children}
  </dialog>;
}
export function Appearance({ color, icon, onColor, onIcon }: { color: string; icon: string; onColor: (v: string) => void; onIcon: (v: string) => void }) {
  return <><div className="field"><span>Цвет</span><div className="palette">{[...new Set([...palette, color])].map(c => <button key={c} type="button" className={`swatch ${color === c ? 'selected' : ''}`} style={{ background: c }} aria-label={`Цвет ${c}`} aria-pressed={color === c} onClick={() => onColor(c)} />)}</div></div>
    <label className="field">Иконка<select value={icon} onChange={e => onIcon(e.target.value)}>{Object.entries(iconNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></>;
}
