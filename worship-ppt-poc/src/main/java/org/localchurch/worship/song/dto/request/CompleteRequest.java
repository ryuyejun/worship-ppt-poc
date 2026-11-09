package org.localchurch.worship.song.dto.request;

import jakarta.validation.constraints.*;

public record CompleteRequest(@NotNull @Positive Long id, @NotNull @Positive Long songId) {}
