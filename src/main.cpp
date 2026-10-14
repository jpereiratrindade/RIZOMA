// RIZOMA v0.2.0: image-first, local-only acquisition and reproducible previews.
// Copyright (C) 2026 José Pedro Trindade
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
//
// Previews are for quality inspection, NOT scientifically validated measurements.
#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <sqlite3.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <png.h>
#include <jpeglib.h>
#include <tiffio.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <setjmp.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <sys/stat.h>

namespace fs=std::filesystem;
namespace asio=boost::asio;
namespace beast=boost::beast;
namespace http=beast::http;
using tcp=asio::ip::tcp;
constexpr std::size_t MAX_UPLOAD=12*1024*1024;
constexpr std::uint64_t MAX_PIXELS=12'000'000;
constexpr int THUMB_MAX=1280;
constexpr const char* PIPELINE="rizoma-inspection-0.2.0";
struct Failure : std::runtime_error {using std::runtime_error::runtime_error;};
struct Raster {int w=0,h=0;std::vector<unsigned char> rgba;};
struct App {fs::path root,web; unsigned short port=8089; std::atomic<int>active{0};};
static std::string utc(){auto t=std::time(nullptr); std::tm v{};gmtime_r(&t,&v);char buf[32];std::strftime(buf,sizeof(buf),"%Y-%m-%dT%H:%M:%SZ",&v);return buf;}
static std::string esc(std::string_view s){std::string out;out.reserve(s.size()+8);for(unsigned char c:s){switch(c){case '"':out+="\\\"";break;case '\\':out+="\\\\";break;case '\n':out+="\\n";break;case '\r':out+="\\r";break;case '\t':out+="\\t";break;default:if(c<32){char b[7];std::snprintf(b,sizeof(b),"\\u%04x",c);out+=b;}else out+=char(c);}}return out;}
static std::string q(std::string_view s){return "\""+esc(s)+"\"";}
static std::string hex(const unsigned char* ptr,std::size_t n){static const char h[]="0123456789abcdef";std::string out;out.reserve(n*2);for(std::size_t i=0;i<n;++i){out+=h[ptr[i]>>4];out+=h[ptr[i]&15];}return out;}
static std::string hash256(const std::string& data){unsigned char dig[EVP_MAX_MD_SIZE];unsigned int len=0;if(EVP_Digest(data.data(),data.size(),dig,&len,EVP_sha256(),nullptr)!=1)throw Failure("SHA-256 unavailable");return hex(dig,len);}
static std::string rand_id(){unsigned char b[12];if(RAND_bytes(b,sizeof(b))!=1)throw Failure("random generator unavailable");return hex(b,sizeof(b));}
static void put(const fs::path& p,const std::string& data){fs::create_directories(p.parent_path());std::ofstream f(p,std::ios::binary|std::ios::trunc);if(!f)throw Failure("could not create file");f.write(data.data(),std::streamsize(data.size()));f.flush();if(!f)throw Failure("could not write file");::chmod(p.c_str(),0600);}
static std::string slurp(const fs::path& p){std::ifstream f(p,std::ios::binary);if(!f)throw Failure("could not read file");return {std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>()};}
static void sql(sqlite3* db,const char* stmt){char* err=nullptr;if(sqlite3_exec(db,stmt,nullptr,nullptr,&err)!=SQLITE_OK){std::string m=err?err:"SQL failure";sqlite3_free(err);throw Failure(m);}}
struct Db {sqlite3* p=nullptr; explicit Db(const fs::path& f){if(sqlite3_open_v2(f.c_str(),&p,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,nullptr)!=SQLITE_OK)throw Failure("Cannot open database");sqlite3_busy_timeout(p,8000);}~Db(){if(p)sqlite3_close(p);}Db(const Db&)=delete;Db& operator=(const Db&)=delete;};
struct Stmt{sqlite3_stmt* p=nullptr;Stmt(sqlite3* db,const char* s){if(sqlite3_prepare_v2(db,s,-1,&p,nullptr)!=SQLITE_OK)throw Failure(sqlite3_errmsg(db));}~Stmt(){sqlite3_finalize(p);}void bind(int i,const std::string& v){if(sqlite3_bind_text(p,i,v.data(),int(v.size()),SQLITE_TRANSIENT)!=SQLITE_OK)throw Failure("DB bind error");}std::string txt(int i)const{auto s=reinterpret_cast<const char*>(sqlite3_column_text(p,i));return s?s:"";}};
static void initialize(const App& app){fs::create_directories(app.root/"blobs");fs::create_directories(app.root/"derived");fs::create_directories(app.root/"staging");::chmod(app.root.c_str(),0700);Db db(app.root/"rizoma.sqlite3");sql(db.p,"PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");sql(db.p,R"SQL(
CREATE TABLE IF NOT EXISTS images(
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, sample_id TEXT NOT NULL, capture_date TEXT NOT NULL,
 created_at TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL,
 width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
 brightness REAL NOT NULL, qc_state TEXT NOT NULL, pipeline TEXT NOT NULL,
 original_path TEXT NOT NULL, preview_path TEXT NOT NULL, grayscale_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,image_id TEXT,event TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
)SQL");}
static std::string detect_format(const std::string& bytes){
 if(bytes.size()>=8&&png_sig_cmp(reinterpret_cast<png_const_bytep>(bytes.data()),0,8)==0)return "png";
 if(bytes.size()>=3&& (unsigned char)bytes[0]==0xff&&(unsigned char)bytes[1]==0xd8&&(unsigned char)bytes[2]==0xff)return "jpeg";
 if(bytes.size()>=4&&
    (((unsigned char)bytes[0]==0x49&&(unsigned char)bytes[1]==0x49&&(unsigned char)bytes[2]==0x2a&&(unsigned char)bytes[3]==0x00)||
     ((unsigned char)bytes[0]==0x4d&&(unsigned char)bytes[1]==0x4d&&(unsigned char)bytes[2]==0x00&&(unsigned char)bytes[3]==0x2a)))return "tiff";
 throw Failure("Only PNG, JPEG, and TIFF images are accepted");
}
static Raster png_decode(const std::string& s){png_image p{};p.version=PNG_IMAGE_VERSION;if(!png_image_begin_read_from_memory(&p,s.data(),s.size()))throw Failure("Invalid PNG image");auto cleanup=[&]{png_image_free(&p);};if(p.width==0||p.height==0||std::uint64_t(p.width)*p.height>MAX_PIXELS){cleanup();throw Failure("Image exceeds 12 megapixels");}Raster r;r.w=int(p.width);r.h=int(p.height);p.format=PNG_FORMAT_RGBA;r.rgba.resize(PNG_IMAGE_SIZE(p));if(!png_image_finish_read(&p,nullptr,r.rgba.data(),0,nullptr)){cleanup();throw Failure("PNG could not be decoded");}cleanup();return r;}
struct JpegError{jpeg_error_mgr pub;jmp_buf jump;char message[JMSG_LENGTH_MAX]{};};
extern "C" void on_jpeg_error(j_common_ptr cinfo){auto* err=reinterpret_cast<JpegError*>(cinfo->err);(*cinfo->err->format_message)(cinfo,err->message);longjmp(err->jump,1);}
static Raster jpeg_decode(const std::string& s){jpeg_decompress_struct ci{};JpegError er{};ci.err=jpeg_std_error(&er.pub);er.pub.error_exit=on_jpeg_error;Raster r;std::vector<unsigned char>row;if(setjmp(er.jump)){jpeg_destroy_decompress(&ci);throw Failure(std::string("Invalid JPEG: ")+er.message);}jpeg_create_decompress(&ci);jpeg_mem_src(&ci,reinterpret_cast<const unsigned char*>(s.data()),s.size());jpeg_read_header(&ci,TRUE);if(ci.image_width==0||ci.image_height==0||std::uint64_t(ci.image_width)*ci.image_height>MAX_PIXELS){jpeg_destroy_decompress(&ci);throw Failure("Image exceeds 12 megapixels");}ci.out_color_space=JCS_RGB;jpeg_start_decompress(&ci);r.w=int(ci.output_width);r.h=int(ci.output_height);r.rgba.resize(std::size_t(r.w)*r.h*4);row.resize(std::size_t(r.w)*3);while(ci.output_scanline<ci.output_height){JSAMPROW rp=row.data();jpeg_read_scanlines(&ci,&rp,1);auto off=std::size_t(ci.output_scanline-1)*r.w*4;for(int x=0;x<r.w;x++){r.rgba[off+4*x]=row[3*x];r.rgba[off+4*x+1]=row[3*x+1];r.rgba[off+4*x+2]=row[3*x+2];r.rgba[off+4*x+3]=255;}}jpeg_finish_decompress(&ci);jpeg_destroy_decompress(&ci);return r;}
struct MemTiff{const unsigned char* data;tmsize_t size;tmsize_t pos;};
static tmsize_t tiff_read(thandle_t h,void* buf,tmsize_t s){auto* m=reinterpret_cast<MemTiff*>(h);if(m->pos>=m->size)return 0;tmsize_t avail=std::min(s,m->size-m->pos);std::memcpy(buf,m->data+m->pos,avail);m->pos+=avail;return avail;}
static tmsize_t tiff_write(thandle_t,void*,tmsize_t){return 0;}
static toff_t tiff_seek(thandle_t h,toff_t off,int whence){
 auto* m=reinterpret_cast<MemTiff*>(h);
 int64_t cur=static_cast<int64_t>(m->pos), len=static_cast<int64_t>(m->size), delta=static_cast<int64_t>(off);
 int64_t next=0;
 switch(whence){case SEEK_SET:next=delta;break;case SEEK_CUR:next=cur+delta;break;case SEEK_END:next=len+delta;break;default:return static_cast<toff_t>(-1);}
 if(next<0||next>len)return static_cast<toff_t>(-1);
 m->pos=static_cast<tmsize_t>(next);
 return static_cast<toff_t>(next);
}
static int tiff_close(thandle_t){return 0;}
static toff_t tiff_size(thandle_t h){auto* m=reinterpret_cast<MemTiff*>(h);return m->size;}
static Raster tiff_decode(const std::string& s){
 MemTiff mem{reinterpret_cast<const unsigned char*>(s.data()),static_cast<tmsize_t>(s.size()),0};
 TIFF* tif=TIFFClientOpen("mem","r",&mem,tiff_read,tiff_write,tiff_seek,tiff_close,tiff_size,nullptr,nullptr);
 if(!tif)throw Failure("Invalid TIFF image");
 uint32_t w=0,h=0;TIFFGetField(tif,TIFFTAG_IMAGEWIDTH,&w);TIFFGetField(tif,TIFFTAG_IMAGELENGTH,&h);
 if(w==0||h==0||std::uint64_t(w)*h>MAX_PIXELS){TIFFClose(tif);throw Failure("Image exceeds 12 megapixels");}
 std::vector<uint32_t> buf(std::size_t(w)*h);
 if(!TIFFReadRGBAImageOriented(tif,w,h,buf.data(),ORIENTATION_TOPLEFT,0)){TIFFClose(tif);throw Failure("TIFF could not be decoded");}
 TIFFClose(tif);Raster r;r.w=int(w);r.h=int(h);r.rgba.resize(std::size_t(w)*h*4);
 for(std::size_t i=0;i<buf.size();++i){uint32_t p=buf[i];r.rgba[i*4+0]=static_cast<unsigned char>(TIFFGetR(p));r.rgba[i*4+1]=static_cast<unsigned char>(TIFFGetG(p));r.rgba[i*4+2]=static_cast<unsigned char>(TIFFGetB(p));r.rgba[i*4+3]=static_cast<unsigned char>(TIFFGetA(p));}
 return r;
}
static Raster decode(const std::string& s,const std::string& fmt){
 if(fmt=="png")return png_decode(s);
 if(fmt=="jpeg")return jpeg_decode(s);
 return tiff_decode(s);
}
static std::string png_encode(const Raster& r){png_image im{};im.version=PNG_IMAGE_VERSION;im.width=r.w;im.height=r.h;im.format=PNG_FORMAT_RGBA;png_alloc_size_t n=0;if(!png_image_write_to_memory(&im,nullptr,&n,0,r.rgba.data(),0,nullptr))throw Failure("Preview encoding failed");std::string data(std::size_t(n),'\0');if(!png_image_write_to_memory(&im,data.data(),&n,0,r.rgba.data(),0,nullptr))throw Failure("Preview encoding failed");data.resize(std::size_t(n));return data;}
static Raster preview(const Raster& orig,bool gray,double& mean){double ratio=std::min(1.,double(THUMB_MAX)/std::max(orig.w,orig.h));Raster out;out.w=std::max(1,int(std::lround(orig.w*ratio)));out.h=std::max(1,int(std::lround(orig.h*ratio)));out.rgba.resize(std::size_t(out.w)*out.h*4);double total=0;for(int y=0;y<out.h;y++){int sy=std::min(orig.h-1,int(double(y)*orig.h/out.h));for(int x=0;x<out.w;x++){int sx=std::min(orig.w-1,int(double(x)*orig.w/out.w));auto i=(std::size_t(sy)*orig.w+sx)*4,j=(std::size_t(y)*out.w+x)*4;const unsigned char* c=&orig.rgba[i];unsigned char lum=static_cast<unsigned char>(std::clamp(std::lround(.2126*c[0]+.7152*c[1]+.0722*c[2]),0L,255L));total+=lum;if(gray){out.rgba[j]=out.rgba[j+1]=out.rgba[j+2]=lum;}else{out.rgba[j]=c[0];out.rgba[j+1]=c[1];out.rgba[j+2]=c[2];}out.rgba[j+3]=255;}}mean=total/(out.w*out.h);return out;}
static std::string safe_filename(std::string s){auto pos=s.find_last_of("/\\");if(pos!=std::string::npos)s=s.substr(pos+1);std::string n;for(unsigned char c:s){if(c>=32&&c!=127&&c!='"'&&c!='<'&&c!='>'&&c!='\\')n+=char(c);}if(n.empty())n="imagem-sem-nome";if(n.size()>100)n.resize(100);return n;}
static bool sample_ok(const std::string& s){return s.size()<=64&&std::all_of(s.begin(),s.end(),[](unsigned char c){return std::isalnum(c)||c=='_'||c=='-'||c=='.';});}
static bool date_ok(const std::string& s){if(s.empty())return true;if(s.size()!=10)return false;for(int i=0;i<10;++i)if((i==4||i==7)?s[i]!='-':!std::isdigit(static_cast<unsigned char>(s[i])))return false;return s.substr(5,2)>="01"&&s.substr(5,2)<="12"&&s.substr(8,2)>="01"&&s.substr(8,2)<="31";}
static int nib(char c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;if(c>='A'&&c<='F')return c-'A'+10;return -1;}
static std::string decode_uri(const std::string& s){std::string v;for(std::size_t i=0;i<s.size();++i){if(s[i]=='%'&&i+2<s.size()&&nib(s[i+1])>=0&&nib(s[i+2])>=0){v+=char((nib(s[i+1])<<4)|nib(s[i+2]));i+=2;}else if(s[i]=='+')v+=' ';else v+=s[i];}return v;}
static std::map<std::string,std::string> params(const std::string& path){std::map<std::string,std::string> p;auto pos=path.find('?');if(pos==std::string::npos)return p;std::string tail=path.substr(pos+1);std::istringstream in(tail);std::string part;while(std::getline(in,part,'&')){auto eq=part.find('=');if(eq!=std::string::npos)p[decode_uri(part.substr(0,eq))]=decode_uri(part.substr(eq+1));}return p;}
static std::string col(sqlite3_stmt* st,int i){auto p=reinterpret_cast<const char*>(sqlite3_column_text(st,i));return p?p:"";}
static std::string row_json(sqlite3_stmt* st){std::ostringstream o;o<<"{\"id\":"<<q(col(st,0))<<",\"filename\":"<<q(col(st,1))<<",\"sample_id\":"<<q(col(st,2))<<",\"capture_date\":"<<q(col(st,3))<<",\"created_at\":"<<q(col(st,4))<<",\"sha256\":"<<q(col(st,5))<<",\"bytes\":"<<sqlite3_column_int64(st,6)<<",\"width\":"<<sqlite3_column_int(st,7)<<",\"height\":"<<sqlite3_column_int(st,8)<<",\"format\":"<<q(col(st,9))<<",\"brightness\":"<<std::fixed<<std::setprecision(1)<<sqlite3_column_double(st,10)<<",\"qc_state\":"<<q(col(st,11))<<",\"pipeline\":"<<q(col(st,12))<<",\"scientific_status\":\"NOT_ANALYZED\"}";return o.str();}
constexpr const char* fields="id,filename,sample_id,capture_date,created_at,sha256,bytes,width,height,format,brightness,qc_state,pipeline";
static std::string all_images(const App& app){Db d(app.root/"rizoma.sqlite3");auto stm=std::string("SELECT ")+fields+" FROM images ORDER BY created_at DESC, id DESC LIMIT 500";Stmt st(d.p,stm.c_str());std::string out="{\"schema\":\"rizoma.images.v0.2.0\",\"data\":[";bool first=true;while(sqlite3_step(st.p)==SQLITE_ROW){if(!first)out+=",";first=false;out+=row_json(st.p);}out+="]}";return out;}
static std::string one_image(const App& app,const std::string& id){Db d(app.root/"rizoma.sqlite3");auto stm=std::string("SELECT ")+fields+" FROM images WHERE id=?";Stmt st(d.p,stm.c_str());st.bind(1,id);if(sqlite3_step(st.p)!=SQLITE_ROW)throw Failure("Image not found");return "{\"data\":"+row_json(st.p)+"}";}
static std::string csv_cell(const std::string& s){std::string x=s;if(!x.empty()&&(x[0]=='='||x[0]=='+'||x[0]=='-'||x[0]=='@'))x="'"+x;std::string out="\"";for(char c:x){if(c=='"')out+="\"\"";else if(c!='\r'&&c!='\n')out+=c;}return out+"\"";}
static std::string manifest(const App& app){Db d(app.root/"rizoma.sqlite3");Stmt st(d.p,"SELECT id,filename,sample_id,capture_date,created_at,sha256,bytes,width,height,format,qc_state,pipeline FROM images ORDER BY created_at DESC");std::string r="id,filename,sample_id,capture_date,created_at,sha256,bytes,width,height,format,qc_state,pipeline,scientific_status\r\n";while(sqlite3_step(st.p)==SQLITE_ROW){for(int i=0;i<12;++i){if(i)r+=",";r+=csv_cell(col(st.p,i));}r+=",\"NOT_ANALYZED\"\r\n";}return r;}
static std::string media(const App& app,const std::string& id,const std::string& kind,std::string& mime){
 Db d(app.root/"rizoma.sqlite3");Stmt st(d.p,"SELECT original_path,preview_path,grayscale_path,format FROM images WHERE id=?");
 st.bind(1,id);if(sqlite3_step(st.p)!=SQLITE_ROW)throw Failure("Image not found");
 std::string fmt=col(st.p,3);
 if(kind=="original-view"){
  if(fmt=="tiff"){
   fs::path view_path = app.root/("derived/"+id+"/original_view.png");
   if(!fs::exists(view_path)){
    std::string raw = slurp(app.root/col(st.p,0));
    Raster r = tiff_decode(raw);
    put(view_path, png_encode(r));
   }
   mime="image/png";
   return slurp(view_path);
  }
  fs::path orig_path = app.root/col(st.p,0);
  mime = fmt=="jpeg" ? "image/jpeg" : "image/png";
  return slurp(orig_path);
 }
 int i=kind=="original"?0:kind=="preview"?1:2;
 fs::path stored=col(st.p,i); // paths are generated by this service, never from clients
 if(kind=="original"){
  if(fmt=="png")mime="image/png";
  else if(fmt=="jpeg")mime="image/jpeg";
  else if(fmt=="tiff")mime="image/tiff";
  else mime="application/octet-stream";
 }else mime="image/png";
 return slurp(app.root/stored);
}
struct Ingested{std::string id;std::string json;};
static Ingested ingest(const App& app,const std::string& bytes,const std::string& filename,const std::string& sample,const std::string& captured){
 if(bytes.empty()||bytes.size()>MAX_UPLOAD)throw Failure("Image must contain data and be at most 12 MiB");
 if(!sample_ok(sample)||!date_ok(captured))throw Failure("Invalid sample identifier or capture date");
 auto fmt=detect_format(bytes);auto raster=decode(bytes,fmt);auto hash=hash256(bytes);
 Db db(app.root/"rizoma.sqlite3");{Stmt lookup(db.p,"SELECT id FROM images WHERE sha256=?");lookup.bind(1,hash);if(sqlite3_step(lookup.p)==SQLITE_ROW)throw Failure("An identical original is already registered (SHA-256 duplicate)");}
 double brightness=0,unused=0;auto thumb=preview(raster,false,brightness);auto gray=preview(raster,true,unused);
 auto thumbbytes=png_encode(thumb),graybytes=png_encode(gray);
 const std::string id=rand_id();const std::string ext=fmt=="png"?"png":fmt=="jpeg"?"jpg":"tif";
 const std::string orig=std::string("blobs/")+hash.substr(0,2)+"/"+hash+"."+ext;
 const std::string a="derived/"+id+"/preview.png",b="derived/"+id+"/grayscale.png";
 const fs::path stage=app.root/"staging"/(id+".tmp");put(stage,bytes);fs::create_directories((app.root/orig).parent_path());if(!fs::exists(app.root/orig))fs::rename(stage,app.root/orig);else fs::remove(stage);
 put(app.root/a,thumbbytes);put(app.root/b,graybytes);
 if(fmt=="tiff")put(app.root/("derived/"+id+"/original_view.png"), png_encode(raster));
 const std::string state=brightness<35?"LOW_LIGHT":brightness>220?"HIGH_LIGHT":"REVIEW";
 sql(db.p,"BEGIN IMMEDIATE");try{
 Stmt st(db.p,"INSERT INTO images(id,filename,sample_id,capture_date,created_at,sha256,bytes,width,height,format,brightness,qc_state,pipeline,original_path,preview_path,grayscale_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 st.bind(1,id);st.bind(2,safe_filename(filename));st.bind(3,sample);st.bind(4,captured);st.bind(5,utc());st.bind(6,hash);sqlite3_bind_int64(st.p,7,sqlite3_int64(bytes.size()));sqlite3_bind_int(st.p,8,raster.w);sqlite3_bind_int(st.p,9,raster.h);st.bind(10,fmt);sqlite3_bind_double(st.p,11,brightness);st.bind(12,state);st.bind(13,PIPELINE);st.bind(14,orig);st.bind(15,a);st.bind(16,b);
 if(sqlite3_step(st.p)!=SQLITE_DONE)throw Failure(sqlite3_errmsg(db.p));
 Stmt ev(db.p,"INSERT INTO events(image_id,event,at,detail) VALUES(?,'IMAGE_RECEIVED',?,?)");ev.bind(1,id);ev.bind(2,utc());ev.bind(3,hash);if(sqlite3_step(ev.p)!=SQLITE_DONE)throw Failure(sqlite3_errmsg(db.p));sql(db.p,"COMMIT");}catch(...){sqlite3_exec(db.p,"ROLLBACK",nullptr,nullptr,nullptr);throw;}
 return {id,one_image(app,id)};
}
using Response=http::response<http::string_body>;
static Response respond(http::status s,unsigned version,std::string body,std::string mime="application/json; charset=utf-8"){
 Response r{s,version};r.set(http::field::server,"RIZOMA/0.2.0");r.set(http::field::content_type,mime);r.set(http::field::cache_control,"no-store");r.set("X-Content-Type-Options","nosniff");r.set("X-Frame-Options","DENY");r.set("Referrer-Policy","no-referrer");r.set("Content-Security-Policy","default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");r.keep_alive(false);r.body()=std::move(body);r.prepare_payload();return r;}
static Response problem(unsigned ver,http::status s,const std::string& msg){return respond(s,ver,"{\"error\":\""+esc(msg)+"\"}");}
static bool valid_id(std::string s){return s.size()==24&&std::all_of(s.begin(),s.end(),[](char c){return(c>='a'&&c<='f')||(c>='0'&&c<='9');});}
static Response handle(const App& app,const http::request<http::string_body>& req){unsigned v=req.version();std::string target(req.target());auto p=target.substr(0,target.find('?'));auto args=params(target);
 if(req.method()==http::verb::get&&p=="/api/v1/health")return respond(http::status::ok,v,"{\"status\":\"ok\",\"name\":\"RIZOMA\",\"version\":\"0.2.0\",\"scope\":\"local-image-intake\"}");
 if(req.method()==http::verb::get&&p=="/api/v1/images")return respond(http::status::ok,v,all_images(app));
 if(req.method()==http::verb::get&&p=="/api/v1/export/manifest.csv")return respond(http::status::ok,v,manifest(app),"text/csv; charset=utf-8");
 if(req.method()==http::verb::post&&p=="/api/v1/images"){
  if(req.find("X-Rizoma-Client")==req.end()||req["X-Rizoma-Client"]!="web-v0.2.0")return problem(v,http::status::forbidden,"Client header required");
  if(req[http::field::content_type]!="application/octet-stream")return problem(v,http::status::unsupported_media_type,"Use application/octet-stream");
  if(req.body().size()>MAX_UPLOAD)return problem(v,http::status::payload_too_large,"File exceeds upload limit");
  try{auto ret=ingest(app,req.body(),args["filename"],args["sample_id"],args["capture_date"]);return respond(http::status::created,v,ret.json);}
  catch(const Failure& e){std::string m=e.what();http::status st=m.find("already registered")!=std::string::npos?http::status::conflict:m.find("Only PNG")!=std::string::npos?http::status::unsupported_media_type:m.find("exceeds")!=std::string::npos?http::status::payload_too_large:http::status::unprocessable_entity;return problem(v,st,m);}
 }
 if(req.method()==http::verb::get&&p.starts_with("/api/v1/images/")){
  std::string rem=p.substr(std::string("/api/v1/images/").size());auto slash=rem.find('/');auto id=rem.substr(0,slash);if(!valid_id(id))return problem(v,http::status::bad_request,"Invalid image identifier");
  try{if(slash==std::string::npos)return respond(http::status::ok,v,one_image(app,id));auto kind=rem.substr(slash+1);if(kind=="original"||kind=="original-view"||kind=="preview"||kind=="grayscale"){
  std::string mime;std::string binary=media(app,id,kind,mime);return respond(http::status::ok,v,std::move(binary),mime);
  }}catch(const Failure&){return problem(v,http::status::not_found,"Image not found");}
 }

 if(req.method()==http::verb::get){const std::map<std::string,std::pair<std::string,std::string>> assets={{"/",{"index.html","text/html; charset=utf-8"}},{"/index.html",{"index.html","text/html; charset=utf-8"}},{"/style.css",{"style.css","text/css; charset=utf-8"}},{"/app.js",{"app.js","application/javascript; charset=utf-8"}}};auto it=assets.find(p);if(it!=assets.end())try{return respond(http::status::ok,v,slurp(app.web/it->second.first),it->second.second);}catch(...){return problem(v,http::status::internal_server_error,"Frontend unavailable");}}
 return problem(v,http::status::not_found,"Resource not found");
}
static void session(tcp::socket socket,App& app){
 struct ActiveGuard {App& app;~ActiveGuard(){--app.active;}} active_guard{app};
 try{
 beast::tcp_stream stream(std::move(socket));stream.expires_after(std::chrono::seconds(30));beast::flat_buffer buffer;http::request_parser<http::string_body> parser;parser.body_limit(MAX_UPLOAD+8192);beast::error_code ec;http::read(stream,buffer,parser,ec);
 if(ec){if(ec==http::error::body_limit){auto r=problem(11,http::status::payload_too_large,"Maximum payload: 12 MiB");http::write(stream,r,ec);}return;}
 auto req=parser.release();Response r=problem(req.version(),http::status::internal_server_error,"Server error");
 // This first operational slice is bound exclusively to loopback; external authentication is NOT implemented.
 const std::string origin=std::string(req[http::field::origin]);
 if(!origin.empty()&&origin!="http://localhost:"+std::to_string(app.port)&&origin!="http://127.0.0.1:"+std::to_string(app.port))r=problem(req.version(),http::status::forbidden,"Cross-origin requests are disabled");
 else try{r=handle(app,req);}catch(const std::exception& e){std::cerr<<"Request error: "<<e.what()<<"\n";r=problem(req.version(),http::status::internal_server_error,"Unexpected server error");}
 http::write(stream,r,ec);stream.socket().shutdown(tcp::socket::shutdown_both,ec);
 }catch(const std::exception& e){std::cerr<<"Connection error: "<<e.what()<<"\n";}
}
int main(int argc,char** argv){try{
 ::umask(0077);App app;app.root="./var";app.web="./web";
 TIFFSetWarningHandler(nullptr);TIFFSetErrorHandler(nullptr);
 for(int i=1;i<argc;i++){std::string a=argv[i];if(a=="--data-dir"&&i+1<argc)app.root=argv[++i];else if(a=="--web-dir"&&i+1<argc)app.web=argv[++i];else if(a=="--port"&&i+1<argc){int port=std::stoi(argv[++i]);if(port<1024||port>65535)throw Failure("Port out of range");app.port=static_cast<unsigned short>(port);}else throw Failure("Usage: rizoma-server [--data-dir DIRECTORY] [--web-dir DIRECTORY] [--port 1024..65535]");}
 initialize(app);asio::io_context io;tcp::acceptor acceptor(io,{asio::ip::make_address("127.0.0.1"),app.port});std::cout<<"RIZOMA v0.2.0 — http://127.0.0.1:"<<app.port<<" (loopback only)\n"<<"Data dir: "<<fs::absolute(app.root)<<"\n"<<std::flush;
 for(;;){tcp::socket s(io);acceptor.accept(s);if(app.active.load()>=4){s.close();continue;}++app.active;std::thread(session,std::move(s),std::ref(app)).detach();}
 }catch(const std::exception& e){std::cerr<<"RIZOMA fatal: "<<e.what()<<"\n";return 1;}}

