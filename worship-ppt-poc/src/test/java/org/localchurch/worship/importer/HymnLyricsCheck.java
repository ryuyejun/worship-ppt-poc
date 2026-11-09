package org.localchurch.worship.importer;

import org.localchurch.worship.song.repository.SongStore;
import org.localchurch.worship.database.MySqlStore;
import java.nio.file.*;
import java.sql.*;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
public class HymnLyricsCheck {
 public static void main(String[] args)throws Exception {
  try(Connection c=MySqlStore.open(Path.of("/tmp/worship-hymn-test.properties"))){
   var songs=SongStore.search(c,"1",null);if(songs.size()!=1||songs.get(0).lyrics()==null)throw new AssertionError("찬송가 검색 실패");
   Path p=Files.createTempFile("hymn-lyrics-check-", ".pptx");Files.delete(p);
   try{SongStore.ppt(c,songs.get(0).id(),p);try(var in=Files.newInputStream(p);var deck=new XMLSlideShow(in)){if(deck.getSlides().isEmpty())throw new AssertionError("슬라이드 없음");System.out.println("찬송가 1장 PPT 검증: "+deck.getSlides().size()+"장");}}finally{Files.deleteIfExists(p);}
  }
 }
}
