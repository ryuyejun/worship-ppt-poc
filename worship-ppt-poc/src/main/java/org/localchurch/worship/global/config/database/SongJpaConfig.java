package org.localchurch.worship.global.config.database;

import jakarta.persistence.EntityManagerFactory;

import org.localchurch.worship.song.repository.SongStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

import javax.sql.DataSource;

/** JPA와 기존 JDBC가 같은 설정의 데이터베이스를 사용하도록 연결한다. */
@Configuration
@Profile("!catalog-import")
@EnableTransactionManagement
@EnableJpaRepositories(
        basePackages = {
            "org.localchurch.worship.song.repository",
            "org.localchurch.worship.catalog.repository",
            "org.localchurch.worship.importer.repository"
        })
public class SongJpaConfig {
    @Bean
    DataSource dataSource(
            DatabaseLocation location, org.springframework.core.env.Environment environment)
            throws Exception {
        String config = environment.getProperty("worship.mysql.config");
        String url = environment.getProperty("spring.datasource.url");
        if (config != null && !config.isBlank()) {
            java.util.Properties properties = new java.util.Properties();
            try (java.io.InputStream input =
                    java.nio.file.Files.newInputStream(java.nio.file.Path.of(config))) {
                properties.load(input);
            }
            org.springframework.jdbc.datasource.DriverManagerDataSource source =
                    new org.springframework.jdbc.datasource.DriverManagerDataSource(
                            properties.getProperty("url"),
                            properties.getProperty("user"),
                            properties.getProperty("password"));
            SchemaMigration.migrate(source);
            return source;
        }
        if (url != null && !url.isBlank()) {
            org.springframework.jdbc.datasource.DriverManagerDataSource source =
                    new org.springframework.jdbc.datasource.DriverManagerDataSource(
                            url,
                            environment.getProperty("spring.datasource.username"),
                            environment.getProperty("spring.datasource.password"));
            SchemaMigration.migrate(source);
            return source;
        }
        return new AbstractDataSource() {
            @Override
            public Connection getConnection() throws SQLException {
                return SongStore.open(location.path());
            }

            @Override
            public Connection getConnection(String username, String password) throws SQLException {
                return getConnection();
            }
        };
    }

    @Bean
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
        LocalContainerEntityManagerFactoryBean factory =
                new LocalContainerEntityManagerFactoryBean();
        factory.setDataSource(dataSource);
        factory.setPackagesToScan(
                "org.localchurch.worship.song.entity",
                "org.localchurch.worship.catalog.entity",
                "org.localchurch.worship.importer.entity");
        factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none"));
        return factory;
    }

    @Bean
    PlatformTransactionManager transactionManager(EntityManagerFactory factory) {
        return new JpaTransactionManager(factory);
    }
}
