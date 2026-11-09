package org.localchurch.worship.importer.repository;

import org.localchurch.worship.database.MySqlStore;
import org.localchurch.worship.song.repository.SongStore;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

/** 일괄 가져오기에서 사용하는 DB 작업. 전달받은 연결과 트랜잭션을 공유한다. */
public final class BatchImportDatabase {
    private final Connection connection;
    private final JdbcTemplate jdbc;

    public BatchImportDatabase(Connection connection) {
        this.connection = connection;
        this.jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
    }

    public void ensureAuditTable() throws SQLException {
        String resource = MySqlStore.mysql(connection) ? "mysql-audit.sql" : "sqlite-audit.sql";
        ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/import/" + resource));
    }

    public boolean hasLyricsForUpdate(long songId) throws SQLException {
        String sql =
                "SELECT lyrics FROM songs WHERE id=?"
                        + (MySqlStore.mysql(connection) ? " FOR UPDATE" : "");
        return jdbc.queryForObject(sql, (row, index) -> row.getString(1) != null, songId);
    }

    public void saveAudit(long songId, String fileName, String hash) {
        new SimpleJdbcInsert(jdbc)
                .withTableName("lyric_import_audit")
                .usingColumns("song_id", "file_name", "sha256", "note")
                .execute(
                        Map.of(
                                "song_id",
                                songId,
                                "file_name",
                                fileName,
                                "sha256",
                                hash,
                                "note",
                                "사용자가 파일에서 가사를 가져옴"));
    }

    public void updateMetadata(long id, String category, Integer hymnNumber, String rights) {
        jdbc.update(
                "UPDATE songs SET category=?,hymn_number=?,copyright_info=? WHERE id=?",
                category,
                hymnNumber,
                rights,
                id);
    }

    public void addAlias(long id, String alias) {
        jdbc.update(
                "INSERT IGNORE INTO song_aliases(song_id,alias,normalized_alias) VALUES(?,?,?)",
                id,
                alias,
                SongStore.normalize(alias));
    }
}
