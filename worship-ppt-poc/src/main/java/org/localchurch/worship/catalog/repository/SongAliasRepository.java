package org.localchurch.worship.catalog.repository;

import org.localchurch.worship.catalog.entity.SongAlias;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SongAliasRepository extends JpaRepository<SongAlias, Long> {
    boolean existsBySongIdAndNormalizedAlias(Long songId, String normalizedAlias);
}
