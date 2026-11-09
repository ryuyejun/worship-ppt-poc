package org.localchurch.worship.ppt.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PptStyleRequest(
        @NotBlank @Pattern(regexp = "#[0-9a-fA-F]{6}") String backgroundColor,
        @NotBlank @Pattern(regexp = "#[0-9a-fA-F]{6}") String textColor,
        @NotBlank @Size(max = 80) String fontFamily,
        @Min(16) @Max(100) int fontSize,
        @NotBlank @Pattern(regexp = "LEFT|CENTER|RIGHT") String alignment,
        @Min(1) @Max(6) int linesPerSlide,
        boolean bold,
        @Size(max = 6666668) String backgroundImageBase64,
        @Pattern(regexp = "PNG|JPEG") String backgroundImageType) {}
