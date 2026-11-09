-- Existing catalog tables are retained; the migration also supports a new database.
CREATE TABLE IF NOT EXISTS youth_catalog (
    song_id BIGINT NOT NULL PRIMARY KEY,
    priority VARCHAR(10) NOT NULL,
    position INT NOT NULL,
    notes VARCHAR(500) NOT NULL,
    curated_at DATE NOT NULL,
    FOREIGN KEY (song_id) REFERENCES songs(id),
    CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE IF NOT EXISTS youth_catalog_evidence (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    song_id BIGINT NOT NULL,
    source_url VARCHAR(255) NOT NULL,
    chart_period VARCHAR(40) NOT NULL,
    observed_title VARCHAR(255) NOT NULL,
    performer VARCHAR(255) NOT NULL,
    UNIQUE KEY uniq_evidence (song_id, source_url, chart_period),
    FOREIGN KEY (song_id) REFERENCES songs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
