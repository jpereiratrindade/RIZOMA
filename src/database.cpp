#include "database.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <ctime>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace rizoma::database {
namespace {

constexpr int latest_version=1;
constexpr std::string_view migration_name="establish-v0.2.0-schema-and-history";
// SHA-256 of the reviewed migration specification. Changing migration 1 requires
// a new migration, never replacement of this checksum.
constexpr std::string_view migration_checksum="98804c3a9e40c1a58b0d063abec68a58dfc3f1e441a88da8bd371e76fec6d53c";

std::string sqlite_error(sqlite3* db,const std::string& context){
 return context+": "+(db?sqlite3_errmsg(db):"SQLite unavailable");
}

bool table_exists(sqlite3* db,const std::string& table){
 Statement st(db,"SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?");
 st.bind(1,table);
 return sqlite3_step(st.get())==SQLITE_ROW;
}

std::set<std::string> columns(sqlite3* db,const std::string& table){
 std::set<std::string> result;
 const std::string query="PRAGMA table_info("+table+")";
 Statement st(db,query.c_str());
 while(sqlite3_step(st.get())==SQLITE_ROW)result.insert(st.text(1));
 return result;
}

void require_columns(sqlite3* db,const std::string& table,std::initializer_list<const char*> required){
 if(!table_exists(db,table))return;
 const auto present=columns(db,table);
 for(const char* column:required)if(!present.contains(column))
  throw std::runtime_error("Incompatible legacy schema: "+table+"."+column+" is missing");
}

std::string utc_now(){
 const auto now=std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
 std::tm value{}; gmtime_r(&now,&value); char buffer[32]{};
 std::strftime(buffer,sizeof(buffer),"%Y-%m-%dT%H:%M:%SZ",&value);
 return buffer;
}

void validate_legacy_shape(sqlite3* db){
 require_columns(db,"images",{"id","filename","sample_id","capture_date","created_at","sha256","bytes","width","height","format","brightness","qc_state","pipeline","original_path","preview_path","grayscale_path"});
 require_columns(db,"events",{"id","image_id","event","at","detail"});
 require_columns(db,"users",{"id","email","name","created_at","last_login_at"});
 require_columns(db,"auth_codes",{"id","email","code","code_hash","expires_at","used_at","created_at"});
 require_columns(db,"sessions",{"token","user_id","email","created_at","expires_at"});
}

void apply_migration_1(sqlite3* db){
 validate_legacy_shape(db);
 execute(db,R"SQL(
CREATE TABLE IF NOT EXISTS images(
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, sample_id TEXT NOT NULL, capture_date TEXT NOT NULL,
 created_at TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL,
 brightness REAL NOT NULL, qc_state TEXT NOT NULL, pipeline TEXT NOT NULL,
 original_path TEXT NOT NULL, preview_path TEXT NOT NULL, grayscale_path TEXT NOT NULL,
 user_id TEXT NOT NULL DEFAULT '', user_email TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,image_id TEXT,event TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 created_at TEXT NOT NULL, last_login_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes(
 id TEXT PRIMARY KEY, email TEXT NOT NULL, code TEXT NOT NULL, code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), email TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
)SQL");
 auto image_columns=columns(db,"images");
 if(!image_columns.contains("user_email"))execute(db,"ALTER TABLE images ADD COLUMN user_email TEXT NOT NULL DEFAULT ''");
 if(!image_columns.contains("user_id"))execute(db,"ALTER TABLE images ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
 execute(db,R"SQL(
UPDATE images
 SET user_id=(SELECT users.id FROM users WHERE users.email=images.user_email)
 WHERE user_id='' AND user_email!=''
   AND EXISTS(SELECT 1 FROM users WHERE users.email=images.user_email);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email,expires_at);
)SQL");
}

void verify_database(sqlite3* db){
 {
  Statement st(db,"PRAGMA integrity_check");
  if(sqlite3_step(st.get())!=SQLITE_ROW||st.text(0)!="ok")throw std::runtime_error("SQLite integrity_check failed");
 }
 {
  Statement st(db,"PRAGMA foreign_key_check");
  if(sqlite3_step(st.get())==SQLITE_ROW)throw std::runtime_error("SQLite foreign_key_check failed");
 }
 Statement links(db,R"SQL(
SELECT COUNT(*) FROM images i JOIN users u ON u.email=i.user_email
 WHERE i.user_id!='' AND i.user_id!=u.id
)SQL");
 if(sqlite3_step(links.get())!=SQLITE_ROW||sqlite3_column_int64(links.get(),0)!=0)
  throw std::runtime_error("Image/user linkage validation failed");
}

} // namespace

Connection::Connection(const std::filesystem::path& file){
 const int flags=SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX;
 if(sqlite3_open_v2(file.c_str(),&p,flags,nullptr)!=SQLITE_OK){
  const std::string message=sqlite_error(p,"Cannot open database");
  if(p)sqlite3_close(p);
  p=nullptr;
  throw std::runtime_error(message);
 }
 sqlite3_busy_timeout(p,8000);
 char* error=nullptr;
 if(sqlite3_exec(p,"PRAGMA foreign_keys=ON",nullptr,nullptr,&error)!=SQLITE_OK){
  const std::string message=error?error:sqlite_error(p,"Cannot enable foreign keys");
  sqlite3_free(error); sqlite3_close(p); p=nullptr;
  throw std::runtime_error(message);
 }
}
Connection::~Connection(){if(p)sqlite3_close(p);}

Statement::Statement(sqlite3* db,const char* sql){
 if(sqlite3_prepare_v2(db,sql,-1,&p,nullptr)!=SQLITE_OK)throw std::runtime_error(sqlite_error(db,"Cannot prepare SQL"));
}
Statement::~Statement(){if(p)sqlite3_finalize(p);}
void Statement::bind(int index,const std::string& value){
 if(sqlite3_bind_text(p,index,value.data(),static_cast<int>(value.size()),SQLITE_TRANSIENT)!=SQLITE_OK)
  throw std::runtime_error("Cannot bind SQL value");
}
std::string Statement::text(int column)const{
 const auto* value=reinterpret_cast<const char*>(sqlite3_column_text(p,column));
 return value?value:"";
}

void execute(sqlite3* db,const char* sql){
 char* error=nullptr;
 if(sqlite3_exec(db,sql,nullptr,nullptr,&error)!=SQLITE_OK){
  const std::string message=error?error:sqlite_error(db,"SQL execution failed");
  sqlite3_free(error); throw std::runtime_error(message);
 }
}

void migrate(const std::filesystem::path& file){
 Connection connection(file); sqlite3* db=connection.get();
 execute(db,"PRAGMA foreign_keys=ON");
 execute(db,"PRAGMA journal_mode=WAL");
 try{
  execute(db,"BEGIN IMMEDIATE");
  execute(db,R"SQL(CREATE TABLE IF NOT EXISTS schema_migrations(
   version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  ))SQL");
  Statement known(db,"SELECT version,name,checksum FROM schema_migrations ORDER BY version");
  bool applied=false;
  while(sqlite3_step(known.get())==SQLITE_ROW){
   const int version=sqlite3_column_int(known.get(),0);
   if(version>latest_version)throw std::runtime_error("Database was migrated by a newer RIZOMA version");
   if(version==1){
    applied=true;
    if(known.text(1)!=migration_name||known.text(2)!=migration_checksum)
     throw std::runtime_error("Migration 1 checksum or name does not match the application");
   }
  }
  if(!applied){
   apply_migration_1(db);
   Statement record(db,"INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(1,?,?,?)");
   record.bind(1,std::string(migration_name)); record.bind(2,std::string(migration_checksum)); record.bind(3,utc_now());
   if(sqlite3_step(record.get())!=SQLITE_DONE)throw std::runtime_error(sqlite_error(db,"Cannot record migration 1"));
  }
  verify_database(db);
  execute(db,"COMMIT");
 }catch(...){sqlite3_exec(db,"ROLLBACK",nullptr,nullptr,nullptr);throw;}
}

} // namespace rizoma::database
