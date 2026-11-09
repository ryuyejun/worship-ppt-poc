package org.localchurch.worship.ppt.dto.request;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record SongIdRequest(@NotNull @Positive Long id) {}
