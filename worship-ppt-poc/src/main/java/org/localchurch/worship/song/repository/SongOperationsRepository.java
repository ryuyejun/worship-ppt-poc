package org.localchurch.worship.song.repository;

import jakarta.persistence.EntityManager;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.song.SongRequests;
import org.localchurch.worship.song.dto.response.*;
import org.localchurch.worship.song.entity.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/** 곡 검색과 대기열 관리를 같은 JPA 트랜잭션에서 처리한다. */
@Repository
@RequiredArgsConstructor
public class SongOperationsRepository {
    private final SongRepository songs;
    private final SongRequestRepository requests;
    private final EntityManager entityManager;

    public List<Song> matches(String title, String author) {
        String key = SongStore.normalize(title);
        if (key.isEmpty()) throw new IllegalArgumentException("제목을 입력하세요.");
        Integer number = key.matches("[0-9]{1,5}") ? Integer.valueOf(key) : null;
        return songs.searchWithLyrics(key, number).stream()
                .filter(
                        song ->
                                author == null
                                        || author.isBlank()
                                        || SongStore.normalize(song.lyricist())
                                                .equals(SongStore.normalize(author)))
                .toList();
    }

    public List<Song> matchesWithOrWithoutLyrics(String title, String author) {
        String key = SongStore.normalize(title);
        if (key.isEmpty()) throw new IllegalArgumentException("제목을 입력하세요.");
        Integer number = key.matches("[0-9]{1,5}") ? Integer.valueOf(key) : null;
        return songs.search(key, number).stream()
                .filter(song -> author == null || author.isBlank()
                        || SongStore.normalize(song.lyricist()).equals(SongStore.normalize(author)))
                .toList();
    }

    @Transactional
    public SongSearchResult search(String title, String author) {
        List<Song> found = matches(title, author);
        List<SongResponse> result =
                found.stream()
                        .map(
                                song ->
                                        new SongResponse(
                                                song.id(),
                                                song.title(),
                                                song.lyricist(),
                                                song.composer(),
                                                song.artist(),
                                                song.status(),
                                                song.source(),
                                                song.category(),
                                                song.hymnNumber(),
                                                song.lyrics()))
                        .toList();
        if (!found.isEmpty()) return new SongSearchResult(result, null);
        String key = SongStore.normalize(title),
                authorKey = SongStore.normalize(author == null ? "" : author);
        boolean mysql =
                entityManager
                                .getEntityManagerFactory()
                                .unwrap(org.hibernate.engine.spi.SessionFactoryImplementor.class)
                                .getJdbcServices()
                                .getDialect()
                        instanceof org.hibernate.dialect.MySQLDialect;
        // 첫 동시 요청도 중복 없이 횟수를 늘리기 위해 원자적 갱신을 사용한다.
        String sql =
                mysql
                        ? "INSERT INTO"
                              + " song_requests(title,normalized_title,lyricist,normalized_lyricist)"
                              + " VALUES(:title,:key,:author,:authorKey) ON DUPLICATE KEY UPDATE"
                              + " request_count=request_count+1,status='PENDING',song_id=NULL,updated_at=DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ')"
                        : "INSERT INTO"
                              + " song_requests(title,normalized_title,lyricist,normalized_lyricist)"
                              + " VALUES(:title,:key,:author,:authorKey) ON"
                              + " CONFLICT(normalized_title,normalized_lyricist) DO UPDATE SET"
                              + " request_count=request_count+1,status='PENDING',song_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')";
        entityManager
                .createNativeQuery(sql)
                .setParameter("title", title.strip())
                .setParameter("key", key)
                .setParameter("author", authorKey.isEmpty() ? null : author.strip())
                .setParameter("authorKey", authorKey)
                .executeUpdate();
        entityManager.clear();
        return new SongSearchResult(
                List.of(),
                requests.findByNormalizedTitleAndNormalizedLyricist(key, authorKey)
                        .orElseThrow()
                        .count());
    }

    @Transactional(readOnly = true)
    public List<SongRequests.Request> pending(String query) {
        String key = SongStore.normalize(query == null ? "" : query);
        return requests.findByStatusOrderByUpdatedAtDescIdDesc("PENDING").stream()
                .filter(
                        request ->
                                SongStore.normalize(request.title()).contains(key)
                                        || SongStore.normalize(
                                                        request.lyricist() == null
                                                                ? ""
                                                                : request.lyricist())
                                                .contains(key))
                .map(SongRequest::response)
                .toList();
    }

    @Transactional
    public void complete(long id, long songId) {
        if (!songs.existsById(songId)) throw new IllegalArgumentException("해당 곡이 없습니다.");
        SongRequest request =
                requests.findById(id)
                        .orElseThrow(() -> new IllegalArgumentException("대기 중인 요청이 없습니다."));
        if (!"PENDING".equals(request.status()))
            throw new IllegalArgumentException("대기 중인 요청이 없습니다.");
        request.complete(songId);
    }
}
