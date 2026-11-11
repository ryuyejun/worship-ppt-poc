package org.localchurch.worship.ppt.dto.request;

import jakarta.validation.constraints.*;

public record ExternalPptSong(
        @Negative long id,
        @NotBlank @Size(max = 300) String title,
        @Size(max = 300) String artist,
        @NotBlank @Size(max = 30000) String lyrics) {}
