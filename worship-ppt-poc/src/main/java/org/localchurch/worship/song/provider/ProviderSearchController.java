package org.localchurch.worship.song.provider;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.localchurch.worship.global.response.ApiResponse;
import org.localchurch.worship.song.dto.request.SearchSongRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ProviderSearchController {
    private final ProviderSearchService service;
    @PostMapping("/providers/search")
    public ApiResponse<ProviderSearchService.SearchResult> search(@Valid @RequestBody SearchSongRequest input) {
        return ApiResponse.success(service.search(input.title()));
    }
}
