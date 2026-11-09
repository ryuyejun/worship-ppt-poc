package org.localchurch.worship.catalog.entity;

import jakarta.persistence.*;

import java.time.LocalDate;

@Entity
@Table(name = "youth_catalog")
public class CatalogEntry {
    @Id
    @Column(name = "song_id")
    private Long songId;

    private String priority;
    private int position;
    private String notes;

    @Column(name = "curated_at")
    private LocalDate curatedAt;

    protected CatalogEntry() {}

    public CatalogEntry(
            Long songId, String priority, int position, String notes, LocalDate curatedAt) {
        this.songId = songId;
        this.priority = priority;
        this.position = position;
        this.notes = notes;
        this.curatedAt = curatedAt;
    }

    public void mergePriority(String candidate, int candidatePosition) {
        position = Math.min(position, candidatePosition);
        if ("HIGH".equals(priority) || "HIGH".equals(candidate)) priority = "HIGH";
        else if ("MEDIUM".equals(priority) || "MEDIUM".equals(candidate)) priority = "MEDIUM";
        else priority = "LOW";
    }
}
