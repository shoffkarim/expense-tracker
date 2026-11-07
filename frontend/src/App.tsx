import { TagProvider } from './Tags';
import { HistoryScreen } from './HistoryScreen';
import { Rules } from './Rules';
import { useCallback, useEffect, useState } from 'react';
import { api, type Draft, type Screen } from './api';
import { Dashboard } from './Dashboard';
import { ImportScreen } from './ImportScreen';
import { ErrorNotice, message, today } from './ui';

const currentPage = () => window.location.hash.split('?')[0] === '#/history' ? 'history' : window.location.hash.split('?')[0] === '#/rules' ? 'rules' : window.location.hash.split('?')[0] === '#/import' ? 'import' : 'dashboard';
export function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  const [page, setPage] = useState(currentPage);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changed = useCallback((text: string) => { setNotice(text); setRevision(v => v + 1); }, []);
  useEffect(() => {
    const navigate = () => { setPage(currentPage()); setRoute(window.location.hash); window.scrollTo?.(0, 0); setRevision(v => v + 1); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Screen>('/dashboard', 'GET', undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setScreen(data); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    let month = today().slice(0, 7);
    const refresh = () => { month = today().slice(0, 7); setRevision(v => v + 1); };
    const timer = window.setInterval(() => { if (today().slice(0, 7) !== month) refresh(); }, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  return <TagProvider revision={revision}><main className="app-shell">
    <header className="masthead"><a className="brand" href="#/dashboard" aria-label="Выписка — обзор"><span className="brand-mark" aria-hidden="true">в.</span><span>выписка</span></a><nav className="main-nav" aria-label="Основные экраны"><a href="#/dashboard" aria-current={page === 'dashboard' ? 'page' : undefined}>Обзор</a><a href="#/history" aria-current={page === 'history' ? 'page' : undefined}>История</a><a href="#/import" aria-current={page === 'import' ? 'page' : undefined}>Выписка{draft && <span className="draft-dot" aria-label="Есть черновик" />}</a><a href="#/rules" aria-current={page === 'rules' ? 'page' : undefined}>Правила</a></nav><span className="local-badge"><span aria-hidden="true" />Только на вашем компьютере</span></header>
    {notice && <div className="success-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Скрыть уведомление" onClick={() => setNotice('')}>×</button></div>}
    <ErrorNotice error={error} />{error && <button className="text-button" onClick={() => setRevision(v => v + 1)}>Повторить загрузку</button>}
    <div hidden={page !== 'dashboard'}>{screen ? <Dashboard screen={screen} onChanged={changed} /> : !error && <p className="loading-note" role="status">Загружаем ваши данные…</p>}</div>
    <div hidden={page !== 'import'}><ImportScreen draft={draft} setDraft={setDraft} active={page === 'import'} revision={revision} onChanged={changed} /></div>
    {page === 'history' && screen && <HistoryScreen key={route} initialFilter={{ tag: new URLSearchParams(route.split('?')[1]).get('tag') || '', accountId: new URLSearchParams(route.split('?')[1]).get('accountId') || '', categoryId: new URLSearchParams(route.split('?')[1]).get('categoryId') || '' }} screen={screen} onChanged={changed} />}
    {page === 'rules' && screen && <Rules screen={screen} onChanged={changed} />}
    <footer><span>Ваши данные остаются на этом компьютере.</span><span>Счета, операции и категории хранятся локально.</span></footer>
  </main></TagProvider>;
}
