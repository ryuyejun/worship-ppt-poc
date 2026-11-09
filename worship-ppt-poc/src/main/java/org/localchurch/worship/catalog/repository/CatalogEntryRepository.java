package org.localchurch.worship.catalog.repository;

import org.localchurch.worship.catalog.entity.CatalogEntry;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CatalogEntryRepository extends JpaRepository<CatalogEntry, Long> {}
