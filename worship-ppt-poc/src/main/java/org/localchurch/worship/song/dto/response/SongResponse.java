package org.localchurch.worship.song.dto.response;

public record SongResponse(
        long id,
        String title,
        String author,
        String composer,
        String artist,
        String status,
        String source,
        String category,
        Integer hymnNumber,
        String lyrics) {}
