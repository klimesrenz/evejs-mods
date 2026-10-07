'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
function openStore(filename) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename),token=crypto.randomUUID(),host=os.hostname();
  let closed=false,inside=false;
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const version=db.prepare("SELECT value FROM meta WHERE key='schema'").get();
    if(version && version.value!=='1')throw Error('UNSUPPORTED_STORE_SCHEMA');
    db.exec(`CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER,host TEXT,token TEXT);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,ownerID INTEGER NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS owner_jobs ON jobs(ownerID,id);
      CREATE INDEX IF NOT EXISTS owner_visible_jobs ON jobs(ownerID,id) WHERE status != 'delivered';
      CREATE TABLE IF NOT EXISTS requests(ownerID INTEGER NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(ownerID,id));`);
    db.exec('BEGIN IMMEDIATE');
    const old=db.prepare('SELECT * FROM lease WHERE id=1').get();
    if(old){let dead=false;if(old.host===host){try{process.kill(old.pid,0);}catch(e){dead=e.code==='ESRCH';}}if(!dead)throw Error('STORE_BUSY');}
    db.prepare('INSERT OR REPLACE INTO lease VALUES(1,?,?,?)').run(process.pid,host,token);
    db.prepare("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();db.exec('COMMIT');
  } catch(e){try{db.exec('ROLLBACK');}catch{}db.close();throw e;}
  function check(){if(closed||db.prepare('SELECT token FROM lease WHERE id=1').get()?.token!==token)throw Error('STORE_LEASE_LOST');}
  function write(){check();if(!inside)throw Error('TRANSACTION_REQUIRED');}
  function parse(row){return row?JSON.parse(row.json):null;}
  return {
    transaction(fn){check();if(inside)throw Error('NESTED_TRANSACTION');db.exec('BEGIN IMMEDIATE');inside=true;try{const r=fn();if(r?.then)throw Error('ASYNC_TRANSACTION');db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}finally{inside=false;}},
    getJob(id){check();return parse(db.prepare('SELECT json FROM jobs WHERE id=?').get(id));},
    saveJob(j){write();db.prepare('INSERT INTO jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json').run(j.id,j.ownerID,j.status,JSON.stringify(j));},
    listJobs(ownerID,cursor='',limit=50){check();return db.prepare("SELECT json FROM jobs WHERE ownerID=? AND id>? AND status != 'delivered' ORDER BY id LIMIT ?").all(ownerID,cursor,limit).map(parse);},
    pending(){check();return db.prepare("SELECT json FROM jobs WHERE status IN ('starting','delivering') ORDER BY id").all().map(parse);},
    getRequest(ownerID,id){check();return parse(db.prepare('SELECT json FROM requests WHERE ownerID=? AND id=?').get(ownerID,id));},
    saveRequest(r){write();db.prepare('INSERT INTO requests VALUES(?,?,?) ON CONFLICT(ownerID,id) DO UPDATE SET json=excluded.json').run(r.ownerID,r.id,JSON.stringify(r));},
    close(){if(closed)return;check();db.prepare('DELETE FROM lease WHERE token=?').run(token);db.close();closed=true;}
  };
}
module.exports={openStore};
