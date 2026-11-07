import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:8080/#/dashboard' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'DOMException', 'FormData', 'File']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { App } = await import('../src/App.tsx');
const { ImportScreen } = await import('../src/ImportScreen.tsx');
const { ImportPicker } = await import('../src/ImportPicker.tsx');
const { OperationForm, AccountForm } = await import('../src/Forms.tsx');
const { parseMoneyInput, moneyInput, money } = await import('../src/ui.tsx');
const base = {
  month: '2026-10', totalBalanceMinor: 100000,
  accounts: [{ id: 1, name: 'Карта', color: '#658c73', icon: 'card', balanceMinor: 100000, initialBalanceMinor: 100000, archived: false }, { id: 2, name: 'Наличные', color: '#627eaa', icon: 'cash', balanceMinor: 0, initialBalanceMinor: 0, archived: false }],
  categories: [{ id: 1, kind: 'expense', name: 'Еда', color: '#c87946', icon: 'food', amountMinor: 0, archived: false }, { id: 2, kind: 'income', name: 'Зарплата', color: '#658c73', icon: 'work', amountMinor: 0, archived: false }],
};
let root, requests, respond;
const ok = data => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  window.location.hash = '#/dashboard';
  window.confirm = () => true;
  window.scrollTo = () => {};
  requests = [];
  respond = async (url, options) => {
    if (url === '/api/dashboard' || url === '/api/import-screen') return ok(base);
    if (url.startsWith('/api/transactions?')) return ok({ transactions: [], total: 0, page: 1, pageSize: 20 });
    if (options.method === 'POST' || options.method === 'PATCH') return ok({ id: 10 });
    return ok({ ok: true });
  };
  globalThis.fetch = async (url, options = {}) => {
    const request = { url, ...options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body };
    requests.push(request);
    if (url === '/api/tags') return ok(['кофе', 'работа']);
    return respond(url, options, request);
  };
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); });
after(() => { dom.window.close(); });
const render = async element => { await act(async () => { root.render(element); }); };
const buttons = () => [...document.querySelectorAll('button')].filter(el => !el.closest('[hidden]'));
const button = text => { const node = buttons().find(el => el.textContent === text); assert.ok(node, `Button ${text} missing`); return node; };
const click = async node => { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
const change = async (node, value) => {
  assert.ok(node, 'Input missing');
  await act(async () => {
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const choose = async (label, name) => {
  await click(document.querySelector(`[aria-label="${label}"]`));
  const option = [...document.querySelectorAll('[role=option]')].find(node => node.textContent.replace('✓', '') === name);
  assert.ok(option, `Option ${name} missing`);
  await click(option);
};
const key = async (node, value) => { await act(async () => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); };
const field = name => [...document.querySelectorAll('label')].find(el => el.firstChild?.textContent === name)?.querySelector('input,select,textarea');
const submit = async () => { await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
const navigate = async hash => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new Event('hashchange')); await new Promise(resolve => setTimeout(resolve, 0)); }); };

test('decimal inputs use integer kopecks and reject rounding or unsafe values', () => {
  assert.equal(parseMoneyInput('1234,56'), 123456);
  assert.equal(parseMoneyInput('-0.01', true), -1);
  assert.equal(parseMoneyInput('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(moneyInput(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.match(money(Number.MAX_SAFE_INTEGER), /,91/);
  assert.match(money(-1), /^−0,01/);
  for (const value of ['1.001', '1e2', '-1', 'NaN', '90071992547409.92']) assert.throws(() => parseMoneyInput(value));
});

test('account creation and manual balance editing use minor units', async () => {
  let saved = false;
  await render(h(AccountForm, { account: base.accounts[0], onClose() {}, onSaved() { saved = true; } }));
  await change(field('Текущий баланс, ₽'), '-123,45');
  await submit();
  const request = requests.find(r => r.url === '/api/accounts/1');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.body.balanceMinor, -12345);
  assert.equal(saved, true);
});

test('manual income sends the receiving account and income category', async () => {
  await render(h(OperationForm, { screen: base, onClose() {}, onSaved() {} }));
  await change(field('Тип операции'), 'income');
  await change(field('Сумма, ₽'), '2500,01');
  await change(field('Куда'), '1');
  await change(field('Источник дохода'), '2');
  await submit();
  const request = requests.find(r => r.url === '/api/transactions');
  assert.equal(request.body.kind, 'income');
  assert.equal(request.body.amountMinor, 250001);
  assert.equal(request.body.destinationAccountId, 1);
  assert.equal(request.body.categoryId, 2);
  assert.equal(request.body.sourceAccountId, undefined);
});

test('import survives navigation, requires categorization and duplicate decision, retries the exact payload', async () => {
  const defaultResponder = respond;
  let saveAttempts = 0;
  respond = async (url, options, request) => {
    if (url === '/api/parse-statement?accountId=1') return ok({ fileHash: 'a'.repeat(64), warnings: [], transactions: [
      { sourcePage: 1, rowNumber: 1, date: '2026-10-01', description: 'Synthetic purchase', amountMinor: -12345 },
      { sourcePage: 1, rowNumber: 2, date: '2026-10-02', description: 'Synthetic transfer', amountMinor: 20000 },
    ] });
    if (url === '/api/imports/check') return ok({ alreadyImported: false, rows: request.body.rows.map(row => row.rowNumber === 1
      ? { matches: [], matchToken: 'one' } : { matches: [{ transactionId: 42, reason: 'Возможная сторона уже учтённого перевода.' }], matchToken: 'two' }) });
    if (url === '/api/imports') {
      saveAttempts++;
      if (saveAttempts === 1) throw new TypeError('Simulated lost response');
      return ok({ id: 1, saved: 1, skipped: 0 });
    }
    return defaultResponder(url, options, request);
  };
  await render(h(App));
  await navigate('#/import');
  assert.ok(requests.some(r => r.url === '/api/import-screen'));
  await change(field('Счёт выписки'), '1');
  const input = document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['%PDF-synthetic'], 'synthetic.pdf', { type: 'application/pdf' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  assert.equal(document.querySelectorAll('.import-row').length, 2);
  assert.ok(!buttons().some(b => b.textContent === 'Сохранить операции'));
  await choose('Куда для операции 1', 'Еда');
  await choose('Откуда для операции 2', 'Зарплата');
  assert.ok(!buttons().some(b => b.textContent === 'Сохранить операции'));
  await click(document.querySelector('.duplicate-confirm input'));
  assert.ok(button('Сохранить операции'));
  await click(document.querySelector('.duplicate-confirm input'));
  assert.ok(!buttons().some(b => b.textContent === 'Сохранить операции'));
  await click(document.querySelector('[aria-label="Удалить операцию 2"]'));
  assert.equal(document.querySelectorAll('.import-row').length, 1);
  assert.ok(button('Сохранить операции'));
  await navigate('#/dashboard');
  await navigate('#/import');
  assert.equal(document.querySelector('[aria-label="Куда для операции 1"]').textContent, 'Еда');
  await click(button('Сохранить операции'));
  assert.ok(button('Повторить сохранение'));
  assert.equal(document.querySelector('[aria-label="Куда для операции 1"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="Удалить операцию 1"]').disabled, true);
  await click(button('Повторить сохранение'));
  const saves = requests.filter(r => r.url === '/api/imports');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[0].body, saves[1].body);
  assert.ok(saves[0].body.requestKey);
  assert.equal(saves[0].body.rows.length, 1);
  assert.equal(saves[0].body.rows[0].rowNumber, 1);
  assert.equal(document.querySelector('[aria-label="Удалить операцию 1"]'), null);
  assert.equal(document.querySelectorAll('.import-row').length, 0);
  assert.match(document.querySelector('[role=status]').textContent, /Сохранено операций: 1/);
});


const syntheticRows = () => [1, 2, 3].map(n => ({ sourcePage: 1, rowNumber: n, date: '2026-10-01', description: `Synthetic ${n}`, amountMinor: -100 * n, categoryId: 1, comment: `Comment ${n}`, decision: 'save' }));
function DraftHarness({ rows = syntheticRows() }) {
  const [draft, setDraft] = useState({ id: 'synthetic-draft', fileName: 'synthetic.pdf', fileHash: 'a'.repeat(64), warnings: [], rows: rows.map((row, i) => ({ ...row, statementNumber: i + 1 })) });
  return h(ImportScreen, { draft, setDraft, active: true, revision: 0, onChanged() {} });
}
function mockImportChecks(check) {
  const previous = respond;
  respond = (url, options, request) => url === '/api/imports/check' ? check(request) : previous(url, options, request);
}
const cleanCheck = request => ok({ alreadyImported: false, rows: request.body.rows.map(row => ({ matches: [], matchToken: `token-${row.rowNumber}` })) });
const deleteRow = n => click(document.querySelector(`[aria-label="Удалить операцию ${n}"]`));

test('deleting middle and first rows preserves values and excludes deleted rows from checks and save', async () => {
  mockImportChecks(cleanCheck);
  await render(h(DraftHarness));
  await change(field('Счёт выписки'), '1');
  await choose('Куда для операции 3', 'Наличные');
  await change(document.querySelector('[aria-label="Комментарий операции 3"]'), 'Keep this comment');
  await deleteRow(2);
  assert.deepEqual([...document.querySelectorAll('.import-description')].map(n => n.textContent), ['Synthetic 1', 'Synthetic 3']);
  assert.equal(document.querySelector('[aria-label="Комментарий операции 3"]').value, 'Keep this comment');
  assert.equal(document.querySelector('[aria-label="Куда для операции 3"]').textContent, 'Наличные');
  await deleteRow(1);
  assert.equal(document.querySelector('.import-description').textContent, 'Synthetic 3');
  assert.deepEqual(requests.filter(r => r.url === '/api/imports/check').at(-1).body.rows.map(r => r.rowNumber), [3]);
  await click(button('Сохранить операции'));
  const saved = requests.find(r => r.url === '/api/imports').body.rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].rowNumber, 3);
  assert.equal(saved[0].comment, 'Keep this comment');
  assert.equal(saved[0].otherAccountId, 2);
  assert.equal(saved[0].categoryId, undefined);
});

