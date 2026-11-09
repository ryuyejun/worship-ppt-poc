package org.localchurch.worship.ppt;

import java.awt.Color;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.apache.poi.sl.usermodel.PictureData.PictureType;
import org.apache.poi.sl.usermodel.TextParagraph.TextAlign;
import org.localchurch.worship.ppt.dto.request.PptStyleRequest;

public record PptStyle(Color backgroundColor, Color textColor, String fontFamily,
                       int fontSize, TextAlign alignment, int linesPerSlide, boolean bold,
                       byte[] backgroundImage, PictureType backgroundImageType) {
    public static PptStyle defaults() {
        return new PptStyle(new Color(22, 35, 58), Color.WHITE, "Apple SD Gothic Neo",
                40, TextAlign.CENTER, 2, false, null, null);
    }

    public static PptStyle from(PptStyleRequest request) {
        if (request == null) return defaults();
        byte[] image = null;
        PictureType imageType = null;
        if (request.backgroundImageBase64() != null || request.backgroundImageType() != null) {
            if (request.backgroundImageBase64() == null || request.backgroundImageType() == null)
                throw new IllegalArgumentException("배경 이미지 형식을 확인해 주세요.");
            try {
                image = Base64.getDecoder().decode(request.backgroundImageBase64());
                if (image.length == 0 || image.length > 5_000_000) throw new IllegalArgumentException();
                try (ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(image))) {
                    Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
                    if (!readers.hasNext()) throw new IllegalArgumentException();
                    ImageReader reader = readers.next();
                    try {
                        reader.setInput(stream, true, true);
                        String format = reader.getFormatName();
                        int width = reader.getWidth(0), height = reader.getHeight(0);
                        if (!format.equalsIgnoreCase(request.backgroundImageType()) || width < 1 || height < 1
                                || width > 10000 || height > 10000 || (long) width * height > 40_000_000)
                            throw new IllegalArgumentException();
                    } finally {
                        reader.dispose();
                    }
                }
                imageType = PictureType.valueOf(request.backgroundImageType());
            } catch (RuntimeException | IOException exception) {
                throw new IllegalArgumentException("배경 이미지는 5MB 이하의 올바른 PNG 또는 JPEG 파일이어야 합니다.");
            }
        }
        return new PptStyle(Color.decode(request.backgroundColor()), Color.decode(request.textColor()),
                request.fontFamily().trim(), request.fontSize(), TextAlign.valueOf(request.alignment()),
                request.linesPerSlide(), request.bold(), image, imageType);
    }
}
