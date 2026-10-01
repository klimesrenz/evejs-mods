"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
function openStore(filename) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename); let closed=false,inside=false,timer;
  const token=crypto.randomUUID(),host=os.hostname();
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
    db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,host TEXT NOT NULL,token TEXT NOT NULL,heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS producers(itemID INTEGER PRIMARY KEY,planetID INTEGER NOT NULL,active INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_planet ON producers(planetID) WHERE active=1;
      CREATE TABLE IF NOT EXISTS grants(receiptKey TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(characterID INTEGER NOT NULL,requestID TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(characterID,requestID));`);
    db.exec('BEGIN IMMEDIATE');
    const old=db.prepare('SELECT * FROM lease WHERE id=1').get();
    if (old) {
      let dead=false;
      if(old.host===host) {try {process.kill(old.pid,0);} catch(e) {dead=e.code==='ESRCH';}}
      if(!dead) throw Error('STORE_BUSY: another process owns the PI store');
    }
    db.prepare('INSERT OR REPLACE INTO lease VALUES(1,?,?,?,?)').run(process.pid,host,token,Date.now());
    const version=db.prepare("SELECT value FROM meta WHERE key='schema'").get();
    if(version && version.value!=='1') throw Error('UNSUPPORTED_STORE_SCHEMA');
    db.prepare("INSERT OR IGNORE INTO meta VALUES('schema','1')").run();
    db.exec('COMMIT');
  } catch(e) {try {db.exec('ROLLBACK');} catch {} db.close();throw e;}
  function assertLease(){if(closed || db.prepare('SELECT token FROM lease WHERE id=1').get()?.token!==token)throw Error('STORE_LEASE_LOST');}
  function transaction(fn){assertLease();if(inside) throw Error('NESTED_TRANSACTION');db.exec('BEGIN IMMEDIATE');inside=true;try {const r=fn();if(r?.then)throw Error('ASYNC_TRANSACTION');db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}finally{inside=false;}}
  function write(){assertLease();if(!inside)throw Error('TRANSACTION_REQUIRED');}
  const api={
    transaction,
    get(id){assertLease();const r=db.prepare('SELECT json FROM producers WHERE itemID=?').get(id);return r?JSON.parse(r.json):null;},
    list(){assertLease();return db.prepare('SELECT json FROM producers ORDER BY itemID').all().map(r=>JSON.parse(r.json));},
    save(row){write();db.prepare('INSERT INTO producers VALUES(?,?,?,?) ON CONFLICT(itemID) DO UPDATE SET planetID=excluded.planetID,active=excluded.active,json=excluded.json').run(row.itemID,row.planetID,row.status==='destroyed'?0:1,JSON.stringify(row));},
    pending(id){assertLease();const rows=db.prepare('SELECT json FROM grants').all().map(r=>JSON.parse(r.json));return id===undefined?rows:rows.filter(r=>r.itemID===id);},
    reserve(row){write();db.prepare('INSERT INTO grants VALUES(?,?)').run(row.receiptKey,JSON.stringify(row));},
    finish(key){write();db.prepare('DELETE FROM grants WHERE receiptKey=?').run(key);},
    request(char,id){assertLease();const r=db.prepare('SELECT payload,result FROM requests WHERE characterID=? AND requestID=?').get(char,id);return r?{payload:r.payload,result:JSON.parse(r.result)}:null;},
    remember(char,id,payload,result){write();db.prepare('INSERT INTO requests VALUES(?,?,?,?) ON CONFLICT(characterID,requestID) DO UPDATE SET result=excluded.result').run(char,id,payload,JSON.stringify(result));},
    meta(key){assertLease();const r=db.prepare('SELECT value FROM meta WHERE key=?').get(key);return r?JSON.parse(r.value):null;},
    setMeta(key,value){write();db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,JSON.stringify(value));},
    close(){if(closed)return;clearInterval(timer);assertLease();db.prepare('DELETE FROM lease WHERE token=?').run(token);db.close();closed=true;}
  };
  timer=setInterval(()=>{try{assertLease();db.prepare('UPDATE lease SET heartbeat=? WHERE token=?').run(Date.now(),token);}catch(e){console.error('[SkyhookPI] lease failure: '+e.message);}},10000);timer.unref();
  return api;
}
module.exports={openStore};
