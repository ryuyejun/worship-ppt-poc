package org.localchurch.worship.importer.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record LyricsImportRequest(
        @NotEmpty @Size(max = 50) List<@NotNull @Valid FileEntry> files) {}
