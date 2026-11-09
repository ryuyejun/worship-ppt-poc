package org.localchurch.worship.ppt.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record PptPreviewRequest(
        @NotNull @Valid PptBatchRequest presentation,
        @Min(0) int slideIndex) {}
