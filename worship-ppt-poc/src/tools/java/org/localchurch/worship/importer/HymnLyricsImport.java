package org.localchurch.worship.importer;

import org.localchurch.worship.database.MySqlStore;

import java.nio.file.*;
import java.sql.*;
import java.text.Normalizer;
import java.util.*;

/** 사용자 제공 찬송가만 동일 판·번호·제목에 연결하고, 기존 가사는 보존한다. */
public class HymnLyricsImport {
    static String exact(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFC);
    }

    static void run(Connection c, Path file) throws Exception {
        if (!Files.isRegularFile(file)) throw new IllegalArgumentException("원본 DB가 없습니다");
        int updated = 0, already = 0, unmatched = 0, mismatch = 0, empty = 0;
        try (Connection src =
                        DriverManager.getConnection(
                                "jdbc:sqlite:file:" + file.toAbsolutePath() + "?mode=ro");
                Statement query = src.createStatement();
                ResultSet rows =
                        query.executeQuery(
                                "SELECT hymnbook,number,title,lyrics FROM hymns ORDER BY"
                                    + " hymnbook,number");
                PreparedStatement lookup =
                        c.prepareStatement(
                                "SELECT id,title,lyrics FROM songs WHERE source_url=? AND version=?"
                                    + " AND category='HYMN' AND hymn_number=? FOR UPDATE");
                PreparedStatement save =
                        c.prepareStatement(
                                "UPDATE songs SET"
                                    + " lyrics=?,lyrics_status='USER_SUPPLIED',copyright_info=?,permission_status='UNKNOWN',permission_evidence=?"
                                    + " WHERE id=? AND lyrics IS NULL")) {
            c.setAutoCommit(false);
            try {
                while (rows.next()) {
                    String book = rows.getString(1),
                            title = rows.getString(3),
                            lyrics = rows.getString(4);
                    int number = rows.getInt(2);
                    if (lyrics == null || lyrics.isBlank()) {
                        empty++;
                        continue;
                    }
                    lookup.setString(1, "local:bible.db:hymn:" + book);
                    lookup.setString(2, Integer.toString(number));
                    lookup.setInt(3, number);
                    try (ResultSet found = lookup.executeQuery()) {
                        if (!found.next()) {
                            unmatched++;
                            System.out.printf("미연결: %s %d %s%n", book, number, title);
                            continue;
                        }
                        long id = found.getLong(1);
                        String savedTitle = found.getString(2), previous = found.getString(3);
                        if (!exact(title).equals(exact(savedTitle))) {
                            mismatch++;
                            System.out.printf("제목 불일치: %s %d%n", book, number);
                            continue;
                        }
                        if (previous != null) {
                            already++;
                            continue;
                        }
                        save.setString(1, lyrics);
                        save.setString(
                                2, "사용자 제공 bible.db; 사용자가 구매 및 허락을 받았다고 설명함. 허가 문서·범위 별도 보관 필요");
                        save.setString(3, "2026-11-06 사용자 진술: bible.db 가사에 대한 허락 및 비용 지불");
                        save.setLong(4, id);
                        if (save.executeUpdate() != 1)
                            throw new SQLException("동시 변경으로 중단: " + number);
                        updated++;
                    }
                }
                c.commit();
                System.out.printf(
                        "가사 신규=%d 기존 보존=%d 미연결=%d 제목 불일치=%d 빈 가사=%d%n",
                        updated, already, unmatched, mismatch, empty);
            } catch (Exception e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(true);
            }
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("설정파일과 SQLite 경로가 필요합니다");
        try (Connection c = MySqlStore.open(Path.of(args[0]))) {
            run(c, Path.of(args[1]));
        }
    }
}
