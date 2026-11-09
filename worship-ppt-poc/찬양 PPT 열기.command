#!/bin/bash
cd "$(dirname "$0")" || exit 1
JAVA_BIN="$(/usr/libexec/java_home -v 21 2>/dev/null)/bin/java"
if [ ! -x "$JAVA_BIN" ]; then osascript -e 'display alert "Java 21을 찾을 수 없습니다."'; exit 1; fi
if [ ! -d build/local-web/lib ]; then osascript -e 'display alert "실행 파일을 찾을 수 없습니다."'; exit 1; fi
"$JAVA_BIN" -cp 'build/local-web/lib/*' LocalWeb "$PWD/local-songs.sqlite3" --open
