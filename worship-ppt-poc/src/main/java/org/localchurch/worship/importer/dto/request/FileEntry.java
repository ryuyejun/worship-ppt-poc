package org.localchurch.worship.importer.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record FileEntry(@NotBlank String name, @NotNull String data) {}
