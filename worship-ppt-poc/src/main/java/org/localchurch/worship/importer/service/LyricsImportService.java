package org.localchurch.worship.importer.service;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.importer.BatchImport;
import org.localchurch.worship.importer.repository.LyricsImportRepository;
import org.springframework.stereotype.Service;

import java.nio.file.*;
import java.util.*;

@Service
@RequiredArgsConstructor
public class LyricsImportService {
    public record InputFile(String name, String data) {}

    private final LyricsImportRepository repository;

    public BatchImport.ImportResult importFiles(List<InputFile> files) throws Exception {
        if (files == null || files.isEmpty() || files.size() > 50)
            throw new IllegalArgumentException("파일을 1개에서 50개까지 선택하세요.");
        Path dir = Files.createTempDirectory("worship-user-import-");
        try {
            long total = 0;
            Set<String> names = new HashSet<>();
            for (InputFile f : files) {
                String name = validateFileName(f.name(), names);
                byte[] bytes = Base64.getDecoder().decode(f.data() == null ? "" : f.data());
                total += bytes.length;
                if (total > 8_000_000) throw new IllegalArgumentException("파일 총 크기는 8MB 이하여야 합니다.");
                Files.write(dir.resolve(name), bytes, StandardOpenOption.CREATE_NEW);
            }
            return repository.importDirectory(dir);
        } finally {
            try (java.util.stream.Stream<Path> paths = Files.walk(dir)) {
                for (Path p : paths.sorted(Comparator.reverseOrder()).toList())
                    Files.deleteIfExists(p);
            }
        }
    }

    private String validateFileName(String input, Set<String> names) {
        String name = input == null ? "" : input;
        if (name.isBlank()
                || name.contains("/")
                || name.contains("\\")
                || name.equals(".")
                || name.equals("..")
                || !name.toLowerCase(Locale.ROOT).matches(".*\\.(txt|csv|json|pptx)$")
                || !names.add(name)) {
            throw new IllegalArgumentException("파일 이름 또는 형식을 확인하세요: " + name);
        }
        return name;
    }
}
