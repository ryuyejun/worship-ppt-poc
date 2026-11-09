package org.localchurch.worship.song.repository;

/** 목록 화면에 필요한 필드만 조회한다. */
public interface SongListProjection {
    Long getId();

    String getTitle();

    String getLyricist();

    String getComposer();

    String getArtist();

    String getStatus();

    String getCategory();

    Integer getHymnNumber();
}
