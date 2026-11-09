package org.localchurch.worship.catalog.service;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.catalog.entity.*;
import org.localchurch.worship.catalog.repository.*;
import org.localchurch.worship.song.entity.Song;
import org.localchurch.worship.song.repository.SongStore;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.*;

import java.nio.file.Path;
import java.net.URI;
import java.time.LocalDate;
import java.util.*;

@Service
@Profile("catalog-import")
@RequiredArgsConstructor
public class YouthCatalogService {
    private final org.localchurch.worship.song.repository.SongRequestRepository requests;
    private final org.localchurch.worship.song.repository.SongRepository songRepository;
    private final SongAliasRepository aliasesRepository;
    private final CatalogEntryRepository entryRepository;
    private final CatalogEvidenceRepository evidenceRepository;
    private static final ObjectMapper JSON =
            tools.jackson.databind.json.JsonMapper.builder().build();

    private static String text(JsonNode n, String key) {
        return n.path(key).asText("");
    }

    static void validateSource(String source, String title) {
        try {
            URI url = URI.create(source);
            if ((!"http".equalsIgnoreCase(url.getScheme())
                            && !"https".equalsIgnoreCase(url.getScheme()))
                    || url.getHost() == null)
                throw new IllegalArgumentException();
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("올바른 출처 주소를 입력하세요: " + title);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    public int ingest(Path file) throws Exception {
        JsonNode records = JSON.readTree(file.toFile());
        if (!records.isArray()) throw new IllegalArgumentException("곡 목록은 배열이어야 합니다.");
        int added = 0, reused = 0, skipped = 0, index = 0;
        {
            for (JsonNode n : records) {
                index++;
                String title = text(n, "title"),
                        performer = text(n, "performer"),
                        priority = text(n, "priority");
                JsonNode sources = n.path("sources"), aliases = n.path("aliases");
                if (title.isBlank()
                        || performer.isBlank()
                        || !Set.of("HIGH", "MEDIUM", "LOW").contains(priority)
                        || !sources.isArray()
                        || sources.isEmpty()
                        || !aliases.isArray())
                    throw new IllegalArgumentException("후보 메타데이터가 불완전합니다: " + title);
                for (JsonNode source : sources) {
                    validateSource(source.asText(), title);
                }
                Set<Long> ids = new LinkedHashSet<>();
                for (Song song : matches(title)) ids.add(song.id());
                for (JsonNode alias : aliases)
                    for (Song song : matches(alias.asText())) ids.add(song.id());
                if (ids.size() > 1) {
                    System.out.println("수동 검토: 여러 곡과 일치: " + title);
                    skipped++;
                    continue;
                }
                long id;
                if (ids.size() == 1) {
                    id = ids.iterator().next();
                    Song existing = songRepository.findById(id).orElseThrow();
                    boolean equalArtist =
                            SongStore.normalize(existing.artist())
                                    .equals(SongStore.normalize(performer));
                    boolean matchingKnownAlias = false;
                    if (existing.artist().equals("미확인"))
                        for (JsonNode a : aliases) {
                            matchingKnownAlias |=
                                    aliasesRepository.existsBySongIdAndNormalizedAlias(
                                            id, SongStore.normalize(a.asText()));
                        }
                    if (!equalArtist && !matchingKnownAlias) {
                        System.out.println("수동 검토: 기존 곡의 공연자·판본 불확실: " + title);
                        skipped++;
                        continue;
                    }
                    if (matchingKnownAlias) {
                        songRepository.findById(id).orElseThrow().updateUnknownArtist(performer);
                        songRepository.flush();
                    }
                    reused++;
                } else {
                    String primary = sources.get(0).asText();
                    String version = "차트 큐레이션 2026-11-05: " + title;
                    if (songRepository.existsBySourceAndVersion(primary, version))
                        throw new IllegalStateException("출처 충돌: " + title);
                    Song created =
                            songRepository.saveAndFlush(
                                    new Song(
                                            null,
                                            title,
                                            SongStore.normalize(title),
                                            "미확인",
                                            "미확인",
                                            performer,
                                            null,
                                            primary,
                                            version,
                                            "PENDING",
                                            "CCM",
                                            null));
                    for (org.localchurch.worship.song.entity.SongRequest request :
                            requests.findByStatusAndNormalizedTitle(
                                    "PENDING", created.normalizedTitle())) {
                        if (request.normalizedLyricist().isEmpty()
                                && songRepository.countByNormalizedTitle(created.normalizedTitle())
                                        == 1) request.complete(created.id());
                    }
                    List<Song> found = matches(title);
                    if (found.size() != 1) throw new IllegalStateException("등록 결과 불명확: " + title);
                    id = found.get(0).id();
                    songRepository.findById(id).orElseThrow().markCcm();
                    songRepository.flush();
                    added++;
                }
                for (JsonNode alias : aliases) {
                    String a = alias.asText();
                    if (a.isBlank()) continue;
                    List<Song> matches = matches(a);
                    if (matches.stream().anyMatch(v -> v.id() != id)) {
                        System.out.println("별칭 충돌, 추가 안 함: " + a);
                        continue;
                    }
                    String normalizedAlias = SongStore.normalize(a);
                    if (!aliasesRepository.existsBySongIdAndNormalizedAlias(id, normalizedAlias)) {
                        aliasesRepository.saveAndFlush(new SongAlias(id, a, normalizedAlias));
                    }
                }
                boolean chart = false;
                for (JsonNode evidence : sources) {
                    if (evidence.asText().equals("https://kccm.app/chart")
                            || evidence.asText().equals("https://www.ccmranking.com/charts"))
                        chart = true;
                }
                String notes =
                        chart
                                ? "디지털 차트 기반 편집 우선순위; 청년 예배 빈도 미검증"
                                : "곡 목록 근거; 개별 차트 순위 및 청년 예배 빈도 미검증";
                CatalogEntry entry = entryRepository.findById(id).orElse(null);
                if (entry == null) {
                    entryRepository.save(
                            new CatalogEntry(
                                    id, priority, index, notes, LocalDate.of(2026, 11, 5)));
                } else {
                    entry.mergePriority(priority, index);
                }

                for (JsonNode source : sources) {
                    String url = source.asText();
                    String period =
                            url.equals("https://kccm.app/chart")
                                    ? "2026-10-26~2026-11-01"
                                    : url.equals("https://www.ccmranking.com/charts")
                                            ? "2026-10-26 주간"
                                            : url.equals("https://www.ccmranking.com/songs")
                                                            || url.startsWith("https://www.ccmranking.com/worship/anointing/albums/")
                                                    ? "인기 앨범·수록곡 (2026-11-05 확인)"
                                                    : "확인 시기 미기록";
                    if (!evidenceRepository.existsBySongIdAndSourceUrlAndChartPeriod(
                            id, url, period)) {
                        boolean guestVersion =
                                url.contains("ccmranking") && title.equals("하나님의 세계");
                        String observed = guestVersion ? "하나님의 세계 (with 홍이삭)" : title;
                        if (url.equals("https://www.ccmranking.com/songs")) {
                            String album = sources.get(0).asText();
                            observed =
                                    java.net.URLDecoder.decode(
                                            album.substring(album.lastIndexOf('/') + 1),
                                            java.nio.charset.StandardCharsets.UTF_8);
                        }
                        evidenceRepository.save(
                                new CatalogEvidence(
                                        id,
                                        url,
                                        period,
                                        observed,
                                        guestVersion
                                                ? "WELOVE CREATIVE TEAM (with 홍이삭)"
                                                : performer));
                    }
                }
            }
            System.out.printf("신규 %d곡, 기존 재사용 %d건, 불명확 건너뜀 %d건%n", added, reused, skipped);
            return added;
        }
    }

    private List<Song> matches(String title) {
        String key = SongStore.normalize(title);
        return songRepository.search(key, key.matches("[0-9]{1,5}") ? Integer.valueOf(key) : null);
    }
}
