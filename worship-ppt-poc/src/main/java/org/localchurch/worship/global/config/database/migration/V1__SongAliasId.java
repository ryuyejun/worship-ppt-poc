package org.localchurch.worship.global.config.database.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.ResultSet;
import java.sql.Statement;

/** 기존 별칭과 복합 유일성을 보존하며 단일 기본키를 추가한다. */
public class V1__SongAliasId extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        boolean exists;
        try (ResultSet columns =
                context.getConnection()
                        .getMetaData()
                        .getColumns(
                                context.getConnection().getCatalog(), null, "song_aliases", "id")) {
            exists = columns.next();
        }
        org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(
                context.getConnection(),
                new org.springframework.core.io.ClassPathResource("db/import/mysql-audit.sql"));
        try (Statement statement = context.getConnection().createStatement()) {
            if (!exists)
                statement.execute(
                        "ALTER TABLE song_aliases ADD COLUMN id BIGINT NOT NULL AUTO_INCREMENT"
                            + " PRIMARY KEY FIRST");
            statement.execute("ALTER TABLE songs MODIFY copyright_info TEXT NOT NULL DEFAULT ('')");
        }
    }
}
