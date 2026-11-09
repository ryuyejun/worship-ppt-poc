package org.localchurch.worship.ppt;
import org.localchurch.worship.song.repository.SongStore;
import java.nio.file.*;
import java.io.*;
import java.sql.*;
import java.awt.Dimension;
import java.util.*;
import org.apache.poi.xslf.usermodel.*;
public class PptBatchCheck {
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  Path dir=Files.createTempDirectory("ppt-batch-test-");
  try(Connection c=SongStore.open(dir.resolve("test.sqlite"))){
   for(int i=1;i<=2;i++){
    SongStore.register(c,"테스트곡"+i,"작가","","","https://example.org/"+i,"v1");long id=SongStore.search(c,"테스트곡"+i,null).get(0).id();
    SongStore.importText(c,id,"[1절]\n창작 문장 "+i+"\n다음 문장\n\n[후렴]\n후렴 "+i,true);
   }
   long one=SongStore.search(c,"테스트곡1",null).get(0).id(),two=SongStore.search(c,"테스트곡2",null).get(0).id();
   byte[] original;try(var deck=new XMLSlideShow();var out=new ByteArrayOutputStream()){
    deck.setPageSize(new Dimension(800,600));var slide=deck.createSlide();slide.createTextBox().setText("기존 슬라이드 보존");deck.write(out);original=out.toByteArray();
   }
   byte[] result=PptBatch.create(c,List.of(two,one),original);
   try(var deck=new XMLSlideShow(new ByteArrayInputStream(result))){
    check(deck.getPageSize().equals(new Dimension(800,600)),"기존 크기");check(deck.getSlides().size()==5,"슬라이드 수");
    check(((XSLFTextShape)deck.getSlides().get(0).getShapes().get(0)).getText().contains("기존 슬라이드 보존"),"기존 슬라이드");
    check(((XSLFTextShape)deck.getSlides().get(1).getShapes().get(0)).getText().contains("창작 문장 2"),"선택 순서");
    check(((XSLFTextShape)deck.getSlides().get(3).getShapes().get(0)).getText().contains("창작 문장 1"),"선택 순서 2");
   }
   byte[] fresh=PptBatch.create(c,List.of(one,two),null);try(var d=new XMLSlideShow(new ByteArrayInputStream(fresh))){check(d.getSlides().size()==4,"새 PPT");}
   SongStore.register(c,"가사없는곡","","","","https://example.org/empty","v1");long no=SongStore.search(c,"가사없는곡",null).get(0).id();
   try{PptBatch.create(c,List.of(one,no),null);throw new AssertionError("가사 없는 곡");}catch(IllegalArgumentException expected){}
   System.out.println("기존 PPT 보존, 4:3 크기, 두 곡 순서, 새 PPT 및 가사 없는 곡 거부 검증 성공");
  }
 }
}
