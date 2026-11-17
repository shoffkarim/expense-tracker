import { iconCatalog } from './icons';
import { IconPicker } from './IconPicker';
import { createContext, useContext, type ReactNode } from 'react';
import { Alert, Modal as MantineModal, ColorSwatch, ThemeIcon } from '@mantine/core';

export const palette = ['#c87946', '#658c73', '#627eaa', '#b66a7e', '#8c7aa9', '#b69a48', '#528e91', '#626866', '#e03131', '#9c36b5', '#6741d9', '#364fc7', '#1971c2', '#0c8599', '#099268', '#2f9e44', '#66a80f', '#e67700', '#d9480f', '#a61e4d', '#5f3dc4', '#087f5b', '#862e9c', '#495057'];
export function Icon({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const Glyph = (iconCatalog.find(item => item.id === name) || iconCatalog.find(item => item.id === 'other')!).component;
  return <ThemeIcon className="tile-icon" variant="light" color={color} size={size}><Glyph strokeWidth={1.6} aria-hidden="true" /></ThemeIcon>;
}
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
export const MoneyPrecision = createContext(true);
export function useMoney() {
  const showKopecks = useContext(MoneyPrecision);
  return (minor: number) => money(minor, showKopecks);
}
const wholeRubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
export function money(minor: number, showKopecks = true) {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  if (!showKopecks) {
    const rounded = (absolute + 50n) / 100n;
    return `${value < 0n && rounded !== 0n ? '−' : ''}${wholeRubles.format(rounded)}`;
  }
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
export function ErrorNotice({ error }: { error: string }) { return error ? <Alert color="red" role="alert" my="sm">{error}</Alert> : null; }
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  return <MantineModal opened title={title} onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy} closeOnClickOutside={false} closeButtonProps={{ disabled: busy, 'aria-label': 'Закрыть' }} returnFocus size="lg">{children}</MantineModal>;
}
export function Appearance({ color, icon, onColor, onIcon, disabled = false }: { disabled?: boolean; color: string; icon: string; onColor: (v: string) => void; onIcon: (v: string) => void }) {
  return <><div className="field"><span>Цвет</span><div className="palette">{[...new Set([...palette, color])].map(c => <ColorSwatch disabled={disabled} component="button" color={c} key={c} type="button" className={`swatch ${color === c ? 'selected' : ''}`}  aria-label={`Цвет ${c}`} aria-pressed={color === c} onClick={() => onColor(c)} />)}</div></div>
    <div className="field"><span>Иконка</span><IconPicker disabled={disabled} value={icon} color={color} onChange={onIcon} /></div></>;
}
