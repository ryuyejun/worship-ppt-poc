package org.localchurch.worship.ppt.dto.request;

import jakarta.validation.constraints.*;
import jakarta.validation.Valid;

import java.util.List;

public record PptBatchRequest(
        @NotEmpty(message = "곡을 선택하세요.") @Size(max = 100) List<@NotNull @Positive Long> songIds,
        @Size(max = 26666668) String pptxBase64,
        @Valid PptStyleRequest style) {}