test('deleting all rows shows an empty state and never saves an empty import', async () => {
  mockImportChecks(cleanCheck);
  await render(h(DraftHarness));
  await change(field('Счёт выписки'), '1');
  await deleteRow(1); await deleteRow(2); await deleteRow(3);
  assert.equal(document.querySelectorAll('.import-row').length, 0);
  assert.match(document.querySelector('.empty-result').textContent, /Нет операций для сохранения/);
  assert.equal(document.querySelector('.count').textContent, '0');
  assert.ok(!buttons().some(b => b.textContent === 'Сохранить операции'));
  assert.ok(!requests.some(r => r.url === '/api/imports'));
  assert.ok(requests.filter(r => r.url === '/api/imports/check').every(r => r.body.rows.length));
});

test('deletion rechecks duplicates and ignores a late response for the previous row set', async () => {
  let resolveOld;
  mockImportChecks(request => request.body.rows.length === 3 ? new Promise(resolve => { resolveOld = resolve; }) : cleanCheck(request));
  await render(h(DraftHarness));
  await change(field('Счёт выписки'), '1');
  assert.ok(resolveOld);
  await deleteRow(1);
  assert.ok(button('Сохранить операции'));
  await act(async () => resolveOld(ok({ alreadyImported: true, rows: syntheticRows().map(() => ({ matches: [{ reason: 'Stale warning' }], matchToken: 'stale' })) })));
  assert.equal(document.querySelector('.duplicate-note'), null);
  assert.ok(button('Сохранить операции'));
  await click(button('Сохранить операции'));
  assert.deepEqual(requests.find(r => r.url === '/api/imports').body.rows.map(r => [r.rowNumber, r.matchToken]), [[2, 'token-2'], [3, 'token-3']]);
});

