package org.localchurch.worship.ppt;

import org.apache.poi.sl.usermodel.VerticalAlignment;
import org.apache.poi.xslf.usermodel.*;

import java.awt.Dimension;
import java.awt.geom.Rectangle2D;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public class PptSample {
    public static void main(String[] args) throws Exception {
        // 이 실험을 위해 새로 쓴 문장. 실제 찬양 가사가 아닙니다.
        List<String> lines =
                List.of(
                        "고요한 아침 창가에",
                        "따뜻한 빛이 머물고",
                        "함께 걷는 이 길 위에",
                        "서로의 미소가 피어나네",
                        "오늘도 마음을 모아",
                        "새로운 하루를 맞이해");
        Path output = Path.of(args.length > 0 ? args[0] : "sample.pptx");
        writeSlides(List.of(lines), output);
    }

    public static void writeSlides(List<List<String>> sections, Path output) throws Exception {
        int expected = sections.stream().mapToInt(section -> (section.size() + 1) / 2).sum();
        try (XMLSlideShow deck = new XMLSlideShow()) {
            deck.setPageSize(new Dimension(960, 540));
            appendSlides(deck, sections);
            try (java.io.OutputStream out = Files.newOutputStream(output)) {
                deck.write(out);
            }
        }
        try (java.io.InputStream in = Files.newInputStream(output);
                XMLSlideShow deck = new XMLSlideShow(in)) {
            if (deck.getSlides().size() != expected
                    || deck.getPageSize().width != 960
                    || deck.getPageSize().height != 540) throw new IllegalStateException("검증 실패");
            System.out.println(
                    "생성 및 POI 재열기 성공: " + output.toAbsolutePath() + ", " + expected + "장, 16:9");
        }
    }

    public static void appendSlides(XMLSlideShow deck, List<List<String>> sections) {
        appendSlides(deck, sections, PptStyle.defaults());
    }

    public static void appendSlides(XMLSlideShow deck, List<List<String>> sections, PptStyle style) {
        double sx = deck.getPageSize().getWidth() / 960.0,
                sy = deck.getPageSize().getHeight() / 540.0;
        XSLFPictureData picture = style.backgroundImage() == null
                ? null : deck.addPicture(style.backgroundImage(), style.backgroundImageType());
        for (List<String> lines : sections)
            for (int i = 0; i < lines.size(); i += style.linesPerSlide()) {
                XSLFSlide slide = deck.createSlide();
                // getBackground()은 슬라이드에 배경이 없으면 공유 마스터를 반환한다.
                // 새 슬라이드의 배경을 먼저 만들어 기존 슬라이드의 마스터를 보존한다.
                slide.getXmlObject().getCSld().addNewBg();
                slide.getBackground().setFillColor(style.backgroundColor());
                if (picture != null) {
                    XSLFPictureShape background = slide.createPicture(picture);
                    background.setAnchor(new Rectangle2D.Double(0, 0,
                            deck.getPageSize().getWidth(), deck.getPageSize().getHeight()));
                }
                XSLFTextBox box = slide.createTextBox();
                box.setAnchor(new Rectangle2D.Double(60 * sx, 120 * sy, 840 * sx, 300 * sy));
                box.setVerticalAlignment(VerticalAlignment.MIDDLE);
                box.clearText();
                XSLFTextParagraph p = box.addNewTextParagraph();
                p.setTextAlign(style.alignment());
                XSLFTextRun run = p.addNewTextRun();
                run.setText(String.join("\n", lines.subList(i, Math.min(i + style.linesPerSlide(), lines.size()))));
                run.setFontFamily(style.fontFamily(), org.apache.poi.common.usermodel.fonts.FontGroup.LATIN);
                run.setFontFamily(style.fontFamily(), org.apache.poi.common.usermodel.fonts.FontGroup.EAST_ASIAN);
                run.setFontSize(style.fontSize() * Math.min(sx, sy));
                run.setFontColor(style.textColor());
                run.setBold(style.bold());
            }
    }
}
