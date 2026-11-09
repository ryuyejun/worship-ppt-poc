package org.localchurch.worship.global.config.localaccess;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/** 로컬 전용: 기존 요청 토큰을 유지하며 공개 서버용 로그인은 별도 구현이 필요하다. */
@Configuration
class LocalSecurityConfig {
    @Bean
    SecurityFilterChain localFilterChain(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .build();
    }
}
