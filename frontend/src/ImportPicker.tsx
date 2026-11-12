import { useEffect, useState } from 'react';
import { Select, Group, Text } from '@mantine/core';
import { Icon } from './ui';
type Option = { value: string; name: string; color: string; icon: string };
type Group = { label: string; options: Option[] };
type Props = { label: string; value: string; groups: Group[]; disabled: boolean; onChange: (value: string) => void };
export function ImportPicker({ label, value, groups, disabled, onChange }: Props) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (disabled) setOpened(false); }, [disabled]);
  const options = groups.flatMap(group => group.options);
  const selected = options.find(option => option.value === value);
  return <Select dropdownOpened={opened && !disabled} onDropdownOpen={() => setOpened(true)} onDropdownClose={() => setOpened(false)} aria-label={label} className="import-picker" value={value || null} disabled={disabled}
    placeholder="Выберите категорию или счёт" allowDeselect={false}
    data={groups.filter(group => group.options.length).map(group => ({group: group.label, items: group.options.map(option => ({value:option.value,label:option.name}))}))}
    onChange={value => { if (value) onChange(value); }}
    leftSection={selected && <Icon size={24} name={selected.icon} color={selected.color} />}
    nothingFoundMessage="Нет доступных категорий и счетов"
    renderOption={({ option }) => { const item = options.find(item => item.value === option.value)!; return <Group wrap="nowrap"><Icon name={item.icon} color={item.color}/><Text size="sm">{item.name}</Text></Group>; }} />;
}
