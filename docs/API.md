# Локальное API

Все маршруты имеют префикс `/api`. Ответы — JSON с `Cache-Control: no-store`. JSON-запросы ограничены 8 МиБ; неизвестные поля отклоняются. Операции с деньгами используют целые копейки в диапазоне безопасных целых JavaScript. ID — положительные целые числа. Авторизации нет, доступ только через локальный интерфейс.

Ошибки: `{ "error": "Понятное сообщение" }`. Коды: `400` — входные данные, `404` — запись отсутствует, `409` — конфликт импорта или архивная ссылка, `500` — ошибка базы. У парсера также есть `413` и `422`. Успешные JSON-запросы возвращают `200`.

## Данные экранов

- `GET /import-screen`: только активные счета и категории.
- `GET /dashboard`: все счета/категории, включая архив, и итоги текущего месяца. Фронтенд скрывает архивные категории с нулевой суммой.

Оба ответа:

```ts
type Screen = {
  month: string; // YYYY-MM по локальному времени сервера
  totalBalanceMinor: number; // сумма активных счетов
  accounts: Account[];
  categories: Category[];
};
type Account = {
  id: number;
  name: string;
  color: string; // #RRGGBB
  icon: string;
  initialBalanceMinor: number;
  balanceMinor: number;
  archived: boolean;
};
type Category = {
  id: number;
  kind: 'expense' | 'income';
  name: string;
  color: string;
  icon: string;
  archived: boolean;
  amountMinor: number; // сумма категории за month
};
```

## Счета и категории

- `POST /accounts`: `{name, color, icon, balanceMinor}`; баланс становится начальным и текущим.
- `PATCH /accounts/{id}`: тот же набор полей; баланс задаёт новый текущий остаток, разница фиксируется отдельной корректировкой.
- `POST /categories`, `PATCH /categories/{id}`: `{kind, name, color, icon}`. Тип существующей категории менять нельзя.
- `DELETE /accounts/{id}`, `DELETE /categories/{id}`: архивирование, ответ `{ok:true}`. Связанные операции не удаляются.

Сохранение возвращает `{id}`. Название — 1–80 символов, цвет — `#RRGGBB`. Иконки: `wallet`, `bank`, `card`, `cash`, `food`, `home`, `car`, `health`, `other`, `work`, `chart`, `gift`, `travel`, `shopping`, `coffee`, `education`.

## Операции

`POST /transactions`, `PATCH /transactions/{id}` принимают полный объект:

```ts
type OperationInput = {
  kind: 'expense' | 'income' | 'transfer';
  date: string; // YYYY-MM-DD, начиная с 1900 года
  amountMinor: number; // положительная сумма
  sourceAccountId?: number;
  destinationAccountId?: number;
  categoryId?: number;
  description: string; // до 4000 символов
  comment: string; // до 2000 символов
};
```

- Расход: `sourceAccountId` и расходная `categoryId`.
- Доход: `destinationAccountId` и доходная `categoryId`.
- Перевод: два разных счёта, без `categoryId`.

Неиспользуемые ID опускаются или равны нулю. Ответ — `{id}`. Новые ссылки на архивные сущности запрещены; существующие архивные ссылки можно сохранить при редактировании истории.

`DELETE /transactions/{id}` отменяет влияние операции на балансы/итоги, помечает удалённой и возвращает `{ok:true}`. Повторное удаление возвращает `404`.

`GET /transactions?accountId=&categoryId=&from=&to=&page=1`: фильтры необязательны; даты включительны. Ответ `{transactions, total, page, pageSize:20}`. Каждая операция содержит `OperationInput`, `id` и при наличии `importId`, `sourcePage`, `rowNumber`. Порядок: дата по убыванию, затем ID по убыванию. Удалённые записи исключены.

## Парсинг PDF

`POST /parse-statement`: multipart, единственное поле `file`, один PDF до 20 МиБ. Ответ:

