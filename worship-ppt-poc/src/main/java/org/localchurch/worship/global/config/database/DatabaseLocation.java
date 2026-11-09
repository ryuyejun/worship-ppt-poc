package org.localchurch.worship.global.config.database;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

/** 서버 실행 환경에서 사용하는 로컬 DB 경로. MySQL 설정이 있으면 기존 접속 설정을 우선한다. */
@Component
public final class DatabaseLocation {
    private final Path path;

    public DatabaseLocation(@Value("${worship.sqlite.path:local-songs.sqlite3}") String path) {
        this.path = Path.of(path).toAbsolutePath();
    }

    public Path path() {
        return path;
    }
}
