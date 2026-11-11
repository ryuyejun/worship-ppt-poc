package org.localchurch.worship.song.provider;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

@Service
public class ProviderSearchService {
    public record Candidate(String title, String artist, String source) {}
    public record SearchResult(List<Candidate> candidates, List<String> status) {}
    private final Environment environment;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final JsonMapper json = JsonMapper.builder().build();

    public ProviderSearchService(Environment environment) { this.environment = environment; }

    public SearchResult search(String title) {
        List<Candidate> candidates = new ArrayList<>();
        List<String> status = new ArrayList<>();
        String key = environment.getProperty("MUSIXMATCH_API_KEY", "");
        if (key.isBlank()) status.add("Musixmatch: API 키 미설정");
        else {
            try {
                URI uri = URI.create("https://api.musixmatch.com/ws/1.1/track.search?q_track=" + encode(title) + "&page_size=10&apikey=" + encode(key));
                JsonNode root = get(uri, null);
                int code = root.path("message").path("header").path("status_code").asInt();
                if (code != 200) throw new IllegalStateException("provider error");
                for (JsonNode item : root.path("message").path("body").path("track_list")) {
                    JsonNode track = item.path("track");
                    candidates.add(new Candidate(track.path("track_name").asText(""), track.path("artist_name").asText(""), "Musixmatch"));
                }
                status.add("Musixmatch: 곡 정보 조회 완료 · 가사 전문 미연결");
            } catch (Exception e) { status.add("Musixmatch: 조회 실패"); }
        }
        String client = environment.getProperty("SPOTIFY_CLIENT_ID", "");
        String secret = environment.getProperty("SPOTIFY_CLIENT_SECRET", "");
        if (client.isBlank() || secret.isBlank()) status.add("Spotify: 인증 정보 미설정");
        else {
            try {
                String basic = Base64.getEncoder().encodeToString((client + ":" + secret).getBytes(StandardCharsets.UTF_8));
                HttpRequest auth = HttpRequest.newBuilder(URI.create("https://accounts.spotify.com/api/token"))
                        .timeout(Duration.ofSeconds(6)).header("Authorization", "Basic " + basic)
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials")).build();
                HttpResponse<String> response = http.send(auth, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) throw new IllegalStateException("auth failed");
                String token = json.readTree(response.body()).path("access_token").asText("");
                if (token.isBlank()) throw new IllegalStateException("token missing");
                JsonNode root = get(URI.create("https://api.spotify.com/v1/search?type=track&limit=10&q=" + encode(title)), "Bearer " + token);
                for (JsonNode item : root.path("tracks").path("items")) {
                    candidates.add(new Candidate(item.path("name").asText(""), item.path("artists").path(0).path("name").asText(""), "Spotify"));
                }
                status.add("Spotify: 곡 정보 조회 완료 · 가사 미제공");
            } catch (Exception e) { status.add("Spotify: 조회 실패"); }
        }
        return new SearchResult(candidates, status);
    }
    private JsonNode get(URI uri, String authorization) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(6)).GET();
        if (authorization != null) builder.header("Authorization", authorization);
        HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("provider error");
        return json.readTree(response.body());
    }
    private static String encode(String text) { return URLEncoder.encode(text, StandardCharsets.UTF_8); }
}
