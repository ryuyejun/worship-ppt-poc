package org.localchurch.worship.page.service;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.global.config.localaccess.LocalAccessToken;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Service
@RequiredArgsConstructor
public class PageService {
    private final LocalAccessToken token;

    public String home() throws IOException {
        try (java.io.InputStream input = new ClassPathResource("static/index.html").getInputStream()) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    public String tokenScript() {
        return "window.LOCAL_ACCESS_TOKEN='" + token.value() + "';";
    }

    public byte[] logo() throws IOException {
        try (java.io.InputStream input = new ClassPathResource("logo.png").getInputStream()) {
            return input.readAllBytes();
        }
    }
}
