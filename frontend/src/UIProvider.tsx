import { ConfirmProvider } from './Confirm';
import { MantineProvider, createTheme, Modal, Popover, Combobox } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import type { ReactNode } from 'react';
import 'dayjs/locale/ru.js';

export function UIProvider({ children, testing = false }: { children: ReactNode; testing?: boolean }) {
  return <MantineProvider forceColorScheme="light" env={testing ? "test" : "default"} theme={testing ? createTheme({ components: { Modal: Modal.extend({ defaultProps: { transitionProps: { duration: 0 } } }), Popover: Popover.extend({ defaultProps: { transitionProps: { duration: 0 } } }), Combobox: Combobox.extend({ defaultProps: { transitionProps: { duration: 0 } } }) } }) : undefined}><DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1 }}><ConfirmProvider>{children}</ConfirmProvider></DatesProvider></MantineProvider>;
}
