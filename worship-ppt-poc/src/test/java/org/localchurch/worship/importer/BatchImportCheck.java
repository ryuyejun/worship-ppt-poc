package org.localchurch.worship.importer;

import org.localchurch.worship.song.repository.SongStore;
import org.localchurch.worship.database.MySqlStore;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import org.apache.poi.xslf.usermodel.*;

public class BatchImportCheck {
  static void check(boolean b,String s){if(!b)throw new AssertionError(s);}
  public static void main(String[] args)throws Exception {
    Properties p=new Properties();try(var in=Files.newInputStream(Path.of(".server/mysql.properties"))){p.load(in);}
    String testDatabase=System.getenv().getOrDefault("BATCH_TEST_DB", "worship_batch_check_20261105");
    if (!testDatabase.matches("[A-Za-z0-9_]+")) throw new IllegalArgumentException("잘못된 테스트 DB 이름");
    p.setProperty("url",p.getProperty("url").replace("/worship_local?","/"+testDatabase+"?"));
    Properties o=new Properties();o.setProperty("user",p.getProperty("user"));o.setProperty("password",p.getProperty("password"));o.setProperty("useAffectedRows","true");
    Path d=Files.createTempDirectory("batch-import-test-");
    try(Connection c=DriverManager.getConnection(p.getProperty("url"),o)){
      MySqlStore.init(c);
      for(int i=1;i<=4;i++)SongStore.register(c,"샘플곡"+i,"테스트작가","테스트작곡","테스트가수","https://example.org/test/"+i,"v1");
      String words="[1절]\n새로운 아침 한 줄\n반가운 오늘 두 줄\n\n[후렴]\n따뜻한 마음\n";
      Files.writeString(d.resolve("샘플곡1.txt"),words,StandardCharsets.UTF_8);
      Files.writeString(d.resolve("두.csv"),"title,lyricist,lyrics\r\n샘플곡2,테스트작가,\"[1절]\nCSV 첫 줄\nCSV 둘째 줄\"\r\n",StandardCharsets.UTF_8);
      Files.writeString(d.resolve("셋.json"),"[{\"title\":\"샘플곡3\",\"lyricist\":\"테스트작가\",\"lyrics\":\"[후렴]\\nJSON 첫 줄\\nJSON 둘째 줄\"}]",StandardCharsets.UTF_8);
      try(XMLSlideShow deck=new XMLSlideShow()){
        var sl=deck.createSlide();var box=sl.createTextBox();box.setText("PPT 첫 줄\nPPT 둘째 줄");
        try(var out=Files.newOutputStream(d.resolve("샘플곡4.pptx"))){deck.write(out);}
      }
      BatchImport.lyrics(c,d);
      Path catalog=d.resolveSibling(d.getFileName()+"-catalog.json");
      Files.writeString(catalog,"[{\"title\":\"목록테스트\",\"lyricist\":\"작성자\",\"source\":\"https://example.org/verified\",\"version\":\"1\",\"category\":\"CCM\",\"aliases\":[\"별칭테스트\"]},{\"title\":\"별칭테스트\",\"source\":\"https://example.org/duplicate\",\"version\":\"1\",\"category\":\"CCM\"}]",StandardCharsets.UTF_8);
      BatchImport.catalog(c,catalog);
      check(SongStore.search(c,"별칭테스트",null).size()==1,"별칭 중복 방지 실패");
      BatchImport.catalog(c,catalog);
      check(SongStore.search(c,"목록테스트",null).size()==1,"반복 목록 수입 중복");
      for(int i=1;i<=4;i++){var songs=SongStore.search(c,"샘플곡"+i,"테스트작가");check(songs.size()==1&&songs.get(0).lyrics()!=null,"파일 수입 실패 "+i);check(SongStore.permission(c,songs.get(0).id()).equals("UNKNOWN"),"권한 자동승인 오류");}
      check(SongStore.search(c,"샘플곡1",null).get(0).lyrics().equals(words),"TXT 줄바꿈 변경");
      check(SongStore.search(c,"샘플곡4",null).get(0).lyrics().contains("PPT 첫 줄\nPPT 둘째 줄"),"PPT 줄바꿈 변경");
      BatchImport.lyrics(c,d);
      try(Statement s=c.createStatement();ResultSet r=s.executeQuery("select count(*) from lyric_import_audit")){r.next();check(r.getInt(1)==4,"중복 가사 수입");}
      System.out.println("TXT·CSV·JSON·PPTX 4곡 수입, 줄바꿈·권한 미확인·기존 가사 보존 성공");
    }
  }
}
