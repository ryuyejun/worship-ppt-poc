package org.localchurch.worship.ppt;

import org.localchurch.worship.song.entity.Song;

import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.localchurch.worship.song.repository.SongStore;

import java.awt.Dimension;
import java.io.*;
import java.sql.Connection;
import java.util.*;

/** 요청 순서의 곡을 기존 프레젠테이션 끝에 추가한다. */
public final class PptBatch {
    public static byte[] create(Connection c, List<Long> ids, byte[] original) throws Exception {
        if (ids.isEmpty() || ids.size() > 100)
            throw new IllegalArgumentException("곡을 1곡 이상 100곡 이하로 선택하세요.");
        List<Song> songs = new ArrayList<>();
        for (long id : ids) songs.add(SongStore.byId(c, id));
        return createFromSongs(songs, original);
    }

    public static byte[] createFromSongs(List<Song> songs, byte[] original)
            throws Exception {
        return createFromSongs(songs, original, PptStyle.defaults());
    }

    public static byte[] createFromSongs(List<Song> songs, byte[] original, PptStyle style)
            throws Exception {
        if (songs.isEmpty() || songs.size() > 100)
            throw new IllegalArgumentException("곡을 1곡 이상 100곡 이하로 선택하세요.");
        List<List<String>> sections = new ArrayList<>();
        for (Song song : songs) {
            if (!song.status().equals("USER_SUPPLIED")
                    || song.lyrics() == null
                    || song.lyrics().isBlank())
                throw new IllegalArgumentException("가사가 없는 곡입니다: " + song.title());
            List<List<String>> parsed = SongStore.sections(song.lyrics());
            if (parsed.isEmpty())
                throw new IllegalArgumentException("가사를 읽을 수 없습니다: " + song.title());
            sections.addAll(parsed);
        }
        try (XMLSlideShow deck =
                        original == null
                                ? new XMLSlideShow()
                                : new XMLSlideShow(new ByteArrayInputStream(original));
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (original == null) deck.setPageSize(new Dimension(960, 540));
            PptSample.appendSlides(deck, sections, style);
            deck.write(out);
            return out.toByteArray();
        }
    }
}
