package org.localchurch.worship.ppt.controller;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.ppt.dto.request.PptBatchRequest;
import org.localchurch.worship.ppt.dto.request.SongIdRequest;
import org.localchurch.worship.ppt.dto.request.PptPreviewRequest;
import org.localchurch.worship.ppt.dto.response.PptPreviewResponse;
import org.localchurch.worship.global.response.ApiResponse;
import org.localchurch.worship.ppt.service.PptService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class PptController {
    private final PptService service;

    @PostMapping("/ppt")
    public ResponseEntity<byte[]> single(@Valid @RequestBody SongIdRequest input) throws Exception {
        return download(service.single(input.id()));
    }

    @PostMapping("/ppt/batch")
    public ResponseEntity<byte[]> batch(@Valid @RequestBody PptBatchRequest input)
            throws Exception {
        return download(service.create(input.songIds(), input.pptxBase64(), input.style()));
    }

    @PostMapping("/ppt/preview")
    public ApiResponse<PptPreviewResponse> preview(@Valid @RequestBody PptPreviewRequest input)
            throws Exception {
        return ApiResponse.success(service.preview(input.presentation(), input.slideIndex()));
    }

    private ResponseEntity<byte[]> download(byte[] bytes) {
        return ResponseEntity.ok()
                .contentType(
                        MediaType.parseMediaType(
                                "application/vnd.openxmlformats-officedocument.presentationml.presentation"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"worship.pptx\"")
                .body(bytes);
    }
}
