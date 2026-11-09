package org.localchurch.worship.song.repository;

import org.localchurch.worship.song.entity.SongRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SongRequestRepository extends JpaRepository<SongRequest, Long> {
    Optional<SongRequest> findByNormalizedTitleAndNormalizedLyricist(String title, String lyricist);

    List<SongRequest> findByStatusOrderByUpdatedAtDescIdDesc(String status);

    List<SongRequest> findByStatusAndNormalizedTitle(String status, String title);
}
