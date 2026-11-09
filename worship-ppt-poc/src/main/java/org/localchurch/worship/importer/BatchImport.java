package org.localchurch.worship.importer;

import org.apache.commons.csv.*;
import org.apache.poi.xslf.usermodel.*;
import org.localchurch.worship.database.MySqlStore;
import org.localchurch.worship.importer.repository.BatchImportDatabase;
import org.localchurch.worship.song.entity.Song;
import org.localchurch.worship.song.repository.SongStore;

import tools.jackson.databind.*;

import java.io.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.util.stream.*;

/** 실행 전 관리자 확인이 필요한 로컬 파일 일괄 수입기. 웹에서 가사를 수집하지 않는다. */
public class BatchImport {
    public record Entry(String title, String author, String lyrics, String origin) {}

    static final ObjectMapper json = tools.jackson.databind.json.JsonMapper.builder().build();

    static String str(JsonNode n, String key) {
        return n.path(key).asText("");
    }

    static Connection db() throws Exception {
        Connection c = MySqlStore.open(Path.of(".server/mysql.properties"));
        MySqlStore.init(c);
        return c;
    }

    public static String sha(String value) throws Exception {
        return HexFormat.of()
                .formatHex(
                        MessageDigest.getInstance("SHA-256")
                                .digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    static String read(Path p) throws Exception {
        return Files.readString(p, StandardCharsets.UTF_8);
    }

    static String presentation(Path p) throws Exception {
        StringBuilder result = new StringBuilder();
        try (InputStream in = Files.newInputStream(p);
                XMLSlideShow deck = new XMLSlideShow(in)) {
            int slide = 0;
            for (XSLFSlide sl : deck.getSlides()) {
                slide++;
                List<String> blocks = new ArrayList<>();
                for (XSLFShape sh : sl.getShapes())
                    if (sh instanceof XSLFTextShape text && !text.getText().isBlank())
                        blocks.add(text.getText());
                if (!blocks.isEmpty()) {
                    if (result.length() > 0) result.append("\n\n");
                    result.append("[슬라이드 ")
                            .append(slide)
                            .append("]\n")
                            .append(String.join("\n", blocks));
                }
            }
        }
        return result.toString();
    }

    static String stem(Path p) {
        String name = p.getFileName().toString();
        return name.substring(0, name.lastIndexOf('.'));
    }

    public static List<Entry> readLyrics(Path p) throws Exception {
        String name = p.getFileName().toString().toLowerCase(Locale.ROOT);
        List<Entry> out = new ArrayList<>();
        if (name.endsWith(".txt"))
            out.add(new Entry(stem(p), "", read(p), p.getFileName().toString()));
        else if (name.endsWith(".pptx"))
            out.add(new Entry(stem(p), "", presentation(p), p.getFileName().toString()));
        else if (name.endsWith(".json")) {
            JsonNode nodes = json.readTree(p.toFile());
            if (!nodes.isArray()) throw new IllegalArgumentException("JSON은 곡 배열이어야 합니다: " + p);
            for (JsonNode n : nodes)
                out.add(
                        new Entry(
                                str(n, "title"),
                                str(n, "lyricist"),
                                str(n, "lyrics"),
                                p.getFileName().toString()));
        } else if (name.endsWith(".csv")) {
            try (Reader in = Files.newBufferedReader(p, StandardCharsets.UTF_8);
                    CSVParser csv =
                            CSVFormat.DEFAULT
                                    .builder()
                                    .setHeader()
                                    .setSkipHeaderRecord(true)
                                    .build()
                                    .parse(in)) {
                if (!csv.getHeaderMap().containsKey("title")
                        || !csv.getHeaderMap().containsKey("lyrics"))
                    throw new IllegalArgumentException("CSV에 title, lyrics 열이 필요합니다: " + p);
                for (CSVRecord r : csv)
                    out.add(
                            new Entry(
                                    r.get("title"),
                                    r.isMapped("lyricist") ? r.get("lyricist") : "",
                                    r.get("lyrics"),
                                    p.getFileName().toString()));
            }
        } else throw new IllegalArgumentException("지원하지 않는 파일: " + p);
        return out;
    }

    public static List<Path> files(Path p) throws IOException {
        if (Files.isRegularFile(p)) return List.of(p);
        if (!Files.isDirectory(p)) throw new IllegalArgumentException("파일이나 폴더가 없습니다: " + p);
        try (Stream<Path> stream = Files.list(p)) {
            return stream.filter(Files::isRegularFile)
                    .filter(
                            f ->
                                    f.getFileName()
                                            .toString()
                                            .toLowerCase(Locale.ROOT)
                                            .matches(".*\\.(txt|csv|json|pptx)$"))
                    .sorted()
                    .toList();
        }
    }

    public record ImportResult(int saved, int skipped) {}

    public static ImportResult lyrics(Connection c, Path source) throws Exception {
        BatchImportDatabase database = new BatchImportDatabase(c);
        database.ensureAuditTable();
        List<Entry> entries = new ArrayList<>();
        for (Path p : files(source)) entries.addAll(readLyrics(p));
        if (entries.isEmpty()) throw new IllegalArgumentException("수입할 자료가 없습니다.");
        int saved = 0, skipped = 0;
        c.setAutoCommit(false);
        try {
            for (Entry e : entries) {
                if (e.title().isBlank()
                        || e.lyrics().isBlank()
                        || SongStore.sections(e.lyrics()).isEmpty()) {
                    System.out.println("건너뜀: 제목 또는 가사 없음 (" + e.origin() + ")");
                    skipped++;
                    continue;
                }
                List<Song> matches =
                        SongStore.search(c, e.title(), e.author().isBlank() ? null : e.author());
                if (matches.size() != 1) {
                    System.out.println("건너뜀: 곡 일치 결과 " + matches.size() + "건: " + e.title());
                    skipped++;
                    continue;
                }
                Song song = matches.get(0);
                if (database.hasLyricsForUpdate(song.id())) {
                    System.out.println("건너뜀: 기존 가사 보존: " + e.title());
                    skipped++;
                    continue;
                }
                SongStore.importText(c, song.id(), e.lyrics(), true);
                database.saveAudit(song.id(), e.origin(), sha(e.lyrics()));
                saved++;
            }
            c.commit();
            System.out.println("가사 수입=" + saved + ", 건너뜀=" + skipped);
            return new ImportResult(saved, skipped);
        } catch (Exception e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(true);
        }
    }

    static void catalog(Connection c, Path p) throws Exception {
        JsonNode rows = json.readTree(p.toFile());
        if (!rows.isArray()) throw new IllegalArgumentException("목록 JSON은 배열이어야 합니다.");
        int inserted = 0, skipped = 0;
        BatchImportDatabase database = new BatchImportDatabase(c);
        c.setAutoCommit(false);
        try {
            for (JsonNode n : rows) {
                String title = str(n, "title"),
                        author = str(n, "lyricist"),
                        source = str(n, "source"),
                        version = str(n, "version");
                if (title.isBlank() || source.isBlank() || version.isBlank())
                    throw new IllegalArgumentException("곡 제목·출처·버전이 필요합니다.");
                List<Song> candidates = SongStore.search(c, title, null);
                boolean possible = !candidates.isEmpty();
                JsonNode aliases = n.path("aliases");
                if (aliases.isArray())
                    for (JsonNode a : aliases)
                        if (!SongStore.search(c, a.asText(), null).isEmpty()) possible = true;
                if (possible) {
                    System.out.println("중복 가능성: 검토 후 건너뜀: " + title);
                    skipped++;
                    continue;
                }
                if (SongStore.register(
                                c,
                                title,
                                author,
                                str(n, "composer"),
                                str(n, "artist"),
                                source,
                                version)
                        != 1) {
                    skipped++;
                    continue;
                }
                List<Song> matches = SongStore.search(c, title, null);
                if (matches.size() != 1) throw new IllegalStateException("등록 결과가 모호합니다: " + title);
                long id = matches.get(0).id();
                String category = str(n, "category");
                if (!Set.of("HYMN", "CCM", "UNKNOWN").contains(category)) category = "UNKNOWN";
                Integer hymnNumber =
                        n.hasNonNull("hymn_number") ? n.path("hymn_number").asInt() : null;
                String rights = str(n, "copyright_info");
                database.updateMetadata(
                        id, category, hymnNumber, rights.isBlank() ? "저작권 정보 및 이용 허가 미확인" : rights);
                if (aliases.isArray())
                    for (JsonNode a : aliases) {
                        String alias = a.asText();
                        if (alias.isBlank()) continue;
                        database.addAlias(id, alias);
                    }
                inserted++;
            }
            c.commit();
            System.out.println("목록 신규=" + inserted + ", 중복·검토 건너뜀=" + skipped);
        } catch (Exception e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(true);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2)
            throw new IllegalArgumentException("catalog JSON 또는 lyrics 파일/폴더 --authorized");
        try (Connection c = db()) {
            if (args[0].equals("catalog") && args.length == 2) catalog(c, Path.of(args[1]));
            else if (args[0].equals("lyrics") && args.length == 3 && args[2].equals("--authorized"))
                lyrics(c, Path.of(args[1]));
            else throw new IllegalArgumentException("catalog JSON 또는 lyrics 파일/폴더 --authorized");
        }
    }
}
