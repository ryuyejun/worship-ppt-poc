package org.localchurch.worship.global.config.localaccess;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import lombok.RequiredArgsConstructor;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.*;
import java.nio.charset.StandardCharsets;

/** 기존 로컬 화면 토큰과 요청 크기 제한. 사용자 인증을 대체하지 않는다. */
@Component
@Order(1) // 다른 일반 필터보다 먼저 요청 크기와 로컬 토큰을 확인한다.
@RequiredArgsConstructor
public final class LocalAccessFilter implements Filter {
    private final LocalAccessToken token;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (!req.getMethod().equals("POST")) {
            chain.doFilter(request, response);
            return;
        }
        if (!token.value().equals(req.getHeader("X-Local-Token"))) {
            error(res, 403, "요청을 확인할 수 없습니다.");
            return;
        }
        int limit =
                (req.getRequestURI().equals("/ppt/batch") || req.getRequestURI().equals("/ppt/preview"))
                        ? 34_000_000
                        : req.getRequestURI().equals("/batch-import") ? 12_000_000 : 250_000;
        if (req.getContentLengthLong() > limit) {
            error(res, 413, "입력 자료의 크기가 너무 큽니다.");
            return;
        }
        byte[] data = req.getInputStream().readNBytes(limit + 1);
        if (data.length > limit) {
            error(res, 413, "입력 자료의 크기가 너무 큽니다.");
            return;
        }
        HttpServletRequestWrapper wrapped =
                new HttpServletRequestWrapper(req) {
                    @Override
                    public ServletInputStream getInputStream() {
                        ByteArrayInputStream in = new ByteArrayInputStream(data);
                        return new ServletInputStream() {
                            public int read() {
                                return in.read();
                            }

                            public boolean isFinished() {
                                return in.available() == 0;
                            }

                            public boolean isReady() {
                                return true;
                            }

                            public void setReadListener(ReadListener l) {
                                throw new UnsupportedOperationException();
                            }
                        };
                    }
                };
        chain.doFilter(wrapped, response);
    }

    private static void error(HttpServletResponse res, int status, String message)
            throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getOutputStream()
                .write(
                        ("{\"success\":false,\"data\":null,\"error\":\"" + message + "\"}")
                                .getBytes(StandardCharsets.UTF_8));
    }
}
