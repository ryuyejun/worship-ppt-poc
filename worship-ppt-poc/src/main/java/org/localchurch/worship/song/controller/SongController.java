package org.localchurch.worship.song.controller;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.global.response.ApiResponse;
import org.localchurch.worship.song.SongRequests;
import org.localchurch.worship.song.dto.request.CompleteRequest;
import org.localchurch.worship.song.dto.request.QueueSearchRequest;
import org.localchurch.worship.song.dto.request.SearchSongRequest;
import org.localchurch.worship.song.dto.response.SongListResponse;
import org.localchurch.worship.song.dto.response.SongResponse;
import org.localchurch.worship.song.dto.response.SongSearchResult;
import org.localchurch.worship.song.service.SongService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.util.List;

@RestController
@RequiredArgsConstructor
public class SongController {
    private final SongService service;

    @PostMapping("/search")
    public ResponseEntity<ApiResponse<List<SongResponse>>> search(
            @Valid @RequestBody SearchSongRequest input) throws SQLException {
        SongSearchResult result = service.search(input.title(), input.author());
        ResponseEntity.BodyBuilder response = ResponseEntity.ok();
        if (result.requestCount() != null) {
            response.header("X-Request-Count", result.requestCount().toString());
        }
        return response.body(ApiResponse.success(result.songs()));
    }

    @PostMapping("/songs")
    public ApiResponse<List<SongListResponse>> songs() throws SQLException {
        return ApiResponse.success(service.all());
    }

    @PostMapping("/ppt-songs")
    public ApiResponse<List<SongListResponse>> pptSongs() throws SQLException {
        return ApiResponse.success(service.pptReady());
    }

    @PostMapping("/requests")
    public ApiResponse<List<SongRequests.Request>> requests(
            @Valid @RequestBody QueueSearchRequest input) throws SQLException {
        return ApiResponse.success(service.pending(input.query()));
    }

    @PostMapping("/requests/complete")
    public ApiResponse<String> complete(@Valid @RequestBody CompleteRequest input)
            throws SQLException {
        service.complete(input.id(), input.songId());
        return ApiResponse.success("연결하고 완료했습니다.");
    }
}
