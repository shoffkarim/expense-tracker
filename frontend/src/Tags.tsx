import { Badge, Combobox, PillsInput, Pill, useCombobox } from '@mantine/core';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { api } from './api';

const Catalog = createContext<string[] | null>(null);
export const tagKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function TagProvider({ children, revision }: { children: ReactNode; revision: number }) {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api<string[]>('/tags', 'GET', undefined, controller.signal).then(setTags).catch(() => {});
    return () => controller.abort();
  }, [revision]);
  return <Catalog.Provider value={tags}>{children}</Catalog.Provider>;
}

export function TagLabels({ tags = [] }: { tags?: string[] }) {
  return <span className="tag-labels">{tags.map(tag => <Badge variant="light" className="tag" key={tagKey(tag)}>{tag}</Badge>)}</span>;
}

type Props = {
  value?: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  label?: string;
};

export function TagInput({ value = [], onChange, disabled = false, label = 'Теги' }: Props) {
  const catalog = useContext(Catalog);
  const [text, setText] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const id = useId();
  useEffect(() => {
    if (catalog !== null) { setOptions(catalog); return; }
    const controller = new AbortController();
    api<string[]>('/tags', 'GET', undefined, controller.signal).then(setOptions).catch(() => {});
    return () => controller.abort();
  }, [catalog]);

  const combobox = useCombobox();
  function add(raw = text) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name && !value.some(tag => tagKey(tag) === tagKey(name))) {
      onChange([...value, options.find(tag => tagKey(tag) === tagKey(name)) || name]);
    }
    setText('');
  }

  return <Combobox store={combobox} withinPortal={false} onOptionSubmit={tag => { add(tag); combobox.closeDropdown(); }}>
    <Combobox.DropdownTarget><PillsInput label={label} className="field" disabled={disabled} onClick={() => { if (!disabled) combobox.openDropdown(); }}>
      <Pill.Group>{value.map(tag => <Pill key={tagKey(tag)} withRemoveButton disabled={disabled} removeButtonProps={{disabled, tabIndex: 0, 'aria-hidden': false, 'aria-label': `Убрать тег ${tag}`}} onRemove={() => { if (!disabled) onChange(value.filter(t => t !== tag)); }}>{tag}</Pill>)}
        <Combobox.EventsTarget><PillsInput.Field id={id} aria-label={label} disabled={disabled} maxLength={80} value={text} placeholder="Введите тег"
          onChange={e => { setText(e.target.value); combobox.openDropdown(); combobox.resetSelectedOption(); }}
          onBlur={() => { add(); combobox.closeDropdown(); }}
          onKeyDown={e => {
            if(e.key === 'Enter' && combobox.selectedOptionIndex === -1) {e.preventDefault();add();combobox.closeDropdown();}
            if(e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(''); combobox.closeDropdown(); }
          }}/></Combobox.EventsTarget>
      </Pill.Group>
    </PillsInput></Combobox.DropdownTarget>
    <Combobox.Dropdown hidden={disabled}><Combobox.Options>{options.filter(tag => !value.some(v => tagKey(v) === tagKey(tag)) && tagKey(tag).includes(tagKey(text))).map(tag => <Combobox.Option key={tag} value={tag}>{tag}</Combobox.Option>)}</Combobox.Options></Combobox.Dropdown>
  </Combobox>;
}
