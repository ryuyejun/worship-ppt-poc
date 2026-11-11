package org.localchurch.worship.web;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import tools.jackson.databind.ObjectMapper;
import org.localchurch.worship.global.config.localaccess.LocalAccessToken;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.nio.file.*;
import java.sql.Connection;
import java.util.*;
import org.junit.jupiter.api.*;
import org.localchurch.worship.song.repository.SongStore;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import java.io.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(classes=LocalWeb.class) @AutoConfigureMockMvc
class LocalWebIntegrationTest {
 @Autowired MockMvc mvc; @Autowired ObjectMapper json; @Autowired LocalAccessToken token;
 static long id1,id2,id3,id4;
 static final Path TEST_DB=createTestDb();
 static Path createTestDb(){try{return Files.createTempDirectory("spring-worship-test-").resolve("test.sqlite");}catch(IOException e){throw new java.io.UncheckedIOException(e);}}
 @DynamicPropertySource static void properties(DynamicPropertyRegistry registry){registry.add("worship.sqlite.path",()->TEST_DB.toString());}
 @BeforeAll static void setup()throws Exception {
  try(Connection c=SongStore.open(TEST_DB)){
   for(int i=1;i<=2;i++){
    String title="독립 테스트곡 "+i;SongStore.register(c,title,"작가","","","https://example.org/spring/"+i,"v1");
    long id=SongStore.search(c,title,null).get(0).id();SongStore.importText(c,id,"[1절]\n새로운 시험 문장 "+i+"\n다른 시험 문장",true);if(i==1)id1=id;else id2=id;
   }
   SongStore.register(c,"가져오기 검증곡","작가","","","https://example.org/import","v1");
   id3=SongStore.search(c,"가져오기 검증곡",null).get(0).id();
   SongStore.register(c,"가사 미등록 확인곡","작가","","","https://example.org/empty","v1");
   id4=SongStore.search(c,"가사 미등록 확인곡",null).get(0).id();
  }
 }
 org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request(String path,String body){return post(path).contentType(MediaType.APPLICATION_JSON).header("X-Local-Token",token.value()).content(body);}
 @Test void pageAndToken()throws Exception{
  mvc.perform(get("/")).andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"root\"")));
  mvc.perform(get("/local-token.js")).andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString(token.value())));
  mvc.perform(post("/songs").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isForbidden()).andExpect(jsonPath("$.success").value(false)).andExpect(jsonPath("$.error").exists());
  mvc.perform(get("/logo.png")).andExpect(status().isOk());
 }
 @Test void searchAndQueue()throws Exception{
  mvc.perform(request("/search","{\"title\":\"독립 테스트곡 1\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true)).andExpect(jsonPath("$.data[0].id").value(id1));
  mvc.perform(request("/ppt-songs","{}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(org.hamcrest.Matchers.greaterThanOrEqualTo(2))).andExpect(jsonPath("$.data[*].status",org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.equalTo("USER_SUPPLIED")))).andExpect(jsonPath("$.data[*].id",org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem((int)id4))));
  mvc.perform(request("/search","{\"title\":\"없는테스트곡\"}")).andExpect(status().isOk()).andExpect(header().string("X-Request-Count","1"));
  mvc.perform(request("/requests","{}" )).andExpect(status().isOk()).andExpect(jsonPath("$.data[0].title").value("없는테스트곡"));
  mvc.perform(request("/search","{\"title\":\"가사 미등록 확인곡\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0)).andExpect(header().string("X-Request-Count","1"));
 }
 @Test void batchPreservesSlidesAndOrder()throws Exception{
  byte[] original;try(var deck=new XMLSlideShow();var out=new ByteArrayOutputStream()){deck.createSlide().createTextBox().setText("기존 테스트 슬라이드");deck.write(out);original=out.toByteArray();}
  String request=json.writeValueAsString(Map.of("songIds",List.of(id2,id1),"pptxBase64",Base64.getEncoder().encodeToString(original)));
  byte[] body=mvc.perform(request("/ppt/batch",request)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
  try(var deck=new XMLSlideShow(new ByteArrayInputStream(body))){assertEquals(3,deck.getSlides().size());assertTrue(((org.apache.poi.xslf.usermodel.XSLFTextShape)deck.getSlides().get(0).getShapes().get(0)).getText().contains("기존 테스트"));assertTrue(((org.apache.poi.xslf.usermodel.XSLFTextShape)deck.getSlides().get(1).getShapes().get(0)).getText().contains("2"));}
  mvc.perform(request("/ppt/batch","{\"songIds\":["+id1+"],\"pptxBase64\":\"bm90IHBwdA==\"}")).andExpect(status().isBadRequest());
  mvc.perform(request("/ppt/batch","{\"songIds\":[1.5]}")).andExpect(status().isBadRequest());
 }
 @Test void temporaryExternalLyricsCanBePreviewedAndExported() throws Exception {
  Map<String,Object> external=Map.of("id",-123,"title","원본 테스트 노래","artist","테스트","lyrics","테스트 한 줄\n또 다른 줄");
  Map<String,Object> presentation=Map.of("songIds",List.of(id1,-123),"externalSongs",List.of(external));
  String body=json.writeValueAsString(presentation);
  byte[] bytes=mvc.perform(request("/ppt/batch",body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
  try(var deck=new XMLSlideShow(new ByteArrayInputStream(bytes))) {
   assertEquals(2,deck.getSlides().size());
   assertTrue(((org.apache.poi.xslf.usermodel.XSLFTextShape)deck.getSlides().get(1).getShapes().get(0)).getText().contains("테스트 한 줄"));
  }
  mvc.perform(request("/ppt/preview",json.writeValueAsString(Map.of("presentation",presentation,"slideIndex",1))))
   .andExpect(status().isOk()).andExpect(jsonPath("$.data.slideIndex").value(1));
  mvc.perform(request("/ppt/batch","{\"songIds\":[-123]}" )).andExpect(status().isBadRequest());
 }
 @Test void providersWithoutCredentialsAreReportedWithoutBlocking() throws Exception {
  mvc.perform(request("/providers/search", "{\"title\":\"독립 테스트곡\"}"))
   .andExpect(status().isOk()).andExpect(jsonPath("$.data.candidates.length()").value(0))
   .andExpect(jsonPath("$.data.status.length()").value(2));
 }
 @Test void singlePptAndImportValidation()throws Exception{
  mvc.perform(request("/ppt","{\"id\":"+id1+"}")).andExpect(status().isOk()).andExpect(content().contentType("application/vnd.openxmlformats-officedocument.presentationml.presentation"));
  mvc.perform(request("/batch-import","{\"files\":[]}")).andExpect(status().isBadRequest());
  mvc.perform(request("/batch-import","{\"files\":[{\"name\":\"  \",\"data\":\"YQ==\"}]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.success").value(false));
  mvc.perform(request("/batch-import","{\"files\":[{\"name\":\"test.txt\",\"data\":null}]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.success").value(false));
  mvc.perform(request("/search","{\"title\":\"   \"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.success").value(false)).andExpect(jsonPath("$.error").exists());
 }
 @Test void customSlideStyleAndBackgroundImage() throws Exception {
  Map<String,Object> style=new LinkedHashMap<>();
  style.put("backgroundColor","#a1b2c3");style.put("textColor","#112233");style.put("fontFamily","Arial");
  style.put("fontSize",32);style.put("alignment","LEFT");style.put("linesPerSlide",1);style.put("bold",true);
  String body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style));
  byte[] result=mvc.perform(request("/ppt/batch",body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
  try(var deck=new XMLSlideShow(new ByteArrayInputStream(result))){
   assertEquals(2,deck.getSlides().size());
   var slide=deck.getSlides().get(0);assertEquals(new java.awt.Color(0xa1b2c3),slide.getBackground().getFillColor());
   var box=(org.apache.poi.xslf.usermodel.XSLFTextShape)slide.getShapes().get(0);
   var paragraph=box.getTextParagraphs().get(0);var run=paragraph.getTextRuns().get(0);
   assertEquals(org.apache.poi.sl.usermodel.TextParagraph.TextAlign.LEFT,paragraph.getTextAlign());
   assertEquals("Arial",run.getFontFamily());assertEquals(32.0,run.getFontSize());assertTrue(run.isBold());
   assertEquals(new java.awt.Color(0x112233),((org.apache.poi.sl.usermodel.PaintStyle.SolidPaint)run.getFontColor()).getSolidColor().getColor());
  }
  byte[] original;
  try(var deck=new XMLSlideShow();var bytes=new ByteArrayOutputStream()){
   var slide=deck.createSlide();slide.getBackground().setFillColor(java.awt.Color.RED);slide.createTextBox().setText("기존 슬라이드");deck.write(bytes);original=bytes.toByteArray();
  }
  body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style,"pptxBase64",Base64.getEncoder().encodeToString(original)));
  result=mvc.perform(request("/ppt/batch",body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
  try(var deck=new XMLSlideShow(new ByteArrayInputStream(result))){
   assertEquals(3,deck.getSlides().size());assertEquals(java.awt.Color.RED,deck.getSlides().get(0).getBackground().getFillColor());
   assertEquals(new java.awt.Color(0xa1b2c3),deck.getSlides().get(1).getBackground().getFillColor());
  }
  java.awt.image.BufferedImage image=new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB);
  ByteArrayOutputStream imageBytes=new ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",imageBytes);
  style.put("backgroundImageBase64",Base64.getEncoder().encodeToString(imageBytes.toByteArray()));style.put("backgroundImageType","PNG");
  body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style));
  result=mvc.perform(request("/ppt/batch",body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
  try(var deck=new XMLSlideShow(new ByteArrayInputStream(result))){assertTrue(deck.getSlides().get(0).getShapes().get(0) instanceof org.apache.poi.xslf.usermodel.XSLFPictureShape);}
  String previewBody=json.writeValueAsString(Map.of("presentation",Map.of("songIds",List.of(id1),"style",style),"slideIndex",0));
  String previewResponse=mvc.perform(request("/ppt/preview",previewBody)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
  byte[] previewImage=Base64.getDecoder().decode(json.readTree(previewResponse).path("data").path("imageBase64").asText());
  assertEquals(0,javax.imageio.ImageIO.read(new ByteArrayInputStream(previewImage)).getRGB(2,2)&0xffffff);
  imageBytes.reset();javax.imageio.ImageIO.write(image,"jpeg",imageBytes);
  style.put("backgroundImageBase64",Base64.getEncoder().encodeToString(imageBytes.toByteArray()));style.put("backgroundImageType","JPEG");
  body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style));mvc.perform(request("/ppt/batch",body)).andExpect(status().isOk());
  style.put("backgroundImageBase64",Base64.getEncoder().encodeToString("not an image".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style));mvc.perform(request("/ppt/batch",body)).andExpect(status().isBadRequest());
  style.remove("backgroundImageBase64");style.remove("backgroundImageType");style.put("fontSize",101);
  body=json.writeValueAsString(Map.of("songIds",List.of(id1),"style",style));mvc.perform(request("/ppt/batch",body)).andExpect(status().isBadRequest());
 }
 @Test void previewUsesTheGeneratedSlidesAndSupportsNavigation() throws Exception {
  Map<String,Object> style=new LinkedHashMap<>();
  style.put("backgroundColor","#a1b2c3");style.put("textColor","#112233");style.put("fontFamily","Arial");
  style.put("fontSize",32);style.put("alignment","CENTER");style.put("linesPerSlide",1);style.put("bold",false);
  Map<String,Object> presentation=Map.of("songIds",List.of(id1),"style",style);
  String requestBody=json.writeValueAsString(Map.of("presentation",presentation,"slideIndex",0));
  String response=mvc.perform(request("/ppt/preview",requestBody)).andExpect(status().isOk())
    .andExpect(jsonPath("$.data.slideCount").value(2)).andExpect(jsonPath("$.data.slideIndex").value(0))
    .andReturn().getResponse().getContentAsString();
  byte[] imageBytes=Base64.getDecoder().decode(json.readTree(response).path("data").path("imageBase64").asText());
  var image=javax.imageio.ImageIO.read(new ByteArrayInputStream(imageBytes));
  assertEquals(1280,image.getWidth());assertEquals(720,image.getHeight());
  assertEquals(0xa1b2c3,image.getRGB(2,2)&0xffffff);
  requestBody=json.writeValueAsString(Map.of("presentation",presentation,"slideIndex",99));
  mvc.perform(request("/ppt/preview",requestBody)).andExpect(status().isOk()).andExpect(jsonPath("$.data.slideIndex").value(1));
  requestBody=json.writeValueAsString(Map.of("presentation",presentation,"slideIndex",-1));
  mvc.perform(request("/ppt/preview",requestBody)).andExpect(status().isBadRequest());
  byte[] original;
  try(var deck=new XMLSlideShow();var bytes=new ByteArrayOutputStream()){
   deck.setPageSize(new java.awt.Dimension(800,600));var slide=deck.createSlide();
   slide.getBackground().setFillColor(java.awt.Color.RED);deck.write(bytes);original=bytes.toByteArray();
  }
  presentation=Map.of("songIds",List.of(id1),"style",style,"pptxBase64",Base64.getEncoder().encodeToString(original));
  requestBody=json.writeValueAsString(Map.of("presentation",presentation,"slideIndex",0));
  response=mvc.perform(request("/ppt/preview",requestBody)).andExpect(status().isOk())
    .andExpect(jsonPath("$.data.slideCount").value(3)).andReturn().getResponse().getContentAsString();
  imageBytes=Base64.getDecoder().decode(json.readTree(response).path("data").path("imageBase64").asText());
  image=javax.imageio.ImageIO.read(new ByteArrayInputStream(imageBytes));
  assertEquals(1280,image.getWidth());assertEquals(960,image.getHeight());assertEquals(0xff0000,image.getRGB(2,2)&0xffffff);
 }
 @Test void importPreservesLyricsAndExistingData()throws Exception{
  String words="[1절]\n별도 시험 첫 줄\n별도 시험 둘째 줄\n\n[후렴]\n별도 시험 후렴";
  String data=Base64.getEncoder().encodeToString(words.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  String body=json.writeValueAsString(Map.of("files",List.of(Map.of("name","가져오기 검증곡.txt","data",data))));
  mvc.perform(request("/batch-import",body)).andExpect(status().isOk()).andExpect(jsonPath("$.data.saved").value(1));
  mvc.perform(request("/batch-import",body)).andExpect(status().isOk()).andExpect(jsonPath("$.data.skipped").value(1));
  try(Connection c=SongStore.open(TEST_DB)){assertEquals(words,SongStore.byId(c,id3).lyrics());assertNotNull(SongStore.byId(c,id1).lyrics());}
 }
}
