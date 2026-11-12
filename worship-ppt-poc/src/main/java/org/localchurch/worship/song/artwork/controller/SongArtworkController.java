package org.localchurch.worship.song.artwork.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.localchurch.worship.global.response.ApiResponse;
import org.localchurch.worship.song.artwork.dto.request.SongArtworkSearchRequest;
import org.localchurch.worship.song.artwork.dto.response.SongArtworkResponse;
import org.localchurch.worship.song.artwork.service.PixabayArtworkService;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

@RestController
@RequiredArgsConstructor
public class SongArtworkController {
    private final PixabayArtworkService service;

    @PostMapping("/song-artwork/search")
    public ApiResponse<SongArtworkResponse> search(@Valid @RequestBody SongArtworkSearchRequest request) {
        return ApiResponse.success(service.findForSong(request.songId(), request.title()));
    }

    @GetMapping("/song-artwork/image/{songId}")
    public ResponseEntity<byte[]> image(@PathVariable long songId) {
        return service.readImage(songId)
                .map(image -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(image.contentType()))
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePrivate())
                        .body(image.bytes()))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
