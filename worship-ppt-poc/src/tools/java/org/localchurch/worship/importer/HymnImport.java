package org.localchurch.worship.importer;

import org.localchurch.worship.database.MySqlStore;
import org.localchurch.worship.song.repository.SongStore;

import java.nio.file.*;
import java.sql.*;

/** 제공된 SQLite에서 메타데이터만 가져온다. 원본 가사 복제는 하지 않는다. */
public class HymnImport {
    static void run(Connection target, Path file) throws Exception {
        if (!Files.isRegularFile(file)) throw new IllegalArgumentException("SQLite 파일이 없습니다");
        try (Connection source =
                        DriverManager.getConnection(
                                "jdbc:sqlite:file:" + file.toAbsolutePath() + "?mode=ro");
                Statement read = source.createStatement();
                ResultSet rows =
                        read.executeQuery(
                                "SELECT hymnbook,number,title,category FROM hymns ORDER BY"
                                    + " hymnbook,number")) {
            int added = 0, skipped = 0;
            target.setAutoCommit(false);
            try (PreparedStatement insert =
                            target.prepareStatement(
                                    "INSERT INTO"
                                        + " songs(title,normalized_title,lyricist,composer,artist,lyrics,source_url,version,lyrics_status,copyright_info,category,hymn_number)"
                                        + " VALUES(?,?,"
                                        + " '미확인','미확인','미확인',NULL,?,?,'PENDING',?,'HYMN',?) ON"
                                        + " DUPLICATE KEY UPDATE id=id");
                    PreparedStatement conflict =
                            target.prepareStatement(
                                    "SELECT COUNT(*) FROM songs WHERE normalized_title=? AND"
                                        + " category<>'HYMN'")) {
                while (rows.next()) {
                    String book = rows.getString(1), title = rows.getString(3);
                    int number = rows.getInt(2);
                    if (book == null
                            || book.isBlank()
                            || number <= 0
                            || title == null
                            || title.isBlank()) throw new IllegalArgumentException("잘못된 찬송가 정보");
                    conflict.setString(1, SongStore.normalize(title));
                    try (ResultSet found = conflict.executeQuery()) {
                        found.next();
                        if (found.getInt(1) > 0) {
                            System.out.printf("동명 기존곡 검토 필요: %s %d %s%n", book, number, title);
                            skipped++;
                            continue;
                        }
                    }
                    insert.setString(1, title);
                    insert.setString(2, SongStore.normalize(title));
                    insert.setString(3, "local:bible.db:hymn:" + book);
                    insert.setString(4, Integer.toString(number));
                    insert.setString(
                            5,
                            "사용자 제공 bible.db; 가사 저장 및 예배 PPT 이용 권한 미확인; 원본 분류: "
                                    + rows.getString(4));
                    insert.setInt(6, number);
                    if (insert.executeUpdate() == 1) added++;
                    else skipped++;
                }
                target.commit();
                System.out.printf("신규=%d 중복=%d 가사복제=0%n", added, skipped);
            } catch (Exception e) {
                target.rollback();
                throw e;
            } finally {
                target.setAutoCommit(true);
            }
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2)
            throw new IllegalArgumentException("HymnImport mysql.properties bible.db");
        try (Connection c = MySqlStore.open(Path.of(args[0]))) {
            run(c, Path.of(args[1]));
        }
    }
}
