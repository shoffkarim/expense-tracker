import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Group, Modal, Text } from '@mantine/core';

type Request = { owner: symbol; message: string; resolve: (value: boolean) => void };
const Context = createContext<{ ask: (owner: symbol, message: string) => Promise<boolean>; cancel: (owner: symbol) => void } | null>(null);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const pending = useRef<Request | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const finish = useCallback((value: boolean) => {
    const current = pending.current;
    pending.current = null; setRequest(null); current?.resolve(value);
  }, []);
  const ask = useCallback((owner: symbol, message: string) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const next = { owner, message, resolve };
      pending.current = next; setRequest(next);
    });
  }, []);
  const cancel = useCallback((owner: symbol) => { if (pending.current?.owner === owner) finish(false); }, [finish]);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
  return <Context.Provider value={{ ask, cancel }}>{children}
    <Modal opened={!!request} onClose={() => finish(false)} title="Подтверждение действия" closeButtonProps={{"aria-label":"Закрыть подтверждение"}} closeOnClickOutside={false} zIndex={400} returnFocus>
      <Text>{request?.message}</Text>
      <Group justify="flex-end" mt="lg"><Button variant="default" data-autofocus onClick={() => finish(false)}>Отмена</Button><Button color="red" onClick={() => finish(true)}>Подтвердить</Button></Group>
    </Modal>
  </Context.Provider>;
}
export function useConfirm() {
  const context = useContext(Context);
  if (!context) throw new Error('ConfirmProvider is required');
  const { ask, cancel } = context;
  const owner = useRef(Symbol());
  const [confirming, setConfirming] = useState(false);
  const waiting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(owner.current); }; }, [cancel]);
  const confirm = async (message: string) => {
    if (waiting.current) return false;
    waiting.current = true; setConfirming(true);
    const result = await ask(owner.current, message);
    waiting.current = false;
    if (mounted.current) setConfirming(false);
    return mounted.current && result;
  };
  return { confirm, confirming };
}
