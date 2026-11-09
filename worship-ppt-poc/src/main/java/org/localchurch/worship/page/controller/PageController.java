package org.localchurch.worship.page.controller;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.page.service.PageService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

@RestController
@RequiredArgsConstructor
public class PageController {
    private final PageService pageService;

    @GetMapping(value = "/", produces = "text/html;charset=UTF-8")
    public String home() throws IOException {
        return pageService.home();
    }

    @GetMapping(value = "/logo.png", produces = MediaType.IMAGE_PNG_VALUE)
    public byte[] logo() throws IOException {
        return pageService.logo();
    }

    @GetMapping(value = "/local-token.js", produces = "text/javascript;charset=UTF-8")
    public ResponseEntity<String> localToken() {
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .contentType(MediaType.parseMediaType("text/javascript;charset=UTF-8"))
                .body(pageService.tokenScript());
    }
}
