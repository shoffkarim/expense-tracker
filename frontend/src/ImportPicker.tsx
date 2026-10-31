import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

type Option = { value: string; name: string; color: string; icon: string };
type Group = { label: string; options: Option[] };
type Props = { label: string; value: string; groups: Group[]; disabled: boolean; onChange: (value: string) => void };

export function ImportPicker({ label, value, groups, disabled, onChange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const options = groups.flatMap(group => group.options);
  const selected = options.find(option => option.value === value);
  const expanded = open && !disabled;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function show() {
    setHighlight(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  }
  function select(option: Option) { onChange(option.value); close(true); }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const width = Math.min(Math.max(rect.width, 280), viewportWidth - 24);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 260 && above > below;
      setPosition({ width, left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.max(80, Math.min(320, (upwards ? above : below) - 6)) });
    }
    place();
    menu.current?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${highlight}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, expanded, id]);

  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') { close(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(current => options.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); setHighlight(event.key === 'Home' ? 0 : Math.max(0, options.length - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if (options[highlight]) select(options[highlight]);
    }
  }

  return <>
    <button ref={trigger} type="button" className="import-picker-trigger" aria-label={label} title={selected?.name || 'Выберите категорию или счёт'}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined} disabled={disabled}
      onClick={() => expanded ? close() : show()}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}>
      <Icon name={selected?.icon || 'other'} color={selected?.color} />
      {selected && <span className="import-picker-name">{selected.name}</span>}
      <svg className="picker-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {expanded && createPortal(<div ref={menu} id={id} className="import-picker-menu" style={position} role="listbox" tabIndex={-1}
      aria-label={label} aria-activedescendant={options[highlight] ? `${id}-option-${highlight}` : undefined} onKeyDown={keyDown}
      onBlur={event => { if (event.relatedTarget !== trigger.current && !event.currentTarget.contains(event.relatedTarget)) close(); }}>
      {groups.map((group, groupIndex) => group.options.length > 0 && <div key={group.label} role="group" aria-labelledby={`${id}-group-${groupIndex}`}>
        <div className="import-picker-group" id={`${id}-group-${groupIndex}`}>{group.label}</div>
        {group.options.map(option => {
          const index = options.indexOf(option);
          return <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={value === option.value}
            className={`import-picker-option ${index === highlight ? 'is-highlighted' : ''}`} onMouseMove={() => setHighlight(index)}
            onMouseDown={event => event.preventDefault()} onClick={() => select(option)}>
            <Icon name={option.icon} color={option.color} /><span>{option.name}</span>{value === option.value && <span className="picker-check" aria-hidden="true">✓</span>}
          </div>;
        })}
      </div>)}
      {!options.length && <p className="import-picker-empty">Нет доступных категорий и счетов</p>}
    </div>, document.body)}
  </>;
}
