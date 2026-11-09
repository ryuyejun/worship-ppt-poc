package org.localchurch.worship.catalog.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "song_aliases")
public class SongAlias {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "song_id")
    private Long songId;

    @Column(name = "normalized_alias")
    private String normalizedAlias;

    private String alias;

    protected SongAlias() {}

    public SongAlias(Long songId, String alias, String normalizedAlias) {
        this.songId = songId;
        this.alias = alias;
        this.normalizedAlias = normalizedAlias;
    }
}
