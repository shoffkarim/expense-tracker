import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Select, type SelectProps } from '@mantine/core';
import { DateInput } from '@mantine/dates';

dayjs.extend(customParseFormat);

type Change = (event: { target: { value: string } }) => void;
type OptionProps = { value?: string | number; children?: ReactNode; label?: string };
function text(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<OptionProps>(child) ? text(child.props.children) : String(child)).join('');
}
function options(children: ReactNode): NonNullable<SelectProps['data']> {
  return Children.toArray(children).flatMap<NonNullable<SelectProps['data']>[number]>(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === 'optgroup') return [{ group: child.props.label || '', items: options(child.props.children) as { value: string; label: string }[] }];
    return [{ value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children) }];
  });
}
/** Preserve the existing select value contract at the UI boundary. */
export function Choice({ children, value, onChange, required, ...props }: Omit<SelectProps, 'data' | 'value' | 'onChange'> & { children: ReactNode; value: string | number; onChange: Change }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (props.disabled) setOpened(false); }, [props.disabled]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.setCustomValidity(required && !String(value) ? 'Выберите значение.' : ''); }, [required, value]);
  return <Select {...props} dropdownOpened={opened && !props.disabled} onDropdownOpen={() => setOpened(true)} onDropdownClose={() => setOpened(false)} nothingFoundMessage="Ничего не найдено" ref={ref} required={required} searchable data={options(children)} value={String(value)} allowDeselect={false} onChange={value => onChange({ target: { value: value ?? '' } })} comboboxProps={{ withinPortal: false }} />;
}
export function CalendarInput({ value, onChange, min = '1900-01-01', max = '9999-12-31', ...props }: {
  label?: ReactNode; value: string; onChange: Change; min?: string; max?: string; required?: boolean; disabled?: boolean; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const validate = (raw: string) => {
    const parsed = dayjs(raw, 'DD.MM.YYYY', true);
    const iso = parsed.format('YYYY-MM-DD');
    ref.current?.setCustomValidity(raw && (!parsed.isValid() || iso < min || iso > max) ? 'Введите корректную дату.' : '');
  };
  return <DateInput {...props} ref={ref} fixOnBlur={false} onInput={e => validate(e.currentTarget.value)} dateParser={raw => { const parsed = dayjs(raw, 'DD.MM.YYYY', true); return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null; }} value={value || null} onChange={value => { ref.current?.setCustomValidity(''); onChange({ target: { value: value || '' } }); }} ariaLabels={{nextMonth:"Следующий месяц",previousMonth:"Предыдущий месяц",nextYear:"Следующий год",previousYear:"Предыдущий год",nextDecade:"Следующее десятилетие",previousDecade:"Предыдущее десятилетие",monthLevelControl:"Выбрать месяц",yearLevelControl:"Выбрать год"}} clearButtonProps={{"aria-label":"Очистить дату"}} valueFormat="DD.MM.YYYY" minDate={min} maxDate={max} clearable={!props.required} popoverProps={{ withinPortal: false }} />;
}
