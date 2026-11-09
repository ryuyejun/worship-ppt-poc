package org.localchurch.worship.global.config.database;

import org.flywaydb.core.Flyway;
import org.localchurch.worship.global.config.database.migration.V1__SongAliasId;

import javax.sql.DataSource;

public final class SchemaMigration {
    private SchemaMigration() {}

    public static void migrate(DataSource source) {
        Flyway.configure()
                .dataSource(source)
                .locations(new String[0])
                .javaMigrations(new V1__SongAliasId())
                .table("flyway_app_schema_history")
                .baselineOnMigrate(true)
                .baselineVersion("0")
                .load()
                .migrate();
    }
}
