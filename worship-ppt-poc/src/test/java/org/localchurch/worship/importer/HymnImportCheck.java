package org.localchurch.worship.importer;

import org.localchurch.worship.song.repository.SongStore;
import org.localchurch.worship.database.MySqlStore;
import java.nio.file.*;
import java.sql.*;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
public class HymnImportCheck {
 public static void main(String[] args)throws Exception {
  try(Connection c=MySqlStore.open(Path.of("/tmp/worship-hymn-test.properties"))){
   MySqlStore.init(c);SongStore.register(c,"기존 검증곡","","","","https://example.org/check","v1");
   long id=SongStore.search(c,"기존 검증곡",null).get(0).id();String words="[1절]\n테스트 첫 줄\n테스트 둘째 줄\n\n[후렴]\n새로운 시험 문장";SongStore.importText(c,id,words,true);
   HymnImport.run(c,Path.of(System.getProperty("user.home"), "Downloads", "bible.db"));HymnImport.run(c,Path.of(System.getProperty("user.home"), "Downloads", "bible.db"));
   if(SongStore.search(c,"1",null).size()!=1||!SongStore.search(c,"1",null).get(0).title().equals("만복의 근원 하나님"))throw new AssertionError("번호 검색");
   if(SongStore.search(c,"성부 성자와 성령",null).size()!=2)throw new AssertionError("동명 찬송가");
   if(!SongStore.byId(c,id).lyrics().equals(words))throw new AssertionError("기존 가사");
   try(Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM songs WHERE category='HYMN'")){r.next();if(r.getInt(1)!=645)throw new AssertionError("곡 수");}
   Path out=Files.createTempFile("hymn-check-", ".pptx");Files.delete(out);SongStore.ppt(c,id,out);try(var in=Files.newInputStream(out);var ppt=new XMLSlideShow(in)){if(ppt.getSlides().size()!=2)throw new AssertionError("PPT 구간");}Files.delete(out);
   System.out.println("MySQL 독립 DB 검증 성공: 645곡, 재실행, 번호/동명 검색, 기존 가사 보존, PPT");
  }
 }
}
