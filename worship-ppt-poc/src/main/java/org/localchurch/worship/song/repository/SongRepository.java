package org.localchurch.worship.song.repository;

import org.localchurch.worship.song.entity.Song;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SongRepository extends JpaRepository<Song, Long> {
    @org.springframework.data.jpa.repository.Query(
            "select s from Song s where s.normalizedTitle=:title or s.id in (select a.songId from"
                + " SongAlias a where a.normalizedAlias=:title) or (:number is not null and"
                + " s.category='HYMN' and s.hymnNumber=:number) order by s.id")
    List<Song> search(
            @org.springframework.data.repository.query.Param("title") String title,
            @org.springframework.data.repository.query.Param("number") Integer number);

    @org.springframework.data.jpa.repository.Query(
            "select s from Song s where s.lyrics is not null and length(trim(s.lyrics))>0 and"
                + " (s.normalizedTitle=:title or s.id in (select a.songId from SongAlias a where"
                + " a.normalizedAlias=:title) or (:number is not null and s.category='HYMN' and"
                + " s.hymnNumber=:number)) order by s.id")
    List<Song> searchWithLyrics(
            @org.springframework.data.repository.query.Param("title") String title,
            @org.springframework.data.repository.query.Param("number") Integer number);

    @org.springframework.data.jpa.repository.Lock(
            jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select s from Song s where s.id=:id")
    java.util.Optional<Song> lockById(
            @org.springframework.data.repository.query.Param("id") Long id);

    boolean existsBySourceAndVersion(String source, String version);

    long countByNormalizedTitle(String title);

    List<SongListProjection> findAllByOrderByTitleAscIdAsc();

    @org.springframework.data.jpa.repository.Query(
            "select s.id as id, s.title as title, s.lyricist as lyricist, s.composer as composer,"
                + " s.artist as artist, s.status as status, s.category as category,"
                + " s.hymnNumber as hymnNumber from Song s where s.lyrics is not null and"
                + " length(trim(s.lyrics))>0 order by s.title asc, s.id asc")
    List<SongListProjection> findPptReadySongs();
}
