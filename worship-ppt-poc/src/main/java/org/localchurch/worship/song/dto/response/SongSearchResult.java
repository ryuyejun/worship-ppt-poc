package org.localchurch.worship.song.dto.response;

import java.util.List;

public record SongSearchResult(List<SongResponse> songs, Integer requestCount) {}
