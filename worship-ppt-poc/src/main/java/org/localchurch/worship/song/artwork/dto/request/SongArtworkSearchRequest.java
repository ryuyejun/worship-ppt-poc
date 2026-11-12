package org.localchurch.worship.song.artwork.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record SongArtworkSearchRequest(
        @Positive long songId,
        @NotBlank @Size(max = 255) String title) {}
