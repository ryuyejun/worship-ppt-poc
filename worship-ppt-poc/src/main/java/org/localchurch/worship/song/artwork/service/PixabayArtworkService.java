package org.localchurch.worship.song.artwork.service;

import org.localchurch.worship.song.artwork.dto.response.SongArtworkResponse;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

@Service
public class PixabayArtworkService {
    private static final System.Logger LOGGER = System.getLogger(PixabayArtworkService.class.getName());
    private static final Duration SEARCH_CACHE_DURATION = Duration.ofHours(24);
    private static final int MAX_IMAGE_BYTES = 5_000_000;

    private final Environment environment;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final Path artworkDirectory;

    public PixabayArtworkService(Environment environment) {
        this.environment = environment;
        this.artworkDirectory = Path.of(environment.getProperty(
                "YEBIT_ARTWORK_DIRECTORY",
                Path.of(System.getProperty("user.home"), ".yebit", "artwork").toString())).toAbsolutePath().normalize();
    }

    public SongArtworkResponse findForSong(long songId, String title) {
        if (songId < 1) return SongArtworkResponse.unavailable(songId);
        Optional<StoredArtwork> existingArtwork = readStoredArtwork(songId);
        if (existingArtwork.isPresent()) return toResponse(existingArtwork.get());

        String apiKey = environment.getProperty("PIXABAY_API_KEY", "").trim();
        if (apiKey.isEmpty()) return SongArtworkResponse.unavailable(songId);

        try {
            List<PixabayHit> hits = search(title, apiKey);
            if (hits.isEmpty()) return SongArtworkResponse.unavailable(songId);
            return downloadAndStore(songId, hits.getFirst());
        } catch (Exception exception) {
            LOGGER.log(System.Logger.Level.WARNING, "Pixabay artwork lookup failed for song id {0}", songId);
            return SongArtworkResponse.unavailable(songId);
        }
    }

    public Optional<StoredImage> readImage(long songId) {
        if (songId < 1) return Optional.empty();
        return readStoredArtwork(songId).flatMap(artwork -> {
            Path imagePath = imagePath(songId, artwork.extension());
            try {
                return Files.isRegularFile(imagePath)
                        ? Optional.of(new StoredImage(Files.readAllBytes(imagePath), artwork.contentType()))
                        : Optional.empty();
            } catch (IOException exception) {
                LOGGER.log(System.Logger.Level.WARNING, "Unable to read stored artwork for song id {0}", songId);
                return Optional.empty();
            }
        });
    }

    private List<PixabayHit> search(String title, String apiKey) throws Exception {
        String normalizedTitle = Normalizer.normalize(title.trim(), Normalizer.Form.NFC);
        Path cachePath = cachePath(normalizedTitle);
        Optional<CachedSearch> cachedSearch = readCachedSearch(cachePath);
        if (cachedSearch.isPresent()) return cachedSearch.get().hits();

        URI requestUri = URI.create("https://pixabay.com/api/?key=" + encode(apiKey)
                + "&q=" + encode(normalizedTitle)
                + "&lang=ko&image_type=photo&orientation=horizontal&safesearch=true&category=music&order=popular&per_page=5");
        HttpRequest request = HttpRequest.newBuilder(requestUri).timeout(Duration.ofSeconds(8)).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200) throw new IOException("Pixabay returned HTTP " + response.statusCode());

