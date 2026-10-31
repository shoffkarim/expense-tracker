#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v pdftotext >/dev/null 2>&1; then
  pdf_tool=$(command -v pdftotext)
elif [ -x "$project_dir/.tools/poppler/bin/pdftotext" ]; then
  pdf_tool="$project_dir/.tools/poppler/bin/pdftotext"
else
  echo 'Не найден Poppler. Установите его: brew install poppler' >&2
  exit 1
fi
cd "$project_dir/frontend"
if [ ! -d node_modules ]; then npm ci; fi
npm run build
cd "$project_dir/backend"
exec go run . -pdftotext "$pdf_tool" -frontend "$project_dir/frontend/dist" -db "$project_dir/data/expense-tracker.sqlite"
