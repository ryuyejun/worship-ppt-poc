package org.localchurch.worship.song;

import org.localchurch.worship.database.MySqlStore;
import org.localchurch.worship.song.entity.Song;
import org.localchurch.worship.song.repository.SongStore;

import java.sql.*;
import java.util.*;

/** 메인 곡 검색과 같은 연결을 사용하는 영속 요청 대기열. */
public final class SongRequests {
    public record Request(
            long id,
            String title,
            String lyricist,
            String status,
            int count,
            String createdAt,
            String updatedAt,
            Long songId) {}

    public record SearchResult(List<Song> songs, Request request) {}

    public static void init(Connection c) throws SQLException {
        try (Statement s = c.createStatement()) {
            s.execute(
                    """
                    CREATE TABLE IF NOT EXISTS song_requests (
                      id INTEGER PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
                      lyricist TEXT, normalized_lyricist TEXT NOT NULL DEFAULT '',
                      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED')),
                      request_count INTEGER NOT NULL DEFAULT 1 CHECK(request_count > 0),
                      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                      song_id INTEGER REFERENCES songs(id), UNIQUE(normalized_title,normalized_lyricist),
                      CHECK((status='PENDING' AND song_id IS NULL) OR (status='COMPLETED' AND song_id IS NOT NULL))
                    )
                    """);
        }
    }

    public static Request row(ResultSet r) throws SQLException {
        long song = r.getLong("song_id");
        Long songId = r.wasNull() ? null : song;
        return new Request(
                r.getLong("id"),
                r.getString("title"),
                r.getString("lyricist"),
                r.getString("status"),
                r.getInt("request_count"),
                r.getString("created_at"),
                r.getString("updated_at"),
                songId);
    }

    public static SearchResult searchOrRequest(Connection c, String title, String author)
            throws SQLException {
        String key = SongStore.normalize(title);
        if (key.isEmpty()) throw new IllegalArgumentException("제목을 입력하세요.");
        String authorKey = author == null ? "" : SongStore.normalize(author);
        boolean auto = c.getAutoCommit();
        if (!auto) throw new IllegalStateException("독립 트랜잭션이 필요합니다.");
        try {
            c.setAutoCommit(false);
            List<Song> songs = SongStore.search(c, title, authorKey.isEmpty() ? null : author);
            if (!songs.isEmpty()) {
                c.commit();
                return new SearchResult(songs, null);
            }
            Request request;
            if (MySqlStore.mysql(c)) {
                try (PreparedStatement s =
                        c.prepareStatement(
                                """
                                INSERT INTO song_requests(title,normalized_title,lyricist,normalized_lyricist) VALUES(?,?,?,?)
                                ON DUPLICATE KEY UPDATE request_count=request_count+1,status='PENDING',song_id=NULL,
                                updated_at=DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')
                                """)) {
                    s.setString(1, title.strip());
                    s.setString(2, key);
                    s.setString(3, authorKey.isEmpty() ? null : author.strip());
                    s.setString(4, authorKey);
                    s.executeUpdate();
                }
                try (PreparedStatement s =
                        c.prepareStatement(
                                "SELECT * FROM song_requests WHERE normalized_title=? AND"
                                        + " normalized_lyricist=?")) {
                    s.setString(1, key);
                    s.setString(2, authorKey);
                    try (ResultSet r = s.executeQuery()) {
                        if (!r.next()) throw new SQLException("요청 저장 실패");
                        request = row(r);
                    }
                }
            } else {
                try (PreparedStatement s =
                        c.prepareStatement(
                                """
                                INSERT INTO song_requests(title,normalized_title,lyricist,normalized_lyricist)
                                VALUES(?,?,?,?) ON CONFLICT(normalized_title,normalized_lyricist) DO UPDATE SET
                                  request_count=song_requests.request_count+1,status='PENDING',song_id=NULL,
                                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING *
                                """)) {
                    s.setString(1, title.strip());
                    s.setString(2, key);
                    s.setString(3, authorKey.isEmpty() ? null : author.strip());
                    s.setString(4, authorKey);
                    try (ResultSet r = s.executeQuery()) {
                        if (!r.next()) throw new SQLException("요청 저장 실패");
                        request = row(r);
                    }
                }
            }
            c.commit();
            return new SearchResult(List.of(), request);
        } catch (SQLException | RuntimeException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(auto);
        }
    }

    public static List<Request> pending(Connection c, String query) throws SQLException {
        String key = SongStore.normalize(query == null ? "" : query);
        List<Request> out = new ArrayList<>();
        try (PreparedStatement s =
                        c.prepareStatement(
                                "SELECT * FROM song_requests WHERE status='PENDING' ORDER BY"
                                        + " updated_at DESC,id DESC");
                ResultSet r = s.executeQuery()) {
            while (r.next()) {
                Request q = row(r);
                if (key.isEmpty()
                        || SongStore.normalize(q.title()).contains(key)
                        || (q.lyricist() != null
                                && SongStore.normalize(q.lyricist()).contains(key))) out.add(q);
            }
        }
        return out;
    }

    public static void complete(Connection c, long requestId, long songId) throws SQLException {
        SongStore.byId(c, songId);
        String now =
                MySqlStore.mysql(c)
                        ? "DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')"
                        : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
        try (PreparedStatement s =
                c.prepareStatement(
                        "UPDATE song_requests SET status='COMPLETED',song_id=?,updated_at="
                                + now
                                + " WHERE id=? AND status='PENDING'")) {
            s.setLong(1, songId);
            s.setLong(2, requestId);
            if (s.executeUpdate() != 1) throw new IllegalArgumentException("대기 중인 요청을 찾을 수 없습니다.");
        }
    }

    public static void completeMatching(Connection c, long songId) throws SQLException {
        Song song = SongStore.byId(c, songId);
        String titleKey = SongStore.normalize(song.title());
        String authorKey =
                song.lyricist().equals("미확인") ? "" : SongStore.normalize(song.lyricist());
        long sameTitle;
        try (PreparedStatement s =
                c.prepareStatement("SELECT count(*) FROM songs WHERE normalized_title=?")) {
            s.setString(1, titleKey);
            try (ResultSet r = s.executeQuery()) {
                r.next();
                sameTitle = r.getLong(1);
            }
        }
        String now =
                MySqlStore.mysql(c)
                        ? "DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')"
                        : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
        try (PreparedStatement s =
                c.prepareStatement(
                        "UPDATE song_requests SET status='COMPLETED',song_id=?,updated_at="
                                + now
                                + " WHERE status='PENDING' AND normalized_title=? AND"
                                + " ((normalized_lyricist<>'' AND normalized_lyricist=?) OR"
                                + " (normalized_lyricist='' AND ?=1))")) {
            s.setLong(1, songId);
            s.setString(2, titleKey);
            s.setString(3, authorKey);
            s.setLong(4, sameTitle);
            s.executeUpdate();
        }
    }
}