test('duplicate confirmation follows the row and resets when its matches change', async () => {
  mockImportChecks(request => ok({ alreadyImported: false, rows: request.body.rows.map(row => ({
    matches: row.rowNumber === 3 ? [{ reason: `Warning for row 3, ${request.body.rows.length} rows` }] : [],
    matchToken: `${row.rowNumber}-${request.body.rows.length}`,
  })) }));
  await render(h(DraftHarness));
  await change(field('Счёт выписки'), '1');
  await click(document.querySelector('.duplicate-confirm input'));
  assert.ok(button('Сохранить операции'));
  await deleteRow(1);
  assert.match(document.querySelectorAll('.import-row')[1].textContent, /Warning for row 3, 2 rows/);
  assert.equal(document.querySelectorAll('.import-row')[0].querySelector('.duplicate-note'), null);
  assert.equal(document.querySelector('.duplicate-confirm input').checked, false);
  assert.ok(!buttons().some(b => b.textContent === 'Сохранить операции'));
  await click(document.querySelector('.duplicate-confirm input'));
  assert.ok(button('Сохранить операции'));
});

test('picker supports selection, changing selection, keyboard, outside clicks and disabled state', async () => {
  const groups = [{ label: 'Расходы', options: base.categories.filter(c => c.kind === 'expense').map(c => ({ ...c, value: `category:${c.id}` })) },
    { label: 'Перевод между счетами', options: [{ ...base.accounts[1], value: 'account:2' }] }];
  function PickerHarness({ disabled = false }) {
    const [value, setValue] = useState('');
    return h(ImportPicker, { label: 'Куда', groups, value, onChange: setValue, disabled });
  }
  await render(h(PickerHarness));
  const trigger = document.querySelector('[aria-label="Куда"]');
  assert.equal(trigger.textContent, '');
  await key(trigger, 'ArrowDown');
  let menu = document.querySelector('[role=listbox]');
  assert.equal(document.activeElement, menu);
  await key(menu, 'End');
  await key(menu, 'Enter');
  assert.equal(trigger.textContent, 'Наличные');
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector('[role=listbox]'), null);
  await click(trigger);
  menu = document.querySelector('[role=listbox]');
  assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'Наличные✓');
  await key(menu, 'Home'); await key(menu, ' ');
  assert.equal(trigger.textContent, 'Еда');
  await click(trigger);
  await key(document.querySelector('[role=listbox]'), 'ArrowDown');
  await key(document.querySelector('[role=listbox]'), 'ArrowUp');
  await key(document.querySelector('[role=listbox]'), 'Escape');
  assert.equal(document.querySelector('[role=listbox]'), null);
  assert.equal(document.activeElement, trigger);
  await click(trigger);
  await act(async () => trigger.focus());
  await click(trigger);
  assert.equal(document.querySelector('[role=listbox]'), null);
  await click(trigger);
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('[role=listbox]'), null);
  await click(trigger);
  await key(document.querySelector('[role=listbox]'), 'Tab');
  assert.equal(document.querySelector('[role=listbox]'), null);
  await click(trigger);
  await render(h(PickerHarness, { disabled: true }));
  assert.equal(trigger.disabled, true);
  assert.equal(document.querySelector('[role=listbox]'), null);
});

