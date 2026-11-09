package org.localchurch.worship.song.dto.request;

import jakarta.validation.constraints.Size;

public record QueueSearchRequest(@Size(max = 255) String query) {}
