package org.localchurch.worship.web;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.event.EventListener;

import java.awt.Desktop;
import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** 로컬 전용 실행 진입점. 외부 서버 배포 전 별도의 인증·운영 구성이 필요하다. */
@SpringBootApplication(
        scanBasePackages = "org.localchurch.worship",
        exclude = {org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration.class})
public class LocalWeb {
    static boolean openBrowser;

    public static void main(String[] args) throws Exception {
        List<String> springArgs = new ArrayList<>();
        for (String arg : args) {
            if (arg.equals("--open")) openBrowser = true;
            else if (!arg.startsWith("--"))
                springArgs.add("--worship.sqlite.path=" + Path.of(arg).toAbsolutePath());
            else springArgs.add(arg);
        }
        SpringApplication app = new SpringApplication(LocalWeb.class);
        app.setDefaultProperties(
                java.util.Map.of(
                        "server.address",
                        "127.0.0.1",
                        "server.port",
                        "0",
                        "spring.main.banner-mode",
                        "off"));
        app.run(springArgs.toArray(String[]::new));
    }

    @EventListener
    void started(WebServerInitializedEvent e) {
        String url = "http://127.0.0.1:" + e.getWebServer().getPort() + "/";
        System.out.println("로컬 화면: " + url);
        if (openBrowser && Desktop.isDesktopSupported())
            try {
                Desktop.getDesktop().browse(URI.create(url));
            } catch (Exception ex) {
                System.err.println("브라우저를 열지 못했습니다: " + ex.getMessage());
            }
    }
}
