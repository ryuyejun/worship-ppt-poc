package org.localchurch.worship.song.entity;

import jakarta.persistence.*;

import lombok.*;
import lombok.experimental.Accessors;

import org.localchurch.worship.song.SongRequests;

import java.time.Instant;

@Entity
@Table(name = "song_requests")
@Getter
@Accessors(fluent = true)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SongRequest {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;

    @Column(name = "normalized_title")
    private String normalizedTitle;

    private String lyricist;

    @Column(name = "normalized_lyricist")
    private String normalizedLyricist;

    private String status;

    @Column(name = "request_count")
    private int count;

    @Column(name = "created_at")
    private String createdAt;

    @Column(name = "updated_at")
    private String updatedAt;

    @Column(name = "song_id")
    private Long songId;

    public void complete(long songId) {
        this.songId = songId;
        status = "COMPLETED";
        updatedAt = Instant.now().toString();
    }

    public SongRequests.Request response() {
        return new SongRequests.Request(
                id, title, lyricist, status, count, createdAt, updatedAt, songId);
    }
}
