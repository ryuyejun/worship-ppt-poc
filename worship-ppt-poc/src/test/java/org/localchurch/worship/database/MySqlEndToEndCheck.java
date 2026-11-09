package org.localchurch.worship.database;

import org.localchurch.worship.song.repository.SongStore;
import org.localchurch.worship.song.SongRequests;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.apache.poi.xslf.usermodel.XMLSlideShow;

/** ユーザーの曲を変更せず、テスト専用レコードだけを作成後に削除する。 */
public class MySqlEndToEndCheck {
    static void check(boolean ok,String m){if(!ok)throw new AssertionError(m);}
    public static void main(String[] args)throws Exception {
        String suffix=UUID.randomUUID().toString(), title="DB確認"+suffix, source="https://example.org/temporary/"+suffix;
        Path out=Files.createTempFile("mysql-ppt-check-", ".pptx");Files.delete(out);
        try(Connection c=MySqlStore.open(Path.of(".server/mysql.properties"))) {
            MySqlStore.init(c);
            try {
                var a=SongRequests.searchOrRequest(c,title,"試験作者").request();
                var b=SongRequests.searchOrRequest(c,title,"試験作者").request();
                check(a.id()==b.id() && b.count()==2,"MySQL 요청 횟수 실패");
                int inserted=SongStore.register(c,title,"試験作者","試験作曲","試験歌手",source,"v1");
                check(inserted==1,"MySQL 곡 등록 실패");
                check(SongStore.register(c,title,"試験作者","試験作曲","試験歌手",source,"v1")==0,"MySQL 중복 등록");
                check(SongRequests.pending(c,title).isEmpty(),"MySQL 요청 자동 완료 실패");
                var song=SongStore.search(c,title,"試験作者").get(0);
                String words="[1절]\n임시 검증 문장 하나\n임시 검증 문장 둘\n";
                SongStore.importText(c,song.id(),words,true);
                check(SongStore.permission(c,song.id()).equals("UNKNOWN"),"가져온 가사의 권한 상태가 잘못 변경됨");
                SongStore.ppt(c,song.id(),out);
                try(var in=Files.newInputStream(out);var show=new XMLSlideShow(in)){check(show.getSlides().size()==1,"MySQL PPT 재열기 실패");}
                System.out.println("MySQL 테스트 성공: 검색 요청 2회, 중복 방지, 곡 등록·자동 완료·가상 가사 저장·PPT 재열기");
            } finally {
                try(PreparedStatement s=c.prepareStatement("DELETE FROM song_requests WHERE normalized_title=?")){s.setString(1,SongStore.normalize(title));s.executeUpdate();}
                try(PreparedStatement s=c.prepareStatement("DELETE FROM songs WHERE source_url=?")){s.setString(1,source);s.executeUpdate();}
                Files.deleteIfExists(out);
            }
        }
    }
}