        JsonNode root = jsonMapper.readTree(response.body());
        List<PixabayHit> hits = new java.util.ArrayList<>();
        for (JsonNode hit : root.path("hits")) {
            String webformatURL = hit.path("webformatURL").asText("");
            if (!webformatURL.isBlank()) {
                hits.add(new PixabayHit(hit.path("id").asInt(), hit.path("pageURL").asText(""), webformatURL, hit.path("user").asText("")));
            }
        }
        CachedSearch result = new CachedSearch(System.currentTimeMillis(), hits);
        Files.createDirectories(cachePath.getParent());
        Files.writeString(cachePath, jsonMapper.writeValueAsString(result), StandardCharsets.UTF_8);
        return hits;
    }

    private SongArtworkResponse downloadAndStore(long songId, PixabayHit hit) throws Exception {
        URI imageUri = URI.create(hit.webformatURL());
        String host = imageUri.getHost();
        if (!"pixabay.com".equals(host) && (host == null || !host.endsWith(".pixabay.com"))) {
            throw new IOException("Unexpected image host");
        }

        HttpRequest request = HttpRequest.newBuilder(imageUri).timeout(Duration.ofSeconds(10)).GET().build();
        HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream imageStream = response.body()) {
            if (response.statusCode() != 200) throw new IOException("Pixabay image download failed");
            String contentType = response.headers().firstValue("Content-Type").orElse("").split(";")[0].trim().toLowerCase();
            String extension = extensionFor(contentType);
            byte[] image = imageStream.readNBytes(MAX_IMAGE_BYTES + 1);
            if (image.length == 0 || image.length > MAX_IMAGE_BYTES) throw new IOException("Image size is invalid");

            Files.createDirectories(artworkDirectory);
            Path target = imagePath(songId, extension);
            Path temporary = artworkDirectory.resolve(songId + ".part");
            Files.write(temporary, image);
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
            for (String oldExtension : List.of("jpg", "png", "webp")) {
                if (!oldExtension.equals(extension)) Files.deleteIfExists(imagePath(songId, oldExtension));
            }

            StoredArtwork stored = new StoredArtwork(songId, hit.id(), hit.pageURL(), hit.user(), extension, contentType);
            Files.writeString(metadataPath(songId), jsonMapper.writeValueAsString(stored), StandardCharsets.UTF_8);
            return toResponse(stored);
        }
    }

    private Optional<CachedSearch> readCachedSearch(Path cachePath) {
        if (!Files.isRegularFile(cachePath)) return Optional.empty();
        try {
            CachedSearch cached = jsonMapper.readValue(Files.readString(cachePath, StandardCharsets.UTF_8), CachedSearch.class);
            return Instant.ofEpochMilli(cached.fetchedAtMillis()).plus(SEARCH_CACHE_DURATION).isAfter(Instant.now())
                    ? Optional.of(cached)
                    : Optional.empty();
        } catch (Exception exception) {
            return Optional.empty();
        }
    }

    private Optional<StoredArtwork> readStoredArtwork(long songId) {
        Path path = metadataPath(songId);
        if (!Files.isRegularFile(path)) return Optional.empty();
        try {
            StoredArtwork artwork = jsonMapper.readValue(Files.readString(path, StandardCharsets.UTF_8), StoredArtwork.class);
            if (!List.of("jpg", "png", "webp").contains(artwork.extension())) return Optional.empty();
            return Files.isRegularFile(imagePath(songId, artwork.extension())) ? Optional.of(artwork) : Optional.empty();
        } catch (Exception exception) {
            return Optional.empty();
        }
    }

    private SongArtworkResponse toResponse(StoredArtwork artwork) {
        return new SongArtworkResponse(true, artwork.songId(), "/song-artwork/image/" + artwork.songId(), artwork.sourceUrl(), artwork.contributor());
    }

    private Path imagePath(long songId, String extension) {
        return artworkDirectory.resolve(songId + "." + extension).normalize();
    }

    private Path metadataPath(long songId) {
        return artworkDirectory.resolve(songId + ".json");
    }

    private Path cachePath(String title) {
        return artworkDirectory.resolve("cache").resolve(sha256(title) + ".json");
    }

    private static String extensionFor(String contentType) throws IOException {
        return switch (contentType) {
            case "image/jpeg", "image/jpg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            default -> throw new IOException("Unsupported image type");
        };
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public record StoredImage(byte[] bytes, String contentType) {}
    private record PixabayHit(int id, String pageURL, String webformatURL, String user) {}
    private record CachedSearch(long fetchedAtMillis, List<PixabayHit> hits) {}
    private record StoredArtwork(long songId, int imageId, String sourceUrl, String contributor, String extension, String contentType) {}
}
