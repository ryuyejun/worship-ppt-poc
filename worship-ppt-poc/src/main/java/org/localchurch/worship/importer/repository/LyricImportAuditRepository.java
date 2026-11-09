package org.localchurch.worship.importer.repository;

import org.localchurch.worship.importer.entity.LyricImportAudit;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LyricImportAuditRepository extends JpaRepository<LyricImportAudit, Long> {}
