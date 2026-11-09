package org.localchurch.worship.catalog.repository;

import org.localchurch.worship.catalog.entity.CatalogEvidence;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CatalogEvidenceRepository extends JpaRepository<CatalogEvidence, Long> {
    boolean existsBySongIdAndSourceUrlAndChartPeriod(
            Long songId, String sourceUrl, String chartPeriod);
}
