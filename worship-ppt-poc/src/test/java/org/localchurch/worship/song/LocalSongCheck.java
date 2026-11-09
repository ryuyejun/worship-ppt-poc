package org.localchurch.worship.song;

import org.localchurch.worship.song.repository.SongStore;


import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.text.Normalizer;
import java.util.*;
import org.apache.poi.xslf.usermodel.*;

public class LocalSongCheck {
    static void require(boolean ok,String message) { if(!ok) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        Path dir=Files.createTempDirectory("single-song-poc-"); Path db=dir.resolve("test.sqlite3");
        Path txt=dir.resolve("original-placeholder.txt"), ppt=dir.resolve("original-placeholder.pptx");
        String content="[1절]\n창가에 아침이 찾아와\n따뜻한 하루를 열어요\n\n[후렴]\n함께 걷는 이 길에서\n서로의 미소를 나눠요\n";
        Files.writeString(txt,content,StandardCharsets.UTF_8);
        try(Connection c=SongStore.open(db)) { SongStore.seed(c); }
        long sampleId;
        try(Connection c=SongStore.open(db)) {
            var targets=SongStore.search(c,Normalizer.normalize("소중해   존귀해보배로워",Normalizer.Form.NFD),"송 예 운");
            require(targets.size()==1 && targets.get(0).lyrics()==null && targets.get(0).status().equals("PENDING"),"대상 저장·검색 실패");
            SongStore.seed(c);
            require(SongStore.search(c,SongStore.TARGET,null).size()==1,"반복 초기화 중복");
            try (PreparedStatement s=c.prepareStatement("INSERT INTO songs(title,normalized_title,lyricist,composer,artist,source_url,version,lyrics_status,copyright_info) VALUES('x','x','x','x','x',?,'하나님 나라의 노래 (2026)','PENDING','x')")) {
                s.setString(1,SongStore.SOURCE);
                try {s.executeUpdate();throw new AssertionError("중복 허용");} catch(SQLException expected) {require(expected.getErrorCode()==19,"예상 밖 SQL 오류");}
            }
            try {SongStore.ppt(c,targets.get(0).id(),dir.resolve("pending.pptx"));throw new AssertionError("미확인 가사로 PPT 생성");}
            catch(IllegalStateException expected){require(!Files.exists(dir.resolve("pending.pptx")),"빈 PPT 생성됨");}
            try(PreparedStatement s=c.prepareStatement("INSERT INTO songs(title,normalized_title,lyricist,composer,artist,source_url,version,lyrics_status,copyright_info) VALUES(?,?,?,?,?,?,?,'PENDING',?)")) {
                s.setString(1,"창작 예시 노래 (테스트)");s.setString(2,SongStore.normalize("창작 예시 노래 (테스트)"));s.setString(3,"가상 작가");s.setString(4,"가상 작곡가");s.setString(5,"테스트");s.setString(6,"test:original");s.setString(7,"test");s.setString(8,"테스트를 위해 작성한 문장");s.executeUpdate();
            }
            sampleId=SongStore.search(c,"창작 예시 노래 (테스트)","가상 작가").get(0).id();
            try {SongStore.importLyrics(c,sampleId,txt,false);throw new AssertionError("권한 선언 없이 저장");} catch(IllegalArgumentException expected){}
            SongStore.importLyrics(c,sampleId,txt,true);
            require(SongStore.register(c,"메타데이터 실험곡","가상 작가","가상 작곡가","가상 가수","https://example.org/test-song","1") == 1, "메타데이터 등록 실패");
            require(SongStore.register(c,"메타데이터 실험곡","가상 작가","가상 작곡가","가상 가수","https://example.org/test-song","1") == 0, "중복 등록 실패");
            var imported = SongStore.search(c,"메타데이터 실험곡",null).get(0);
            require(imported.lyrics() == null && imported.status().equals("PENDING"), "가사 없는 상태 오류");
            SongStore.importText(c,imported.id(),content,true);
            require(content.equals(SongStore.byId(c,imported.id()).lyrics()),"직접 제공 텍스트 보존 실패");
        }
        try(Connection c=SongStore.open(db)) {
            var sample=SongStore.byId(c,sampleId); require(content.equals(sample.lyrics()),"원문 보존 실패");
            var parts=SongStore.sections(sample.lyrics());require(parts.size()==2 && parts.get(0).size()==2 && parts.get(1).size()==2,"절 구조 실패");
            SongStore.ppt(c,sampleId,ppt);
            try(var in=Files.newInputStream(ppt);var deck=new XMLSlideShow(in)) {
                require(deck.getSlides().size()==2,"슬라이드 수 오류");
                List<String> actual=new ArrayList<>();
                for(XSLFSlide slide:deck.getSlides()) for(XSLFShape shape:slide.getShapes()) if(shape instanceof XSLFTextShape text) actual.addAll(Arrays.asList(text.getText().split("\\R")));
                require(actual.equals(parts.stream().flatMap(List::stream).toList()),"PPT 가사 불일치");
            }
            var target=SongStore.search(c,SongStore.TARGET,"송예운").get(0);
            require(target.lyrics()==null && target.status().equals("PENDING"),"실곡 데이터 오염");
        }
        System.out.println("검증 성공: 재열기·NFD/공백 검색·중복 차단·메타데이터 등록·TXT/직접 제공 가사 수입·구간 보존·PPT 텍스트 일치");
        System.out.println("테스트 결과(가상 문장): " + dir);
    }
}
