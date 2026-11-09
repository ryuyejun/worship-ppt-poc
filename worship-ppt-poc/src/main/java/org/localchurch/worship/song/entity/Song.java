package org.localchurch.worship.song.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

import org.hibernate.annotations.DynamicUpdate;

/** songs 테이블의 곡 정보. */
@Entity
@Table(name = "songs")
@Getter
@Accessors(fluent = true)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@DynamicUpdate
public class Song {
    /** 곡을 구분하는 고유 번호 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 곡 제목 */
    @Column(nullable = false)
    private String title;

    /** 검색과 중복 비교를 위해 한글·공백·대소문자를 정리한 제목 */
    @Column(name = "normalized_title", nullable = false)
    private String normalizedTitle;

    /** 작사가: 가사를 쓴 사람 */
    private String lyricist;

    /** 작곡가: 곡의 선율을 만든 사람 */
    private String composer;

    /** 가수 또는 찬양팀 등 곡을 부르거나 연주한 사람 */
    private String artist;

    /** 저장된 가사 원문 */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String lyrics;

    /** 곡 정보 또는 가사의 출처 */
    @Column(name = "source_url")
    private String source;

    /** 같은 곡을 출처별·판본별로 구분하는 값 */
    private String version;

    /** 가사 저장 상태: PENDING 또는 USER_SUPPLIED */
    @Column(name = "lyrics_status")
    private String status;

    /** 곡 분류: 찬송가, CCM 등 */
    private String category;

    /** 찬송가 번호. 찬송가가 아니거나 번호가 없으면 비어 있음 */
    @Column(name = "hymn_number")
    private Integer hymnNumber;

    public void updateUnknownArtist(String performer) {
        if ("미확인".equals(artist)) {
            artist = performer;
            if ("UNKNOWN".equals(category)) category = "CCM";
        }
    }

    public void markCcm() {
        category = "CCM";
    }

    public void importLyrics(String text) {
        if (lyrics != null) throw new IllegalStateException("기존 가사를 덮어쓸 수 없습니다.");
        lyrics = text;
        status = "USER_SUPPLIED";
    }
}
