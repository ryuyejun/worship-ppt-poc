package org.localchurch.worship.importer.repository;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.importer.BatchImport;
import org.localchurch.worship.importer.entity.LyricImportAudit;
import org.localchurch.worship.song.entity.Song;
import org.localchurch.worship.song.repository.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Path;
import java.util.*;

@Repository
@RequiredArgsConstructor
public class LyricsImportRepository {
    private final SongRepository songs;
    private final SongOperationsRepository operations;
    private final LyricImportAuditRepository audits;

    @Transactional(rollbackFor = Exception.class)
    public BatchImport.ImportResult importDirectory(Path directory) throws Exception {
        int saved = 0, skipped = 0;
        List<BatchImport.Entry> entries = new ArrayList<>();
        for (Path file : BatchImport.files(directory)) entries.addAll(BatchImport.readLyrics(file));
        if (entries.isEmpty()) throw new IllegalArgumentException("가져올 자료가 없습니다.");
        for (BatchImport.Entry entry : entries) {
            if (entry.title().isBlank()
                    || entry.lyrics().isBlank()
                    || SongStore.sections(entry.lyrics()).isEmpty()) {
                skipped++;
                continue;
            }
            List<Song> found = operations.matchesWithOrWithoutLyrics(entry.title(), entry.author());
            if (found.size() != 1) {
                skipped++;
                continue;
            }
            Song song = songs.lockById(found.get(0).id()).orElseThrow();
            if (song.lyrics() != null) {
                skipped++;
                continue;
            }
            song.importLyrics(entry.lyrics());
            audits.save(
                    new LyricImportAudit(
                            null,
                            song.id(),
                            entry.origin(),
                            BatchImport.sha(entry.lyrics()),
                            "파일에서 가사 가져오기"));
            saved++;
        }
        return new BatchImport.ImportResult(saved, skipped);
    }
}
