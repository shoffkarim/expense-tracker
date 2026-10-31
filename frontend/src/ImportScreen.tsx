import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api, ApiError, parseStatement, type Draft, type ImportCheck, type ImportPayload, type ImportResult, type ImportRow, type Screen } from './api';
import { AccountForm } from './Forms';
import { ImportPicker } from './ImportPicker';
import { ErrorNotice, Icon, dateLabel, message, money } from './ui';

const rowKey = (row: Pick<ImportRow, 'sourcePage' | 'rowNumber'>) => `${row.sourcePage}:${row.rowNumber}`;
const rowSetKey = (draft: Draft | null) => draft ? `${draft.id}/${draft.rows.map(rowKey).join(',')}` : '';
type CheckedRows = { key: string; alreadyImported: boolean; rows: Record<string, ImportCheck['rows'][number]> };

type Props = { draft: Draft | null; setDraft: Dispatch<SetStateAction<Draft | null>>; active: boolean; revision: number; onChanged: (notice: string) => void };
export function ImportScreen({ draft, setDraft, active, revision, onChanged }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [screen, setScreen] = useState<Screen | null>(null);
  const [accountId, setAccountId] = useState(0);
  const [newAccount, setNewAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [dataError, setDataError] = useState('');
  const [checkError, setCheckError] = useState('');
  const [check, setCheck] = useState<CheckedRows | null>(null);
  const [retry, setRetry] = useState(0);
  const [checkRetry, setCheckRetry] = useState(0);
  const [pendingSubmission, setPendingSubmission] = useState<ImportPayload | null>(null);
  const rowsKey = rowSetKey(draft);
  const currentCheck = check?.key === `${accountId}/${rowsKey}` ? check : null;
  const locked = loading || saving || !!pendingSubmission;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    api<Screen>('/import-screen', 'GET', undefined, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setScreen(data); setDataError('');
      setAccountId(current => data.accounts.some(a => a.id === current) ? current : data.accounts.length === 1 ? data.accounts[0].id : 0);
    }).catch(e => { if (!controller.signal.aborted) { setDataError(message(e)); setScreen(null); } });
    return () => controller.abort();
  }, [active, revision, retry]);

  useEffect(() => {
    const currentDraft = draftRef.current;
    if (!active || !currentDraft || !currentDraft.rows.length || !accountId || pendingSubmission) { setCheck(null); setChecking(false); setCheckError(''); return; }
    const controller = new AbortController();
    setChecking(true); setCheck(null); setCheckError('');
    api<ImportCheck>('/imports/check', 'POST', { accountId, fileHash: currentDraft.fileHash, rows: currentDraft.rows.map(({ ruleName: _ruleName, statementNumber: _statementNumber, ...row }) => row) }, controller.signal)
      .then(result => {
        if (controller.signal.aborted || rowSetKey(draftRef.current) !== rowsKey) return;
        const rows = Object.fromEntries(currentDraft.rows.map((row, i) => [rowKey(row), result.rows[i]]));
        setCheck({ key: `${accountId}/${rowsKey}`, alreadyImported: result.alreadyImported, rows });
        setDraft(current => current && rowSetKey(current) === rowsKey ? { ...current, rows: current.rows.map(row => {
          const info = rows[rowKey(row)];
          // A duplicate decision is valid only for the exact set the user reviewed.
          return { ...row, decision: row.decision === 'keep' && row.matchToken !== info.matchToken ? 'save' : row.decision, matchToken: info.matchToken };
        }) } : current);
      })
      .catch(e => { if (!controller.signal.aborted) setCheckError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [rowsKey, accountId, active, revision, retry, checkRetry, pendingSubmission, setDraft]);

  async function upload(files: FileList | null) {
    if (busyRef.current || locked || !accountId || !files?.length) return;
    setError('');
    if (files.length !== 1) { setError('Выберите одну PDF-выписку.'); return; }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > 20 * 1024 * 1024) { setError('Нужен непустой PDF с текстовым слоем, не больше 20 МиБ.'); return; }
    if (draft && !window.confirm('Заменить текущий черновик новой выпиской? Выбранные категории не сохранятся.')) return;
    busyRef.current = true; setLoading(true);
    try {
      const result = await parseStatement(file, accountId);
      result.transactions.sort((a, b) => a.date.localeCompare(b.date) || a.sourcePage - b.sourcePage || a.rowNumber - b.rowNumber);
      setDraft({ id: crypto.randomUUID(), fileName: file.name, fileHash: result.fileHash, warnings: result.warnings, rows: result.transactions.map((t, index) => ({ ...t, statementNumber: index + 1, comment: '', decision: t.amountMinor === 0 ? 'skip' : 'save' })) });
    } catch (e) { setError(message(e)); } finally { setLoading(false); busyRef.current = false; }
  }
  function updateRow(key: string, patch: Partial<ImportRow>) { setDraft(current => current ? { ...current, rows: current.rows.map(row => rowKey(row) === key ? { ...row, ...patch } : row) } : null); }
  function removeRow(key: string) {
    if (locked || busyRef.current) return;
    setCheck(null); setCheckError('');
    setDraft(current => current ? { ...current, rows: current.rows.filter(row => rowKey(row) !== key) } : null);
  }
  function chooseAccount(id: number) {
    if (draft && accountId && !window.confirm("Сменить счёт и удалить черновик? Потребуется загрузить PDF заново.")) return;
    if (accountId) setDraft(null); setAccountId(id); setCheck(null);
    setDraft(current => current ? { ...current, rows: current.rows.map(row => ({ ...row, otherAccountId: undefined, matchToken: undefined, decision: row.decision === 'skip' ? 'skip' : 'save' })) } : null);
  }
  function clearDraft() {
    if (!locked && window.confirm('Очистить черновик? Операции из него ещё не сохранены.')) { setDraft(null); setError(''); setCheck(null); }
  }
  const rowReady = (row: ImportRow) => {
    if (row.decision === 'skip') return true;
    const validCategory = screen?.categories.some(c => c.id === row.categoryId && c.kind === (row.amountMinor < 0 ? 'expense' : 'income'));
    const validAccount = row.otherAccountId !== accountId && screen?.accounts.some(a => a.id === row.otherAccountId);
    return row.amountMinor !== 0 && (validCategory || validAccount) && (!currentCheck?.rows[rowKey(row)]?.matches.length || row.decision === 'keep');
  };
  const kept = draft?.rows.filter(r => r.decision !== 'skip').length || 0;
  const readyCount = draft?.rows.filter(rowReady).length || 0;
  const ready = !!draft?.rows.length && kept > 0 && readyCount === draft.rows.length && !!currentCheck && !currentCheck.alreadyImported && !checking && !!screen && !dataError;
  async function save() {
    if (busyRef.current || (!ready && !pendingSubmission) || !draft) return;
    const payload = pendingSubmission || { accountId, fileHash: draft.fileHash, rows: draft.rows.map(({ ruleName: _ruleName, statementNumber: _statementNumber, ...row }) => row), requestKey: crypto.randomUUID() };
    busyRef.current = true; setSaving(true); setError(''); setPendingSubmission(payload);
    try {
      const result = await api<ImportResult>('/imports', 'POST', payload);
      setDraft(null); setCheck(null); setPendingSubmission(null);
      onChanged(`Сохранено операций: ${result.saved}. Пропущено: ${result.skipped}. Балансы обновлены.`);
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPendingSubmission(null); setCheckRetry(v => v + 1);
      }
      // On an ambiguous network/server failure retain the exact payload and key.
    } finally { setSaving(false); busyRef.current = false; }
  }
  return <>
    <section className="overview-hero"><div><p className="eyebrow">От выписки — к учёту</p><h1>Загрузить выписку</h1><p className="intro-copy">Выберите счёт, распределите операции и сохраните результат.</p></div><span className="step-label">PDF → категории → история</span></section>
    <ErrorNotice error={dataError} />{dataError && <button className="text-button" onClick={() => setRetry(v => v + 1)}>Загрузить справочники повторно</button>}
    <div className="import-account-bar"><label className="field">Счёт выписки<select disabled={locked || !screen} value={accountId || ''} onChange={e => chooseAccount(Number(e.target.value))}><option value="">Выберите счёт</option>{screen?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="text-button" disabled={locked} onClick={() => setNewAccount(true)}>+ Создать счёт</button></div>
    <div className={`upload-zone ${dragging && !locked ? 'is-dragging' : ''}`} aria-busy={loading}
      onDragOver={e => { e.preventDefault(); setDragging(true); e.dataTransfer.dropEffect = locked ? 'none' : 'copy'; }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}>
      <Icon name="card" color="#658c73" /><div className="upload-copy"><h2>{loading ? 'Читаем вашу выписку…' : 'Перетащите PDF сюда'}</h2><p>Один файл с текстовым слоем, до 20 МиБ</p></div>
      <input className="hidden-input" ref={fileInput} type="file" accept=".pdf,application/pdf" aria-label="PDF-выписка" disabled={locked} onChange={e => { void upload(e.currentTarget.files); e.currentTarget.value = ''; }} />
      <button className="primary-button" disabled={locked || !accountId} onClick={() => fileInput.current?.click()}>{loading ? 'Обработка…' : 'Выбрать PDF'}</button>
    </div>
    <p className="privacy-note">Файл обрабатывается на этом компьютере. До сохранения разметка живёт только в этой вкладке.</p>
    <ErrorNotice error={error} />
    {draft && <section className="results" aria-labelledby="import-title">
      <div className="section-heading"><div><h2 id="import-title">Распознанные операции <span className="count">{draft.rows.length}</span></h2><p className="file-name">{draft.fileName}</p></div><button className="text-button" disabled={locked} onClick={clearDraft}>Очистить</button></div>
      {draft.warnings.length > 0 && <details className="warnings"><summary>Есть строки, которые требуют проверки ({draft.warnings.length})</summary><ul>{draft.warnings.map((w, i) => <li key={i}>Страница {w.sourcePage}. {w.message}</li>)}</ul></details>}
      {currentCheck?.alreadyImported && <div className="warnings" role="alert">Эта выписка уже сохранена для выбранного счёта. Исправить операции можно в истории на экране «Обзор».</div>}
      <ErrorNotice error={checkError} />
      {checkError && <button className="text-button" disabled={locked} onClick={() => setCheckRetry(v => v + 1)}>Проверить совпадения ещё раз</button>}
      {!!draft.rows.length && <>
        <p className="table-note">{checking ? 'Проверяем совпадения…' : !accountId ? 'Выберите счёт выписки, чтобы проверить совпадения.' : 'Сверьте операции с PDF. Перевод между своими счетами учитывается один раз.'}</p>
        <div className="import-list">{draft.rows.map(row => {
          const key = rowKey(row);
          const number = row.statementNumber;
          const matches = currentCheck?.rows[key]?.matches || [];
          const selected = row.categoryId ? `category:${row.categoryId}` : row.otherAccountId ? `account:${row.otherAccountId}` : '';
          const hasDestination = row.categoryId
            ? screen?.categories.some(c => c.id === row.categoryId && c.kind === (row.amountMinor < 0 ? 'expense' : 'income'))
            : row.otherAccountId !== accountId && screen?.accounts.some(a => a.id === row.otherAccountId);
          const direction = row.amountMinor < 0 ? 'Куда' : 'Откуда';
          return <article key={key} className={`import-row${hasDestination && row.decision !== 'skip' ? ' is-categorized' : ''}`}>
            <div className="import-row-top"><span className="import-number">№{number}</span><time dateTime={row.date}>{dateLabel(row.date)}</time><strong className={row.amountMinor > 0 ? 'income' : 'expense'}>{row.amountMinor > 0 ? '+' : ''}{money(row.amountMinor)}</strong>
              <button type="button" className="import-delete" disabled={locked} aria-label={`Удалить операцию ${number}`} title="Удалить из списка" onClick={() => removeRow(key)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>
              </button>
            </div>
            <p className="import-description">{row.description}</p>{row.ruleName && <p className="muted">Правило: {row.ruleName}</p>}
            <div className="import-row-fields">
              <div className="import-direction"><span>{direction}</span><ImportPicker label={`${direction} для операции ${number}`} value={selected} disabled={locked || !active || row.decision === 'skip' || !accountId}
                groups={[
                  { label: row.amountMinor < 0 ? 'Расходы' : 'Доходы', options: (screen?.categories || []).filter(c => c.kind === (row.amountMinor < 0 ? 'expense' : 'income')).map(c => ({ ...c, value: `category:${c.id}` })) },
                  { label: 'Перевод между счетами', options: (screen?.accounts || []).filter(a => a.id !== accountId).map(a => ({ ...a, value: `account:${a.id}` })) },
                ]}
                onChange={value => {
                  const [type, id] = value.split(':');
                  updateRow(key, { ruleName: undefined, categoryId: type === 'category' ? Number(id) : undefined, otherAccountId: type === 'account' ? Number(id) : undefined });
                }} /></div>
              <input className="import-comment" aria-label={`Комментарий операции ${number}`} maxLength={2000} value={row.comment} disabled={locked || row.decision === 'skip'} placeholder="Комментарий" onChange={e => updateRow(key, { comment: e.target.value })} />
            </div>
            {row.amountMinor === 0 && <p className="import-zero-note">Нулевая сумма — операция не будет сохранена.</p>}
            {!!matches.length && row.decision !== 'skip' && <div className="duplicate-note">{matches.map((match, i) => <p key={i}>{match.relatedRows ? `Похожие строки в этой выписке: ${match.relatedRows.map(ref => draft.rows.find(candidate => rowKey(candidate) === rowKey(ref))).filter((candidate): candidate is Draft['rows'][number] => !!candidate).map(candidate => `№${candidate.statementNumber}`).join(', ')}. Оставьте нужные или подтвердите отдельные операции.` : <>{match.transactionId ? `Совпадение с ранее сохранённой операцией в истории, ID ${match.transactionId}. ` : ''}{match.reason}</>}</p>)}
              <label className="duplicate-confirm"><input type="checkbox" checked={row.decision === 'keep'} disabled={locked || checking} onChange={e => updateRow(key, { decision: e.target.checked ? 'keep' : 'save' })} /><span>Сохранить как отдельную операцию</span></label>
            </div>}
          </article>;
        })}</div>
        <div className="import-save-bar"><div><strong>{pendingSubmission ? 'Подтвердите результат сохранения' : `Разобрано ${readyCount} из ${draft.rows.length}`}</strong><p>{pendingSubmission ? 'Повтор отправит тот же запрос и не создаст операции дважды.' : `Будет сохранено: ${kept}. Пропущено: ${draft.rows.length - kept}.`}</p></div>
          {(ready || pendingSubmission) ? <button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : pendingSubmission ? 'Повторить сохранение' : 'Сохранить операции'}</button> : <span className="muted">{currentCheck?.alreadyImported ? 'Выписка уже сохранена' : kept === 0 ? 'Все строки пропущены' : 'Распределите операции и проверьте совпадения'}</span>}
        </div>
      </>}
      {!draft.rows.length && <div className="empty-result"><h3>Нет операций для сохранения</h3><p>Все строки удалены или в выписке не найдены операции. Можно загрузить другую выписку.</p></div>}
    </section>}
    {newAccount && <AccountForm onClose={() => setNewAccount(false)} onSaved={onChanged} />}
  </>;
}