```ts
type ParseResult = {
  fileHash: string; // SHA-256 исходных байтов PDF, hex в нижнем регистре
  transactions: ParsedRow[];
  warnings: {sourcePage: number; message: string}[];
};
type ParsedRow = {
  sourcePage: number;
  rowNumber: number;
  date: string; // YYYY-MM-DD
  description: string;
  amountMinor: number; // со знаком, минус — списание
};
```

Разбор не сохраняет ничего в базу. Геометрия поддерживаемого PDF — 595×842; Poppler `pdftotext -bbox-layout`. Неоднозначные строки пропускаются с предупреждением. Временные файлы удаляются; таймаут Poppler — 30 секунд.

Автоматически распознаются два шаблона по заголовку документа и колонкам таблицы: «Выписка по договору» (пять колонок, двухзначный год) и «Справка о движении средств» (шесть колонок, четырёхзначный год). Параметр выбора формата не требуется. Неизвестный или неоднозначный шаблон возвращает `422`.

Для обоих форматов `date` — дата операции, а не обработки/списания; `amountMinor` — сумма со знаком в целых копейках. Поддерживаются только рублёвые операции с совпадающими суммами в валюте операции и счёта/карты. Порядок соответствует PDF; `sourcePage` — страница начала операции, `rowNumber` — номер операции внутри страницы, начиная с 1 (пропущенные некорректные операции тоже занимают номер). Описания объединяются при переносах; время, номер карты, шапки, колонтитулы и итоги не входят в результат.

## Проверка и сохранение импорта

`POST /imports/check` и `POST /imports` принимают:

```ts
type ImportInput = {
  accountId: number;
  fileHash: string;
  requestKey?: string; // обязателен при сохранении, 16–100 символов
  rows: ImportRow[]; // 1–5000, sourcePage + rowNumber уникальны
};
type ImportRow = ParsedRow & {
  categoryId?: number;
  otherAccountId?: number; // перевод вместо категории
  comment: string;
  decision: 'save' | 'skip' | 'keep';
  matchToken?: string;
};
```

Проверка не требует уже выбранных категорий. Для сохранения каждая непропущенная строка должна содержать категорию соответствующего типа либо другой счёт. Направление вычисляется по знаку исходной суммы. Нулевую сумму необходимо пропустить; пакет, где пропущено всё, не сохраняется.

Ответ проверки:

```ts
type ImportCheck = {
  alreadyImported: boolean;
  rows: {
    matches: {transactionId?: number; reason: string}[];
    matchToken: string;
  }[]; // в том же порядке, что rows в запросе
};
```

При наличии совпадений пользователь выбирает `skip` или `keep`. Для `keep` передаётся соответствующий `matchToken`. Сервер в транзакции повторяет проверку: новые совпадения или устаревший токен дают `409`, без записи. Токен связан со счётом, файлом, исходной строкой и набором совпадений.

`POST /imports` возвращает `{id, saved, skipped}`. Уникальность файла — пара `(accountId, fileHash)`; она остаётся после редактирования/удаления импортированных операций. Повтор `requestKey` с тем же полным телом возвращает первоначальный результат, с другим телом — `409`. Сетевой повтор должен использовать **неизменный** JSON и ключ, включая решения и токены. Поиск повтора ключа выполняется до повторной проверки файла и архивного состояния.

## Правила

`GET /rules` возвращает массив в порядке применения; `POST /rules` создаёт правило; `PATCH /rules/{id}` заменяет поля; `DELETE /rules/{id}` удаляет. Поля: `name`, `accountId` (0 — все), `direction` (`expense`/`income`), `condition` (`text`/`day_amount`), `text`, `day`, `amountMinor`, `categoryId`, `otherAccountId`. Результат — ровно одна категория или счёт (невыбранное поле — 0). Ответ содержит также `id`, `available`. `PUT /rules/order` принимает полный список `{ids: number[]}`, устаревший список получает 409.

`POST /parse-statement?accountId=ID` применяет правила после парсинга. Дополнительные поля строк: `categoryId` или `otherAccountId`, `ruleName`. Последнее поле только для UI, не передаётся в API импорта. Без accountId сохраняется прежнее поведение без правил.
