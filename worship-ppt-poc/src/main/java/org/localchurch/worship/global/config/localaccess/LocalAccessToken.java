package org.localchurch.worship.global.config.localaccess;

import org.springframework.stereotype.Component;

import java.util.UUID;

/** 현재 로컬 앱 인스턴스의 요청 토큰. 사용자 인증 수단이 아니다. */
@Component
public final class LocalAccessToken {
    private final String value = UUID.randomUUID().toString();

    public String value() {
        return value;
    }
}
