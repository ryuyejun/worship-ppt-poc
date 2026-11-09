#!/bin/bash
set -eu
cd "$(dirname "$0")"
ROOT="$PWD"
ADMIN="$ROOT/.server/mysql-admin.cnf"
MYSQL_BIN=/opt/homebrew/opt/mysql/bin
if [ ! -f "$ADMIN" ] || [ ! -d "$ROOT/.server/mysql-data" ]; then echo 'MySQL 데이터 또는 설정 파일을 찾을 수 없습니다.' >&2; exit 1; fi
if "$MYSQL_BIN/mysqladmin" --defaults-extra-file="$ADMIN" ping --silent >/dev/null 2>&1; then exit 0; fi
nohup "$MYSQL_BIN/mysqld" --no-defaults --basedir=/opt/homebrew/opt/mysql --datadir="$ROOT/.server/mysql-data" --socket="$ROOT/.server/mysql.sock" --pid-file="$ROOT/.server/mysql.pid" --port=13306 --bind-address=127.0.0.1 --mysqlx=0 --log-error="$ROOT/.server/mysql.log" </dev/null >>"$ROOT/.server/mysql-start.log" 2>&1 &
for i in {1..30}; do
  if "$MYSQL_BIN/mysqladmin" --defaults-extra-file="$ADMIN" ping --silent >/dev/null 2>&1; then exit 0; fi
  sleep 1
done
echo 'MySQL 서버가 시작되지 않았습니다. .server/mysql.log를 확인하세요.' >&2
exit 1
