import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { iconCatalog } from './icons';

const normalize = (text: string) => text.trim().toLowerCase().replace(/ё/g, 'е');
export function IconPicker({ value, color, disabled = false, onChange }: {
  value: string; color: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 280 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = iconCatalog.filter(item => normalize(item.name + ' ' + item.english).includes(normalize(query)));
  const selected = iconCatalog.find(item => item.id === value) || iconCatalog[8];
  const Glyph = selected.component;
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 280 && above > below;
      const height = Math.min(280, upwards ? above : below);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 292)),
        top: upwards ? rect.top - height - 6 : rect.bottom + 6, maxHeight: Math.max(80, height) });
    }
    place(); search.current?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return <div ref={root} className="icon-picker" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) close();
  }} onKeyDown={e => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  }}>
    <button ref={trigger} type="button" className="icon-picker-trigger" disabled={disabled}
      aria-label={`Иконка: ${selected.name}`} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setQuery(''); setOpen(!open); }}><Glyph color={color} aria-hidden="true" /><span aria-hidden="true">⌄</span></button>
    {open && <div ref={panel} id={id} className="icon-picker-panel" style={position}>
      <input ref={search} aria-label="Поиск иконки" placeholder="Поиск иконки" value={query}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault();
          if (e.key === 'ArrowDown') { e.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
        }} />
      <div className="icon-picker-grid" role="group" aria-label="Иконки">
        {items.map((item, index) => <button key={item.id} type="button" aria-label={item.name}
          aria-pressed={item.id === value} onClick={() => { onChange(item.id); close(true); }}
          onKeyDown={e => {
            const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key];
            if (delta !== undefined) {
              e.preventDefault();
              const next = Math.max(0, Math.min(items.length - 1, index + delta));
              panel.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
            }
          }}><item.component color={color} aria-hidden="true" /></button>)}
      </div>
      {!items.length && <p role="status">Иконки не найдены</p>}
    </div>}
  </div>;
}
