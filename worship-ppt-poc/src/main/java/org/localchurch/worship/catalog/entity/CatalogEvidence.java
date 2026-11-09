package org.localchurch.worship.catalog.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "youth_catalog_evidence")
public class CatalogEvidence {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "song_id")
    private Long songId;

    @Column(name = "source_url")
    private String sourceUrl;

    @Column(name = "chart_period")
    private String chartPeriod;

    @Column(name = "observed_title")
    private String observedTitle;

    private String performer;

    protected CatalogEvidence() {}

    public CatalogEvidence(
            Long songId,
            String sourceUrl,
            String chartPeriod,
            String observedTitle,
            String performer) {
        this.songId = songId;
        this.sourceUrl = sourceUrl;
        this.chartPeriod = chartPeriod;
        this.observedTitle = observedTitle;
        this.performer = performer;
    }
}
