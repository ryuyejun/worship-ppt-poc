package org.localchurch.worship.song.repository;

import org.localchurch.worship.database.MySqlStore;
import org.localchurch.worship.ppt.PptSample;
import org.localchurch.worship.song.SongRequests;
import org.localchurch.worship.song.entity.Song;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

/** 기존 곡 검색·가사·PPT 처리와 명령행 호환 기능. */
public class SongStore {
    public static final String SOURCE =
            "https://paidionsquare.com/contents/music.view.new.php?it_id=a17790633779971";
    public static final String TARGET = "소중해 존귀해 보배로워";

    public static String normalize(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFC)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[\\s\\p{Z}]+", "");
    }

    public static Connection open(Path db) throws SQLException {
        String config = System.getProperty("worship.mysql.config");
        if (config != null && !config.isBlank()) {
            try {
                Connection mysql = MySqlStore.open(Path.of(config));
                MySqlStore.init(mysql);
                return mysql;
            } catch (Exception e) {
                throw new SQLException("MySQL에 연결하지 못했습니다. 서버와 설정을 확인하세요.", e);
            }
        }
        Connection c = DriverManager.getConnection("jdbc:sqlite:" + db.toAbsolutePath());
        try (Statement s = c.createStatement()) {
            s.execute("PRAGMA foreign_keys = ON");
            s.execute("PRAGMA busy_timeout = 5000");
            s.execute(
                    """
                    CREATE TABLE IF NOT EXISTS songs (
                        id INTEGER PRIMARY KEY, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
                        lyricist TEXT NOT NULL, composer TEXT NOT NULL, artist TEXT NOT NULL,
                        lyrics TEXT, source_url TEXT NOT NULL, version TEXT NOT NULL,
                        lyrics_status TEXT NOT NULL CHECK(lyrics_status IN ('PENDING','USER_SUPPLIED')),
                        copyright_info TEXT NOT NULL,
                        UNIQUE(source_url, version),
                        CHECK((lyrics_status='PENDING' AND lyrics IS NULL) OR
                              (lyrics_status='USER_SUPPLIED' AND lyrics IS NOT NULL AND length(trim(lyrics)) > 0))
                    )
                    """);
            s.execute("CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(normalized_title)");
            s.execute(
                    "CREATE TABLE IF NOT EXISTS song_aliases (id INTEGER PRIMARY KEY, song_id"
                        + " INTEGER NOT NULL REFERENCES songs(id), alias TEXT NOT NULL,"
                        + " normalized_alias TEXT NOT NULL, UNIQUE(song_id, normalized_alias))");
            s.execute(
                    "CREATE INDEX IF NOT EXISTS idx_song_aliases ON"
                            + " song_aliases(normalized_alias)");
            boolean hasPermission = false,
                    hasEvidence = false,
                    hasCategory = false,
                    hasHymnNumber = false;
            try (ResultSet columns = s.executeQuery("PRAGMA table_info(songs)")) {
                while (columns.next()) {
                    if (columns.getString("name").equals("permission_status")) hasPermission = true;
                    if (columns.getString("name").equals("permission_evidence")) hasEvidence = true;
                    if (columns.getString("name").equals("category")) hasCategory = true;
                    if (columns.getString("name").equals("hymn_number")) hasHymnNumber = true;
                }
            }
            if (!hasPermission)
                s.execute(
                        "ALTER TABLE songs ADD COLUMN permission_status TEXT NOT NULL DEFAULT"
                                + " 'UNKNOWN' CHECK(permission_status IN ('UNKNOWN','VERIFIED'))");
            if (!hasEvidence) s.execute("ALTER TABLE songs ADD COLUMN permission_evidence TEXT");
            if (!hasCategory)
                s.execute("ALTER TABLE songs ADD COLUMN category TEXT NOT NULL DEFAULT 'UNKNOWN'");
            if (!hasHymnNumber) s.execute("ALTER TABLE songs ADD COLUMN hymn_number INTEGER");
        }
        SongRequests.init(c);
        org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(
                c, new org.springframework.core.io.ClassPathResource("db/import/sqlite-audit.sql"));
        // 정확히 정정 요청을 받은 기록만 근거 없는 허가 문구를 교체한다.
        try (PreparedStatement s =
                c.prepareStatement(
                        "UPDATE songs SET copyright_info=? WHERE source_url=? AND"
                                + " permission_status='UNKNOWN' AND copyright_info=?")) {
            s.setString(1, "저작권자 허가 미확인; 가사 출처: 파이디온스퀘어; 사용자 정정에 따라 검토 필요");
            s.setString(2, SOURCE);
            s.setString(3, "사용자가 권리자에게 허가를 받았다고 확인함; 가사 출처 파이디온스퀘어; 허가 범위·기한 문서 미확인");
            s.executeUpdate();
        }
        return c;
    }

    public static void seed(Connection c) throws SQLException {
        String insertSql =
                "INSERT INTO"
                    + " songs(title,normalized_title,lyricist,composer,artist,lyrics,source_url,version,lyrics_status,copyright_info)"
                    + " VALUES(?,?,?,?,?,NULL,?,?,'PENDING',?) "
                        + (MySqlStore.mysql(c)
                                ? "ON DUPLICATE KEY UPDATE id=id"
                                : "ON CONFLICT(source_url,version) DO NOTHING");
        try (PreparedStatement s = c.prepareStatement(insertSql)) {
            s.setString(1, TARGET);
            s.setString(2, normalize(TARGET));
            s.setString(3, "송예운");
            s.setString(4, "조미진");
            s.setString(5, "파이디온선교회");
            s.setString(6, SOURCE);
            s.setString(7, "하나님 나라의 노래 (2026)");
            s.setString(8, "저작권자 및 로컬 저장·PPT 사용 허가 미확인");
            System.out.println("대상 메타데이터 신규 등록: " + s.executeUpdate() + "건");
        }
        try (PreparedStatement s =
                c.prepareStatement("SELECT id FROM songs WHERE source_url=? AND version=?")) {
            s.setString(1, SOURCE);
            s.setString(2, "하나님 나라의 노래 (2026)");
            try (ResultSet r = s.executeQuery()) {
                if (r.next()) SongRequests.completeMatching(c, r.getLong(1));
            }
        }
    }

    public static Song read(ResultSet r) throws SQLException {
        return new Song(
                r.getLong("id"),
                r.getString("title"),
                r.getString("normalized_title"),
                r.getString("lyricist"),
                r.getString("composer"),
                r.getString("artist"),
                r.getString("lyrics"),
                r.getString("source_url"),
                r.getString("version"),
                r.getString("lyrics_status"),
                null,
                null);
    }

    public static List<Song> search(Connection c, String title, String author) throws SQLException {
        if (normalize(title).isEmpty()) throw new IllegalArgumentException("제목을 입력하세요.");
        List<Song> out = new ArrayList<>();
        String numberCondition =
                MySqlStore.mysql(c) && normalize(title).matches("[0-9]{1,5}")
                        ? " OR (category='HYMN' AND hymn_number=?)"
                        : "";
        try (PreparedStatement s =
                c.prepareStatement(
                        "SELECT * FROM songs WHERE normalized_title = ? OR EXISTS (SELECT 1 FROM"
                            + " song_aliases a WHERE a.song_id = songs.id AND a.normalized_alias ="
                            + " ?)"
                                + numberCondition
                                + " ORDER BY id")) {
            s.setString(1, normalize(title));
            s.setString(2, normalize(title));
            if (!numberCondition.isEmpty()) s.setInt(3, Integer.parseInt(normalize(title)));
            try (ResultSet r = s.executeQuery()) {
                while (r.next()) {
                    Song song = read(r);
                    if (author == null || normalize(song.lyricist()).equals(normalize(author)))
                        out.add(song);
                }
            }
        }
        return out;
    }

    public static Song byId(Connection c, long id) throws SQLException {
        try (PreparedStatement s = c.prepareStatement("SELECT * FROM songs WHERE id=?")) {
            s.setLong(1, id);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) throw new IllegalArgumentException("해당 ID가 없습니다: " + id);
                return read(r);
            }
        }
    }

    /** 웹에서 사용자가 확인한 메타데이터만 등록한다. 가사는 내려받지 않는다. */
    public static int register(
            Connection c,
            String title,
            String lyricist,
            String composer,
            String artist,
            String source,
            String version)
            throws Exception {
        java.net.URI uri = java.net.URI.create(source);
        if (title.isBlank()
                || version.isBlank()
                || uri.getHost() == null
                || !("http".equalsIgnoreCase(uri.getScheme())
                        || "https".equalsIgnoreCase(uri.getScheme())))
            throw new IllegalArgumentException("제목, 버전과 HTTP(S) 출처 URL이 필요합니다.");
        String insertSql =
                "INSERT INTO"
                    + " songs(title,normalized_title,lyricist,composer,artist,lyrics,source_url,version,lyrics_status,copyright_info)"
                    + " VALUES(?,?,?,?,?,NULL,?,?,'PENDING',?) "
                        + (MySqlStore.mysql(c)
                                ? "ON DUPLICATE KEY UPDATE id=id"
                                : "ON CONFLICT(source_url,version) DO NOTHING");
        try (PreparedStatement s = c.prepareStatement(insertSql)) {
            s.setString(1, title);
            s.setString(2, normalize(title));
            s.setString(3, lyricist.isBlank() ? "미확인" : lyricist);
            s.setString(4, composer.isBlank() ? "미확인" : composer);
            s.setString(5, artist.isBlank() ? "미확인" : artist);
            s.setString(6, source);
            s.setString(7, version);
            s.setString(8, "출처 및 권리 조건을 사용자가 확인해야 함");
            int inserted = s.executeUpdate();
            try (PreparedStatement lookup =
                    c.prepareStatement("SELECT id FROM songs WHERE source_url=? AND version=?")) {
                lookup.setString(1, source);
                lookup.setString(2, version);
                try (ResultSet r = lookup.executeQuery()) {
                    if (r.next()) SongRequests.completeMatching(c, r.getLong(1));
                }
            }
            return inserted;
        }
    }

    public static void importLyrics(Connection c, long id, Path file, boolean authorized)
            throws Exception {
        importText(c, id, Files.readString(file, StandardCharsets.UTF_8), authorized);
    }

    public static void importText(Connection c, long id, String lyrics, boolean authorized)
            throws Exception {
        if (!authorized)
            throw new IllegalArgumentException("로컬 저장 및 PPT 사용 권한을 확인한 경우에만 --authorized를 지정하세요.");
        if (lyrics.isBlank()) throw new IllegalArgumentException("가사 파일이 비어 있습니다.");
        if (sections(lyrics).isEmpty()) throw new IllegalArgumentException("가사 줄이 없습니다.");
        try (PreparedStatement s =
                c.prepareStatement(
                        "UPDATE songs SET lyrics=?, lyrics_status='USER_SUPPLIED' WHERE id=?")) {
            s.setString(1, lyrics);
            s.setLong(2, id);
            if (s.executeUpdate() != 1) throw new IllegalArgumentException("해당 ID가 없습니다: " + id);
        }
        System.out.println("가사 저장 완료");
    }

    /** 빈 줄과 [1절], [후렴]과 같은 독립 줄을 구간 경계로 사용. 원문은 DB에 그대로 보관. */
    public static List<List<String>> sections(String lyrics) {
        List<List<String>> all = new ArrayList<>();
        List<String> part = new ArrayList<>();
        Pattern label = Pattern.compile("^\\[[^\\[\\]\\r\\n]{1,40}\\]$");
        for (String line : lyrics.split("\\R", -1)) {
            if (line.isBlank() || label.matcher(line.strip()).matches()) {
                if (!part.isEmpty()) {
                    all.add(List.copyOf(part));
                    part.clear();
                }
            } else part.add(line);
        }
        if (!part.isEmpty()) all.add(List.copyOf(part));
        return all;
    }

    public static void ppt(Connection c, long id, Path dest) throws Exception {
        Song song = byId(c, id);
        if (!song.status().equals("USER_SUPPLIED") || song.lyrics() == null)
            throw new IllegalStateException("가사가 없습니다: " + song.status());
        if (Files.exists(dest)) throw new IOException("기존 파일을 덮어쓰지 않습니다: " + dest);
        PptSample.writeSlides(sections(song.lyrics()), dest);
    }

    public static String permission(Connection c, long id) throws SQLException {
        try (PreparedStatement s =
                c.prepareStatement("SELECT permission_status FROM songs WHERE id=?")) {
            s.setLong(1, id);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) throw new IllegalArgumentException("해당 ID가 없습니다.");
                return r.getString(1);
            }
        }
    }

    /** 증빙을 검토한 관리자가 근거를 남겨야 하며 프로그램 자체가 진위를 검증하지 않는다. */
    public static void verifyPermission(Connection c, long id, String evidence)
            throws SQLException {
        if (evidence.isBlank()) throw new IllegalArgumentException("확인한 허가 근거를 입력하세요.");
        try (PreparedStatement s =
                c.prepareStatement(
                        "UPDATE songs SET permission_status='VERIFIED', permission_evidence=? WHERE"
                                + " id=?")) {
            s.setString(1, evidence);
            s.setLong(2, id);
            if (s.executeUpdate() != 1) throw new IllegalArgumentException("해당 ID가 없습니다.");
        }
    }

    public static void show(Song s) {
        System.out.printf(
                "ID=%d | 제목=%s | 작사=%s | 작곡=%s | 아티스트=%s | 가사=%s | 출처=%s%n",
                s.id(), s.title(), s.lyricist(), s.composer(), s.artist(), s.status(), s.source());
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2)
            throw new IllegalArgumentException(
                    "사용법은 README-local.md 참조: init/search/import/ppt DB ...");
        String cmd = args[0];
        Path db = Path.of(args[1]);
        Path configured = Path.of(".server/mysql.properties").toAbsolutePath().normalize();
        if (System.getProperty("worship.mysql.config") == null
                && Files.isRegularFile(configured)
                && db.toAbsolutePath()
                        .normalize()
                        .equals(Path.of("local-songs.sqlite3").toAbsolutePath().normalize()))
            System.setProperty("worship.mysql.config", configured.toString());
        try (Connection c = open(db)) {
            System.out.println(
                    "사용 DB: "
                            + (MySqlStore.mysql(c)
                                    ? "MySQL worship_local"
                                    : "SQLite " + db.toAbsolutePath()));
            switch (cmd) {
                case "init" -> {
                    if (args.length != 2) throw new IllegalArgumentException("init DB");
                    seed(c);
                }
                case "search" -> {
                    if (args.length < 3 || args.length > 4)
                        throw new IllegalArgumentException("search DB 제목 [작사자]");
                    SongRequests.SearchResult result =
                            SongRequests.searchOrRequest(
                                    c, args[2], args.length == 4 ? args[3] : null);
                    System.out.println("검색 결과: " + result.songs().size() + "건");
                    for (Song s : result.songs()) show(s);
                    if (result.request() != null)
                        System.out.println("대기열에 등록됨 (요청 " + result.request().count() + "회)");
                }
                case "register" -> {
                    if (args.length != 8)
                        throw new IllegalArgumentException("register DB 제목 작사 작곡 아티스트 출처URL 버전");
                    System.out.println(
                            "신규 등록: "
                                    + register(
                                            c, args[2], args[3], args[4], args[5], args[6], args[7])
                                    + "건");
                }
                case "import-text" -> {
                    if (args.length != 4 || !args[3].equals("--authorized"))
                        throw new IllegalArgumentException(
                                "import-text DB ID --authorized (가사는 표준입력)");
                    String supplied = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
                    importText(c, Long.parseLong(args[2]), supplied, true);
                }
                case "import" -> {
                    if (args.length != 5)
                        throw new IllegalArgumentException("import DB ID 파일 --authorized");
                    importLyrics(
                            c,
                            Long.parseLong(args[2]),
                            Path.of(args[3]),
                            args[4].equals("--authorized"));
                }
                case "permission-verify" -> {
                    if (args.length != 4)
                        throw new IllegalArgumentException("permission-verify DB ID 확인한 허가 근거");
                    verifyPermission(c, Long.parseLong(args[2]), args[3]);
                    System.out.println("관리자가 입력한 허가 근거를 저장했습니다.");
                }
                case "ppt" -> {
                    if (args.length != 4) throw new IllegalArgumentException("ppt DB ID 출력.pptx");
                    ppt(c, Long.parseLong(args[2]), Path.of(args[3]));
                }
                default -> throw new IllegalArgumentException("알 수 없는 명령: " + cmd);
            }
        }
    }
}
