package org.localchurch.worship.song.artwork.dto.response;

public record SongArtworkResponse(
        boolean available,
        long songId,
        String imageUrl,
        String sourceUrl,
        String contributor) {
    public static SongArtworkResponse unavailable(long songId) {
        return new SongArtworkResponse(false, songId, null, null, null);
    }
}
