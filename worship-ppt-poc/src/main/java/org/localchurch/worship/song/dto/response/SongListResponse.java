package org.localchurch.worship.song.dto.response;

public record SongListResponse(
        long id,
        String title,
        String author,
        String composer,
        String artist,
        String status,
        String category,
        Integer hymnNumber) {}
