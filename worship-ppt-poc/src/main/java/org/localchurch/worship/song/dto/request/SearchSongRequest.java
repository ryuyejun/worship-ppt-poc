package org.localchurch.worship.song.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SearchSongRequest(
        @NotBlank(message = "제목을 입력하세요.") @Size(max = 255) String title,
        @Size(max = 255) String author) {}
