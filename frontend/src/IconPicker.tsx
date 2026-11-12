import { useRef, useState, useEffect } from 'react';
import { ActionIcon, Button, Popover, SimpleGrid, TextInput, Text, ScrollArea } from '@mantine/core';
import { iconCatalog } from './icons';
const normalize = (text: string) => text.trim().toLowerCase().replace(/ё/g, 'е');
export function IconPicker({ value, color, disabled = false, onChange }: { value: string; color: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const items = iconCatalog.filter(item => normalize(item.name + ' ' + item.english).includes(normalize(query)));
  const selected = iconCatalog.find(item => item.id === value) || iconCatalog[8];
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <Popover opened={open && !disabled} onChange={setOpen} width={300} withinPortal={false} trapFocus returnFocus onClose={close}>
    <Popover.Target><Button ref={trigger} type="button" variant="default" disabled={disabled} className="icon-picker-trigger" aria-label={`Иконка: ${selected.name}`} onClick={() => { setQuery(''); setOpen(!open); }}><selected.component color={color} size={22}/></Button></Popover.Target>
    <Popover.Dropdown className="icon-picker-panel" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <TextInput data-autofocus aria-label="Поиск иконки" placeholder="Поиск иконки" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'ArrowDown') {e.preventDefault();grid.current?.querySelector('button')?.focus();} }} />
      <ScrollArea.Autosize mah={240} mt="xs"><SimpleGrid cols={6} spacing={4} ref={grid} className="icon-picker-grid" role="group" aria-label="Иконки">
        {items.map((item,index) => <ActionIcon key={item.id} type="button" size="lg" color={color} variant={item.id === value ? 'light' : 'subtle'} aria-label={item.name} aria-pressed={item.id === value} onClick={() => { onChange(item.id); close(); }} onKeyDown={e => {
          const delta = {ArrowRight:1,ArrowLeft:-1,ArrowDown:6,ArrowUp:-6}[e.key];
          if (delta !== undefined) {e.preventDefault();grid.current?.querySelectorAll('button')[Math.max(0,Math.min(items.length-1,index+delta))]?.focus();}
        }}><item.component size={22}/></ActionIcon>)}
      </SimpleGrid></ScrollArea.Autosize>
      {!items.length && <Text role="status" size="sm">Иконки не найдены</Text>}
    </Popover.Dropdown>
  </Popover>;
}