test('rules page creates a rule', async () => {
  const previous = respond; let rules = [];
  respond = async (url, options, request) => {
    if (url === '/api/rules' && options.method === 'GET') return ok(rules);
    if (url === '/api/rules' && options.method === 'POST') { rules = [{ ...request.body, id: 1, available: true }]; return ok({ id: 1 }); }
    return previous(url, options, request);
  };
  await render(h(App)); await navigate('#/rules'); await click(button('Добавить правило'));
  await change(field('Название'), 'Магазин'); await change(field('Текст'), 'shop'); await change(field('Результат'), 'c:1');
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const request = requests.find(r => r.url === '/api/rules' && r.method === 'POST');
  assert.equal(request.body.text, 'shop'); assert.equal(request.body.categoryId, 1);
  assert.match(document.querySelector('main').textContent, /Содержит «shop»/);
});

 test('duplicate messages distinguish statement numbers and history IDs', async () => {
  mockImportChecks(request => ok({ alreadyImported: false, rows: request.body.rows.map(row => ({
    matches: row.rowNumber === 1 ? [{ relatedRows: [{ sourcePage: 1, rowNumber: 3 }], reason: 'Same statement' }, { transactionId: 42, reason: 'Совпадают счёт, дата, сумма и описание.' }] : [], matchToken: 'token',
  })) }));
  await render(h(DraftHarness));
  await change(field('Счёт выписки'), '1');
  assert.deepEqual([...document.querySelectorAll('.import-number')].map(n => n.textContent), ['№1', '№2', '№3']);
  assert.match(document.querySelector('.duplicate-note').textContent, /Похожие строки в этой выписке: №3/);
  assert.match(document.querySelector('.duplicate-note').textContent, /в истории, ID 42/);
  await deleteRow(2);
  assert.deepEqual([...document.querySelectorAll('.import-number')].map(n => n.textContent), ['№1', '№3']);
  assert.match(document.querySelector('.duplicate-note').textContent, /Похожие строки в этой выписке: №3/);
  assert.ok(requests.filter(r => r.url === '/api/imports/check').every(r => r.body.rows.every(row => !('statementNumber' in row))));
 });

