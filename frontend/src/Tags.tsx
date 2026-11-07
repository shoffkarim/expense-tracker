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
  return <span className="tag-labels">{tags.map(tag => <span className="tag" key={tagKey(tag)}>{tag}</span>)}</span>;
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

  function add() {
    const name = text.trim().replace(/\s+/g, ' ');
    if (name && !value.some(tag => tagKey(tag) === tagKey(name))) {
      onChange([...value, options.find(tag => tagKey(tag) === tagKey(name)) || name]);
    }
    setText('');
  }

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="tag-labels">{value.map(tag => <span className="tag" key={tagKey(tag)}>
      {tag}<button type="button" disabled={disabled} aria-label={`Убрать тег ${tag}`} onClick={() => onChange(value.filter(t => t !== tag))}>×</button>
    </span>)}</div>
    <input id={id} disabled={disabled} maxLength={80} value={text} list={`${id}-tags`} placeholder="Введите тег"
      onChange={event => setText(event.target.value)} onBlur={add}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); add(); }
        if (event.key === 'Escape') { event.preventDefault(); setText(''); }
      }} />
    <datalist id={`${id}-tags`}>{options.filter(tag => !value.some(v => tagKey(tag) === tagKey(v))).map(tag => <option key={tag} value={tag} />)}</datalist>
  </div>;
}
