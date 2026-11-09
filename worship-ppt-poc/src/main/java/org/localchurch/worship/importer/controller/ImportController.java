package org.localchurch.worship.importer.controller;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.global.response.ApiResponse;
import org.localchurch.worship.importer.BatchImport;
import org.localchurch.worship.importer.dto.request.LyricsImportRequest;
import org.localchurch.worship.importer.dto.response.LyricsImportResponse;
import org.localchurch.worship.importer.service.LyricsImportService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
public class ImportController {
    private final LyricsImportService service;

    @PostMapping("/batch-import")
    public ApiResponse<LyricsImportResponse> batch(@Valid @RequestBody LyricsImportRequest input)
            throws Exception {
        List<LyricsImportService.InputFile> files =
                input.files().stream()
                        .map(file -> new LyricsImportService.InputFile(file.name(), file.data()))
                        .toList();
        BatchImport.ImportResult result = service.importFiles(files);
        return ApiResponse.success(new LyricsImportResponse(result.saved(), result.skipped()));
    }
}
