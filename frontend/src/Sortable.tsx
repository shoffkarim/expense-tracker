import { Paper } from '@mantine/core';
import { isSortable } from '@dnd-kit/dom/sortable';
import { useRef, type ReactNode } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { Accessibility, PointerSensor, PointerActivationConstraints, KeyboardSensor } from '@dnd-kit/dom';

const sensors = (carousel: boolean) => [PointerSensor.configure({
 activationConstraints: event => carousel || event.pointerType === 'touch'
  ? [new PointerActivationConstraints.Delay({ value: carousel ? 350 : 250, tolerance: 5 })]
  : [new PointerActivationConstraints.Distance({ value: 8 })],
 preventActivation: event => event.target instanceof Element && !!event.target.closest('button,input,select,textarea'),
}), KeyboardSensor];
export function SortableGroup({ children, ids, onMove, disabled = false, carousel = false }: { carousel?: boolean; children: ReactNode; ids: number[]; onMove: (from: number, to: number) => void; disabled?: boolean }) {
 const dragged = useRef(false);
 const group = useRef<HTMLDivElement>(null);
 return <div ref={group} onClickCapture={e => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); dragged.current = false; } }}>
 <DragDropProvider plugins={defaults => [...defaults, Accessibility.configure({screenReaderInstructions:{draggable:'Нажмите пробел для переноса, стрелки для перемещения, пробел для завершения или Escape для отмены.'},announcements:{dragstart:()=> 'Перенос начат.',dragover:()=> 'Позиция изменена.',dragend:(event: {canceled:boolean})=>event.canceled?'Перенос отменён.':'Перенос завершён.'}})]} sensors={sensors(carousel)} onDragStart={() => { dragged.current = true; if(carousel)window.dispatchEvent(new CustomEvent("tile-sort-start", {detail: group.current})); }} onDragEnd={event => {
  window.setTimeout(() => { dragged.current = false; }, 0);
  if(carousel)window.dispatchEvent(new Event("tile-sort-end"));
  const {source,target} = event.operation;
  if (!disabled && !event.canceled && source && target && isSortable(source) && source.initialIndex !== source.index) onMove(ids[source.initialIndex],ids[source.index]);
 }}>{children}</DragDropProvider></div>;
}
export function SortableCard({ id, index, disabled, className, children }: { id: number; index: number; disabled?: boolean; className: string; children: ReactNode }) {
 const {ref,isDragging} = useSortable({id,index,disabled});
 return <Paper component="article" withBorder ref={ref} tabIndex={0} className={`${className} sortable-card ${isDragging ? 'is-sorting' : ''}`} aria-label="Переместить: пробел, стрелки, Escape для отмены">{children}</Paper>;
}
