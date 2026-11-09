package org.localchurch.worship.catalog.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class YouthCatalogSourceTest {
    @Test
    void acceptsAnyWebSourceButRejectsInvalidAddresses() {
        assertDoesNotThrow(() -> YouthCatalogService.validateSource("https://example.org/catalog", "시험곡"));
        assertThrows(IllegalArgumentException.class, () -> YouthCatalogService.validateSource("invalid-url", "시험곡"));
        assertThrows(IllegalArgumentException.class, () -> YouthCatalogService.validateSource("file:///tmp/catalog", "시험곡"));
    }
}
