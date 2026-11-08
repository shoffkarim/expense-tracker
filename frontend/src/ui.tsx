import { iconCatalog } from './icons';
import { IconPicker } from './IconPicker';
import { useEffect, useRef, type ReactNode } from 'react';

export const palette = ['#c87946', '#658c73', '#627eaa', '#b66a7e', '#8c7aa9', '#b69a48', '#528e91', '#626866'];
export function Icon({ name, color }: { name: string; color?: string }) {
  const Glyph = (iconCatalog.find(item => item.id === name) || iconCatalog.find(item => item.id === 'other')!).component;
  return <span className="tile-icon" style={color ? { color, backgroundColor: `${color}18` } : undefined}><Glyph strokeWidth={1.6} aria-hidden="true" /></span>;
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
export function sanitizeMoneyInput(raw: string, allowNegative = false): string {
  const value = raw.replace(/,/g, '.').replace(allowNegative ? /[^0-9.\-]/g : /[^0-9.]/g, '');
  return allowNegative ? (value.startsWith('-') ? '-' : '') + value.replace(/-/g, '') : value;
}
export function cleanMoneyInput(input: HTMLInputElement, allowNegative = false): string {
  const raw = input.value;
  const value = sanitizeMoneyInput(raw, allowNegative);
  if (raw !== value) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = value;
    if (start !== null && end !== null) {
      input.setSelectionRange(sanitizeMoneyInput(raw.slice(0, start), allowNegative).length,
        sanitizeMoneyInput(raw.slice(0, end), allowNegative).length);
    }
  }
  return value;
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
    <div className="field"><span>Иконка</span><IconPicker value={icon} color={color} onChange={onIcon} /></div></>;
}
