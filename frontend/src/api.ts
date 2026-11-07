export type Kind = 'expense' | 'income' | 'transfer';
export type Transaction = { sourcePage: number; rowNumber: number; date: string; description: string; amountMinor: number };
export type ParseWarning = { sourcePage: number; message: string };
export type ParseStatementResponse = { transactions: (Transaction & { tags?: string[]; categoryId?: number; otherAccountId?: number; ruleName?: string })[]; warnings: ParseWarning[]; fileHash: string };
export type Account = { id: number; name: string; color: string; icon: string; initialBalanceMinor: number; balanceMinor: number; archived: boolean };
export type Category = { id: number; kind: 'expense' | 'income'; name: string; color: string; icon: string; archived: boolean; amountMinor: number };
export type Screen = { month: string; totalBalanceMinor: number; accounts: Account[]; categories: Category[] };
export type OperationInput = { tags?: string[]; kind: Kind; date: string; amountMinor: number; sourceAccountId?: number; destinationAccountId?: number; categoryId?: number; description: string; comment: string };
export type Operation = OperationInput & { id: number; importId?: number; sourcePage?: number; rowNumber?: number };
export type History = { transactions: Operation[]; total: number; page: number; pageSize: number };
export type ImportRow = Transaction & { ruleName?: string; tags?: string[]; categoryId?: number; otherAccountId?: number; comment: string; decision: 'save' | 'skip' | 'keep'; matchToken?: string };
export type Draft = { id: string; fileName: string; fileHash: string; warnings: ParseWarning[]; rows: (ImportRow & { statementNumber: number; amountText?: string; amountError?: string })[] };
export type ImportPayload = { accountId: number; fileHash: string; requestKey?: string; rows: ImportRow[] };
export type ImportCheck = { alreadyImported: boolean; rows: { matches: { transactionId?: number; relatedRows?: { sourcePage: number; rowNumber: number }[]; reason: string }[]; matchToken: string }[] };
export type ImportResult = { id: number; saved: number; skipped: number };

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, cache: 'no-store', signal,
      ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Не удалось связаться с локальным сервером. Проверьте, что он запущен.');
  }
  const payload = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) throw new ApiError((payload as { error?: string } | null)?.error || 'Не удалось выполнить запрос.', response.status);
  if (payload === null) throw new ApiError('Сервер вернул некорректный ответ. Повторите запрос.');
  return payload as T;
}
export function parseStatement(file: File, accountId: number) {
  const body = new FormData(); body.append('file', file);
  return api<ParseStatementResponse>(`/parse-statement?accountId=${accountId}`, 'POST', body);
}
