package org.localchurch.worship.importer.entity;

import jakarta.persistence.*;

import lombok.*;

@Entity
@Table(name = "lyric_import_audit")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LyricImportAudit {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "song_id")
    private Long songId;

    @Column(name = "file_name")
    private String fileName;

    private String sha256;
    private String note;
}
