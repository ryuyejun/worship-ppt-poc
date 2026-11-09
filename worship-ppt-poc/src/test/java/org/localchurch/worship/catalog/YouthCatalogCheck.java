package org.localchurch.worship.catalog;

import org.localchurch.worship.song.repository.SongStore;
import org.localchurch.worship.database.MySqlStore;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
public class YouthCatalogCheck {
  static void check(boolean ok,String msg){if(!ok)throw new AssertionError(msg);}
  public static void main(String[] args)throws Exception{
    Properties p=new Properties();try(var in=Files.newInputStream(Path.of(".server/mysql.properties"))){p.load(in);}
    Properties opts=new Properties();opts.setProperty("user",p.getProperty("user"));opts.setProperty("password",p.getProperty("password"));opts.setProperty("useAffectedRows","true");
    String testDatabase=System.getenv().getOrDefault("CATALOG_TEST_DB", "worship_youth_check_20261105");
    if (!testDatabase.matches("[A-Za-z0-9_]+")) throw new IllegalArgumentException("잘못된 테스트 DB 이름");
    String url=p.getProperty("url").replace("/worship_local?","/"+testDatabase+"?");
    Path json=Files.createTempFile("youth-curation-check-", ".json");
    Files.writeString(json,"[{\"title\":\"기존곡\",\"performer\":\"테스트팀\",\"priority\":\"HIGH\",\"sources\":[\"https://kccm.app/chart\"],\"aliases\":[\"별명\"]},{\"title\":\"새 노래\",\"performer\":\"테스트팀\",\"priority\":\"MEDIUM\",\"sources\":[\"https://example.org/catalog\"],\"aliases\":[]}]");
    try(Connection c=DriverManager.getConnection(url,opts)){
      MySqlStore.init(c);
      if ("1".equals(System.getenv("CATALOG_PREEXISTING"))) {
        org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(c, new org.springframework.core.io.ClassPathResource("db/catalog-migration/V1__create_youth_catalog.sql"));
        SongStore.register(c,"기존 카탈로그 보존곡","","","테스트팀","https://example.org/preserved","1");
        long preservedId=SongStore.search(c,"기존 카탈로그 보존곡",null).get(0).id();
        try (PreparedStatement statement=c.prepareStatement("INSERT INTO youth_catalog VALUES(?, 'LOW', 99, '보존 검증', '2026-11-05')")) {
          statement.setLong(1,preservedId); statement.executeUpdate();
        }
      }
      YouthCatalog.init(c);
      YouthCatalog.init(c);
      if ("1".equals(System.getenv("CATALOG_PREEXISTING"))) {
        try (Statement statement=c.createStatement(); ResultSet result=statement.executeQuery("SELECT COUNT(*) FROM youth_catalog WHERE notes='보존 검증'")) {
          result.next(); check(result.getInt(1)==1,"마이그레이션으로 기존 카탈로그가 변경됨");
        }
      }
      SongStore.register(c,"기존곡","","","","https://example.org/existing","1");long id=SongStore.search(c,"기존곡",null).get(0).id();
      try(PreparedStatement s=c.prepareStatement("INSERT INTO song_aliases(song_id,alias,normalized_alias) VALUES(?,?,?)")){s.setLong(1,id);s.setString(2,"별명");s.setString(3,SongStore.normalize("별명"));s.executeUpdate();}
      SongStore.importText(c,id,"보존할 창작 문장",true);
      try (var context=YouthCatalog.createContext(c)) {
      var catalog=context.getBean(org.localchurch.worship.catalog.service.YouthCatalogService.class);
      check(catalog.ingest(json)==1,"신규 곡 수 오류");
      var existing=SongStore.byId(c,id);check(existing.lyrics().equals("보존할 창작 문장")&&existing.source().equals("https://example.org/existing")&&existing.artist().equals("테스트팀"),"기존 데이터 보존 실패");
      check(catalog.ingest(json)==0,"재실행 중복");
      try(Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM youth_catalog_evidence")){r.next();check(r.getInt(1)==2,"출처 중복");}
      Files.writeString(json,"[{\"title\":\"롤백 시험곡\",\"performer\":\"테스트팀\",\"priority\":\"HIGH\",\"sources\":[\"https://kccm.app/chart\"],\"aliases\":[]},{\"title\":\"잘못된 시험곡\",\"performer\":\"테스트팀\",\"priority\":\"HIGH\",\"sources\":[\"invalid-url\"],\"aliases\":[]}]");
      try { catalog.ingest(json); throw new AssertionError("잘못된 출처가 허용됨"); }
      catch (IllegalArgumentException expected) { }
      check(SongStore.search(c,"롤백 시험곡",null).isEmpty(),"실패 시 곡 등록이 롤백되지 않음");
      }
      System.out.println("큐레이션 검증 성공: 기존 가사·출처 보존, 별칭 매칭, 신규 등록, 재실행 중복 방지");
    }finally{Files.deleteIfExists(json);}
  }
}
