package org.localchurch.worship.ppt.service;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.ppt.PptBatch;
import org.localchurch.worship.ppt.PptStyle;
import org.localchurch.worship.ppt.dto.request.PptStyleRequest;
import org.localchurch.worship.ppt.dto.request.PptBatchRequest;
import org.localchurch.worship.ppt.dto.response.PptPreviewResponse;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.localchurch.worship.song.entity.Song;
import org.localchurch.worship.song.repository.SongRepository;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.util.*;

@Service
@RequiredArgsConstructor
public class PptService {
    private final SongRepository repository;

    public byte[] single(long id) throws Exception {
        return create(List.of(id), null, null);
    }

    public PptPreviewResponse preview(PptBatchRequest input, int requestedIndex) throws Exception {
        byte[] presentation = create(input.songIds(), input.pptxBase64(), input.style());
        try (XMLSlideShow deck = new XMLSlideShow(new ByteArrayInputStream(presentation));
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            int count = deck.getSlides().size();
            if (count == 0) throw new IllegalArgumentException("미리 볼 슬라이드가 없습니다.");
            int index = Math.min(requestedIndex, count - 1);
            Dimension page = deck.getPageSize();
            if (page.width <= 0 || page.height <= 0)
                throw new IllegalArgumentException("PPT의 슬라이드 크기를 확인해 주세요.");
            double scale = Math.min(1280.0 / page.width, 1280.0 / page.height);
            int width = Math.max(1, (int) Math.round(page.width * scale));
            int height = Math.max(1, (int) Math.round(page.height * scale));
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            Graphics2D graphics = image.createGraphics();
            try {
                graphics.setColor(Color.WHITE);
                graphics.fillRect(0, 0, width, height);
                graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
                graphics.scale((double) width / page.width, (double) height / page.height);
                deck.getSlides().get(index).draw(graphics);
            } finally {
                graphics.dispose();
            }
            ImageIO.write(image, "png", output);
            return new PptPreviewResponse(Base64.getEncoder().encodeToString(output.toByteArray()), index, count);
        }
    }

    public byte[] create(List<Long> ids, String encoded, PptStyleRequest style) throws Exception {
        if (ids == null || ids.isEmpty() || ids.size() > 100)
            throw new IllegalArgumentException("곡을 1곡 이상 100곡 이하로 선택하세요.");
        if (ids.stream().anyMatch(id -> id == null || id < 1))
            throw new IllegalArgumentException("곡 ID를 확인하세요.");
        byte[] original = null;
        if (encoded != null) {
            if (encoded.length() > 26_666_668)
                throw new IllegalArgumentException("PPTX는 20MB 이하여야 합니다.");
            try {
                original = Base64.getDecoder().decode(encoded);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("PPTX 파일을 읽을 수 없습니다.");
            }
            if (original.length == 0 || original.length > 20_000_000)
                throw new IllegalArgumentException("PPTX는 20MB 이하여야 합니다.");
        }
        try {
            List<Song> songs = ids.stream().map(id -> repository.findById(id)
                    .orElseThrow(() -> new IllegalArgumentException("해당 ID가 없습니다: " + id))).toList();
            if (songs.stream().anyMatch(song -> song.lyrics() == null || song.lyrics().isBlank()))
                throw new IllegalArgumentException("가사가 저장된 곡만 PPT를 만들 수 있습니다.");
            return PptBatch.createFromSongs(songs, original, PptStyle.from(style));
        } catch (org.apache.poi.openxml4j.exceptions.NotOfficeXmlFileException | IOException e) {
            throw new IllegalArgumentException("올바른 PPTX 파일을 선택하세요.");
        }
    }
}
