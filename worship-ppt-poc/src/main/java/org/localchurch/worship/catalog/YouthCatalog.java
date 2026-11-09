package org.localchurch.worship.catalog;

import org.localchurch.worship.database.MySqlStore;

import java.nio.file.*;
import java.sql.*;

/** 사람이 출처를 확인한 차트 메타데이터만 수입한다. 가사에는 접근하지 않는다. */
public class YouthCatalog {
    static void init(Connection connection) {
        org.localchurch.worship.global.config.database.SchemaMigration.migrate(
                new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                        connection, true));
        org.flywaydb.core.Flyway.configure()
                .dataSource(
                        new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                connection, true))
                .locations("classpath:db/catalog-migration")
                .table("flyway_catalog_schema_history")
                .baselineOnMigrate(true)
                .baselineVersion("0")
                .load()
                .migrate();
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("큐레이션 JSON 파일을 지정하세요.");
        try (Connection c = MySqlStore.open(Path.of(".server/mysql.properties"))) {
            MySqlStore.init(c);
            init(c);
            try (org.springframework.context.annotation.AnnotationConfigApplicationContext context =
                    createContext(c)) {
                context.getBean(org.localchurch.worship.catalog.service.YouthCatalogService.class)
                        .ingest(Path.of(args[0]));
            }
        }
    }

    public static org.springframework.context.annotation.AnnotationConfigApplicationContext
            createContext(Connection connection) {
        org.springframework.context.annotation.AnnotationConfigApplicationContext context =
                new org.springframework.context.annotation.AnnotationConfigApplicationContext();
        context.getEnvironment().setActiveProfiles("catalog-import");
        context.registerBean(
                javax.sql.DataSource.class,
                () ->
                        new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                                connection, true));
        context.register(
                org.localchurch.worship.catalog.config.CatalogJpaConfig.class,
                org.localchurch.worship.catalog.service.YouthCatalogService.class);
        context.refresh();
        return context;
    }
}