test('history loads pages on intersection and resets filters on re-entry', async () => {
  let intersect;
  globalThis.IntersectionObserver = class {
    constructor(callback) { intersect = callback; }
    observe() {}
    disconnect() { intersect = null; }
  };
  const navigate = async hash => act(async () => {
    window.location.hash = hash;
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  respond = async url => {
    if (url === '/api/dashboard' || url === '/api/import-screen') return ok(base);
    const query = new URL(url, window.location.origin).searchParams;
    const page = Number(query.get('page'));
    return ok({ total: 23, page, pageSize: 20, transactions: Array.from({ length: page === 1 ? 20 : 3 }, (_, i) => ({
      id: 23 - (page - 1) * 20 - i, kind: 'expense', date: '2026-10-01',
      sourceAccountId: 1, categoryId: 1, amountMinor: 100, description: '', comment: '',
    })) });
  };
  await render(h(App));
  assert.equal(requests.filter(r => r.url.startsWith('/api/transactions?')).length, 0);
  await navigate('#/history');
  assert.equal(document.querySelectorAll('.history-row').length, 20);
  await act(async () => { intersect([{ isIntersecting: true }]); intersect([{ isIntersecting: true }]); });
  assert.equal(document.querySelectorAll('.history-row').length, 23);
  assert.equal(requests.filter(r => r.url.includes('page=2')).length, 1);
  assert.equal(intersect, null);
  await change(document.querySelector('.history-filters select'), '1');
  assert.equal(document.querySelectorAll('.history-row').length, 20);
  await navigate('#/dashboard');
  await navigate('#/history');
  assert.equal(document.querySelector('.history-filters select').value, '');
  assert.equal(document.querySelectorAll('.history-row').length, 20);
  delete globalThis.IntersectionObserver;
});

test('dashboard links seed history filters and keep editing separate', async () => {
  await render(h(App));
  for (const [selector, param, value] of [
    ['.account-card .card-link', 'accountId', '1'],
    ['.category-card .card-link', 'categoryId', '1'],
    ['[href="#/history?categoryId=2"]', 'categoryId', '2'],
  ]) {
    await navigate('#/dashboard');
    const link = document.querySelector(selector);
    assert.ok(link);
    await navigate(link.getAttribute('href'));
    const query = new URL(requests.filter(r => r.url.startsWith('/api/transactions?')).at(-1).url, window.location.origin).searchParams;
    assert.equal(query.get(param), value);
    assert.equal(query.get(param === 'accountId' ? 'categoryId' : 'accountId'), '');
    assert.equal(query.get('from'), '');
    assert.equal(query.get('to'), '');
    assert.equal(query.get('page'), '1');
    assert.equal(document.querySelectorAll('.history-filters select')[param === 'accountId' ? 0 : 1].value, value);
  }
  await navigate('#/history?accountId=2');
  assert.equal(document.querySelector('.history-filters select').value, '2');
  await navigate('#/history');
  assert.equal(document.querySelector('.history-filters select').value, '');
  await navigate('#/dashboard');
  await click(document.querySelector('[aria-label="Редактировать счёт Карта"]'));
  assert.ok(document.querySelector('dialog[open]'));
  assert.equal(window.location.hash, '#/dashboard');
});

test('direct history link applies filter on first request', async () => {
  window.location.hash = '#/history?categoryId=2';
  await render(h(App));
  const query = new URL(requests.find(r => r.url.startsWith('/api/transactions?')).url, window.location.origin).searchParams;
  assert.equal(query.get('categoryId'), '2');
  assert.equal(document.querySelectorAll('.history-filters select')[1].value, '2');
});

 test('rules support adding, removing and editing OR alternatives', async () => {
  let rules = [{ id:1, name:'Food', direction:'expense', condition:'text', text:'WakefulOwl', amountMinor:0, categoryId:1, available:true }];
  const previous=respond;
  respond=async (url,options,request)=>{
   if(url==='/api/rules'&&options.method==='GET')return ok(rules);
   if(url==='/api/rules/1'&&options.method==='PATCH'){rules=[{...request.body,id:1}];return ok({id:1});}
   return previous(url,options,request);
  };
  await render(h(App));await navigate('#/rules');await click(button('Изменить'));
  assert.equal(field('Текст').value,'WakefulOwl');
  assert.equal(field('Текст').checkValidity(),true);
  await click(button('+')); assert.equal(buttons().some(b=>b.textContent==='+'),false);
  await change(field('Текст 2'),'SAMOKAT');await click(button('+'));
  await click(document.querySelector('[aria-label="Удалить текст 3"]'));
  await submit();
  assert.deepEqual(requests.find(r=>r.method==='PATCH').body.texts,['WakefulOwl','SAMOKAT']);
  assert.match(document.querySelector('main').textContent,/Содержит «WakefulOwl» или «SAMOKAT»/);
  await click(button('Изменить')); assert.equal(field('Текст 2').value,'SAMOKAT');
 });

 test('history month separators span pages and omit the current year', async () => {
  let intersect;
  globalThis.IntersectionObserver=class {constructor(cb){intersect=cb}observe(){}disconnect(){}};
  const year=new Date().getFullYear();
  respond=async url=>{
   if(url==='/api/dashboard'||url==='/api/import-screen')return ok(base);
   const page=Number(new URL(url,window.location.origin).searchParams.get('page'));
   const dates=page===1?[`${year}-11-02`,`${year}-10-31`]:[`${year}-10-01`,`${year-1}-12-31`];
   return ok({page,pageSize:2,total:4,transactions:dates.map((date,i)=>({id:page*2+i,date,kind:'expense',sourceAccountId:1,categoryId:1,amountMinor:100}))});
  };
  try {
   await render(h(App));await navigate('#/history');
   assert.deepEqual([...document.querySelectorAll('.history-month')].map(n=>n.textContent),['Октябрь']);
   await act(async()=>intersect([{isIntersecting:true}]));
   assert.deepEqual([...document.querySelectorAll('.history-month')].map(n=>n.textContent),['Октябрь',`Декабрь ${year-1}`]);
   await change(document.querySelector('.history-filters select'),'1');
   assert.deepEqual([...document.querySelectorAll('.history-month')].map(n=>n.textContent),['Октябрь']);
  } finally {delete globalThis.IntersectionObserver;}
 });

test('tags support creation, deduplication, removal and operation saving', async () => {
 await render(h(OperationForm, {screen:base,onClose(){},onSaved(){}}));
 const input=document.querySelector('input[list]');
 await change(input,'Кофе');await key(input,'Enter');
 await change(input,'кофе');await key(input,'Enter');
 assert.equal(document.querySelectorAll('.tag').length,1);
 await change(input,'работа');await key(input,'Enter');
 await click(document.querySelector('[aria-label="Убрать тег работа"]'));
 await change(field('Сумма, ₽'),'10');await change(field('Откуда'),'1');await change(field('Категория расхода'),'1');
 await submit();
 assert.deepEqual(requests.find(r=>r.url==='/api/transactions'&&r.method==='POST').body.tags,['кофе']);
});
test('tag filter combines with account and category', async () => {
 await render(h(App));await navigate('#/history');
 await change(field('Тег'),'кофе');await change(field('Счёт'),'1');await change(field('Категория'),'1');
 const query=new URL(requests.filter(r=>r.url.startsWith('/api/transactions?')).at(-1).url,'http://localhost').searchParams;
 assert.equal(query.get('tag'),'кофе');assert.equal(query.get('accountId'),'1');assert.equal(query.get('categoryId'),'1');
});
