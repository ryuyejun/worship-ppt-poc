package org.localchurch.worship.song;

import org.localchurch.worship.song.repository.SongStore;


import java.nio.file.*;
import java.sql.*;
import java.text.Normalizer;

public class SongRequestsCheck {
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception {
        Path db=Files.createTempDirectory("queue-check-").resolve("db.sqlite3");
        // 이전 스키마와 정정 대상 기록을 그대로 재현해 마이그레이션을 검증한다.
        try(Connection c=DriverManager.getConnection("jdbc:sqlite:"+db);Statement s=c.createStatement()){
            s.execute("CREATE TABLE songs(id INTEGER PRIMARY KEY,title TEXT NOT NULL,normalized_title TEXT NOT NULL,lyricist TEXT NOT NULL,composer TEXT NOT NULL,artist TEXT NOT NULL,lyrics TEXT,source_url TEXT NOT NULL,version TEXT NOT NULL,lyrics_status TEXT NOT NULL,copyright_info TEXT NOT NULL,UNIQUE(source_url,version))");
            try(PreparedStatement p=c.prepareStatement("INSERT INTO songs VALUES(1,?,?,?,?,?,?,?,?,?,?)")){
                p.setString(1,SongStore.TARGET);p.setString(2,SongStore.normalize(SongStore.TARGET));p.setString(3,"송예운");p.setString(4,"조미진");p.setString(5,"파이디온선교회");p.setString(6,"보존 테스트 문장");p.setString(7,SongStore.SOURCE);p.setString(8,"하나님 나라의 노래 (2026)");p.setString(9,"USER_SUPPLIED");p.setString(10,"사용자가 권리자에게 허가를 받았다고 확인함; 가사 출처 파이디온스퀘어; 허가 범위·기한 문서 미확인");p.executeUpdate();
            }
        }
        try(Connection c=SongStore.open(db)) {
            var target=SongStore.byId(c,1);check(target.title().equals(SongStore.TARGET)&&target.lyrics().equals("보존 테스트 문장")&&SongStore.permission(c,1).equals("UNKNOWN"),"허가 수정 또는 기존 자료 보존 실패");
            check(!SongRequests.searchOrRequest(c,SongStore.TARGET,"송예운").songs().isEmpty(),"기존 곡 미검출");check(SongRequests.pending(c,"").isEmpty(),"기존 곡 대기열 등록됨");
            var first=SongRequests.searchOrRequest(c," 새  노래 ","작가 가").request();check(first.count()==1,"최초 요청 실패");
            var second=SongRequests.searchOrRequest(c,Normalizer.normalize("새노래",Normalizer.Form.NFD),"작가가").request();check(second.id()==first.id()&&second.count()==2,"정규화·중복 실패");
            var other=SongRequests.searchOrRequest(c,"새노래","작가 나").request();check(other.id()!=first.id(),"서로 다른 작사자 통합됨");
            var unknown=SongRequests.searchOrRequest(c,"새노래","").request();check(unknown.id()!=other.id()&&unknown.id()!=first.id(),"미상 작사자 통합됨");
            check(SongRequests.pending(c,"작가 가").size()==1,"대기열 검색 실패");
        }
        try(Connection c=SongStore.open(db)) {
            check(SongRequests.pending(c,"").size()==3,"재실행 후 대기열 유실");
            SongStore.register(c,"새 노래","작가 가","작곡가","가수","https://example.org/a","v1");
            check(SongRequests.pending(c,"").size()==1&&SongRequests.pending(c,"").get(0).lyricist().equals("작가 나"),"일치하는 요청의 자동 완료 실패");
            long songId=SongStore.search(c,"새 노래","작가 가").get(0).id();
            long otherId=SongRequests.pending(c,"").get(0).id();SongRequests.complete(c,otherId,songId);
            try(PreparedStatement s=c.prepareStatement("SELECT status,song_id FROM song_requests WHERE id=?")){s.setLong(1,otherId);try(ResultSet r=s.executeQuery()){check(r.next()&&r.getString(1).equals("COMPLETED")&&r.getLong(2)==songId,"수동 연결 완료 실패");}}
        }
        System.out.println("대기열 검증 성공: 실제 검색·횟수·정규화·작사자 분리·재열기·자동/수동 완료·허가 정정 및 데이터 보존");
    }
}
