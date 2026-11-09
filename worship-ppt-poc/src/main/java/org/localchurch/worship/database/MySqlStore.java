package org.localchurch.worship.database;

import java.io.InputStream;
import java.nio.file.*;
import java.sql.*;
import java.util.Properties;

/** 기존 JDBC 기능을 위해 설정 파일로 MySQL을 연결하고 필요한 스키마를 확인한다. */
public final class MySqlStore {
    public static boolean mysql(Connection c) throws SQLException {
        return c.getMetaData().getDatabaseProductName().equalsIgnoreCase("MySQL");
    }

    public static Connection open(Path config) throws Exception {
        Properties p = new Properties();
        try (InputStream in = Files.newInputStream(config)) {
            p.load(in);
        }
        String url = p.getProperty("url"),
                user = p.getProperty("user"),
                password = p.getProperty("password");
        if (url == null || user == null || password == null)
            throw new IllegalArgumentException("MySQL 접속 설정이 없습니다.");
        Properties options = new Properties();
        options.setProperty("user", user);
        options.setProperty("password", password);
        options.setProperty("useAffectedRows", "true");
        return DriverManager.getConnection(url, options);
    }

    public static void init(Connection c) throws SQLException {
        try (Statement s = c.createStatement()) {
            s.execute(
                    """
                    CREATE TABLE IF NOT EXISTS songs (
                        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        title VARCHAR(255) NOT NULL,normalized_title VARCHAR(255) NOT NULL,
                        lyricist VARCHAR(255) NOT NULL,composer VARCHAR(255) NOT NULL,artist VARCHAR(255) NOT NULL,
                        lyrics MEDIUMTEXT,source_url VARCHAR(512) NOT NULL,version VARCHAR(200) NOT NULL,
                        lyrics_status VARCHAR(32) NOT NULL,copyright_info TEXT NOT NULL,
                        permission_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',permission_evidence TEXT,
                        UNIQUE KEY unique_song_source (source_url,version),KEY idx_songs_title(normalized_title),
                        CHECK(lyrics_status IN ('PENDING','USER_SUPPLIED')),
                        CHECK(permission_status IN ('UNKNOWN','VERIFIED')),
                        CHECK((lyrics_status='PENDING' AND lyrics IS NULL) OR (lyrics_status='USER_SUPPLIED' AND lyrics IS NOT NULL))
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs
                    """);
            s.execute(
                    """
                    CREATE TABLE IF NOT EXISTS song_aliases (
                      song_id BIGINT NOT NULL,alias VARCHAR(255) NOT NULL,normalized_alias VARCHAR(255) NOT NULL,
                      UNIQUE KEY unique_alias(song_id,normalized_alias),KEY idx_song_aliases(normalized_alias),
                      FOREIGN KEY(song_id) REFERENCES songs(id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs
                    """);
            s.execute(
                    """
                    CREATE TABLE IF NOT EXISTS song_requests (
                      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,title VARCHAR(255) NOT NULL,
                      normalized_title VARCHAR(255) NOT NULL,lyricist VARCHAR(255),normalized_lyricist VARCHAR(255) NOT NULL DEFAULT '',
                      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',request_count INT NOT NULL DEFAULT 1,
                      created_at VARCHAR(40) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')),
                      updated_at VARCHAR(40) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')),
                      song_id BIGINT,UNIQUE KEY request_unique(normalized_title,normalized_lyricist),
                      FOREIGN KEY(song_id) REFERENCES songs(id),CHECK(status IN ('PENDING','COMPLETED')),
                      CHECK(request_count>0), CHECK((status='PENDING' AND song_id IS NULL) OR (status='COMPLETED' AND song_id IS NOT NULL))
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs
                    """);
        }
        try (ResultSet columns =
                c.getMetaData().getColumns(c.getCatalog(), null, "songs", "category")) {
            if (!columns.next())
                try (Statement s = c.createStatement()) {
                    s.execute(
                            "ALTER TABLE songs ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT"
                                + " 'UNKNOWN'");
                }
        }
        try (ResultSet columns =
                c.getMetaData().getColumns(c.getCatalog(), null, "songs", "hymn_number")) {
            if (!columns.next())
                try (Statement s = c.createStatement()) {
                    s.execute("ALTER TABLE songs ADD COLUMN hymn_number INT NULL");
                }
        }
    }
}
