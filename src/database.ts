/** Owned SQLite memory records, immutable revisions and source-linked redaction. */
import {DatabaseSync} from 'node:sqlite'
import {createHash,randomUUID} from 'node:crypto'
import {closeSync,openSync,writeSync,readFileSync,unlinkSync,mkdirSync,lstatSync} from 'node:fs'
import {join,isAbsolute} from 'node:path'
import {z} from 'zod'
import {brandString} from '@deepseek-ai/dsh-brand'
import {scopeKey,type MessageId} from 'dsh-im-kit'
import {MemoryError,headSchema,assertionSchema,putSchema,forgetSchema,confirmSchema,receiptSchema,sourceInfoSchema} from './wire.ts'
import {sourceSchema,readSchema,type WorkerOptions} from './commands.ts'
import type {PersonRef,MemoryHead,MutationReceipt,AssertionId} from './types.ts'

const APPLICATION_ID=0x44534d45,SCHEMA_VERSION=1,hash=(text:string)=>createHash('sha256').update(text).digest('hex')
const sourceBody=z.strictObject({text:z.string().nullable(),forgotten:z.number().int().min(0).max(1),person_key:z.string(),seq:z.number().int().positive(),origin:z.enum(['live','archive']),sent_at:z.number(),received_at:z.number(),observed_at:z.number()})
function rejectLink(path:string):void{try{if(lstatSync(path).isSymbolicLink())throw new MemoryError('invalid-data')}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error}}
function alive(pid:number):boolean{try{process.kill(pid,0);return true}catch(error){return!(error instanceof Error&&'code'in error&&error.code==='ESRCH')}}
/** Directory lease protects against two live owners; retained records are never displaced. */
export class MemoryDatabase{
 private readonly db:DatabaseSync
 private readonly leasePath:string
 private closed=false
 /** @param options - validated worker options. Creates only an empty owned database or opens its supported generation. */
 constructor(private readonly options:WorkerOptions){
  if(!isAbsolute(options.directory))throw new MemoryError('invalid-data')
  mkdirSync(options.directory,{recursive:true,mode:0o700});rejectLink(options.directory);this.leasePath=join(options.directory,'owner.lock');rejectLink(this.leasePath)
  this.acquire()
  const path=join(options.directory,'memory.sqlite3')
  try{rejectLink(path);this.db=new DatabaseSync(path);try{this.initialize()}catch(error){this.db.close();throw error}}catch(error){this.release();throw error}
 }
 private acquire():void{
  for(let attempt=0;attempt<2;attempt++){
   let fd:number
   try{fd=openSync(this.leasePath,'wx',0o600)}catch(error){
    if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error
    let owner:{pid:number;leaseId:string}
    try{owner=z.strictObject({pid:z.number().int().positive(),leaseId:z.string().uuid()}).parse(JSON.parse(readFileSync(this.leasePath,'utf8')))}catch(parseError){throw new MemoryError('owned')}
    if(alive(owner.pid))throw new MemoryError('owned')
    if(JSON.parse(readFileSync(this.leasePath,'utf8')).leaseId===owner.leaseId)unlinkSync(this.leasePath)
    continue
   }
   try{writeSync(fd,JSON.stringify({pid:process.pid,leaseId:this.options.leaseId})+'\n')}finally{closeSync(fd)}
   return
  }
  throw new MemoryError('owned')
 }
 private release():void{try{const value=JSON.parse(readFileSync(this.leasePath,'utf8'));if(value.leaseId===this.options.leaseId)unlinkSync(this.leasePath)}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw new MemoryError('unavailable')}}
 private initialize():void{
  this.db.exec('PRAGMA busy_timeout='+this.options.busyMs)
  const version=Number(this.db.prepare('PRAGMA user_version').get()?.['user_version']),application=Number(this.db.prepare('PRAGMA application_id').get()?.['application_id'])
  if(version===0&&application===0){
   if(this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get())throw new MemoryError('schema-unsupported')
   this.db.exec('BEGIN IMMEDIATE')
   try{this.db.exec(`
    CREATE TABLE metadata(id INTEGER PRIMARY KEY CHECK(id=1),namespace TEXT NOT NULL,stored_sources INTEGER NOT NULL DEFAULT 0,redacted_sources INTEGER NOT NULL DEFAULT 0,assertions INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE persons(person_key TEXT PRIMARY KEY,person_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,redaction_cutoff INTEGER NOT NULL DEFAULT 0,redaction_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sources(seq INTEGER PRIMARY KEY AUTOINCREMENT,source_key TEXT NOT NULL UNIQUE,person_key TEXT NOT NULL,message_id TEXT NOT NULL,fingerprint TEXT NOT NULL,text TEXT,origin TEXT NOT NULL,sent_at INTEGER NOT NULL,received_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,forgotten INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX sources_person ON sources(person_key,seq);
    CREATE TABLE memory_keys(person_key TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL,forgotten INTEGER NOT NULL DEFAULT 0,forgotten_seq INTEGER NOT NULL DEFAULT 0,assertion_id TEXT,PRIMARY KEY(person_key,key));
    CREATE TABLE assertions(id TEXT PRIMARY KEY,person_key TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL,source_key TEXT NOT NULL,content TEXT NOT NULL,quote TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,effective_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,replaces_id TEXT,UNIQUE(person_key,key,version));
    CREATE INDEX assertion_history ON assertions(person_key,key,version DESC);
    CREATE INDEX assertion_source ON assertions(person_key,source_key,key);
    CREATE TABLE mutations(person_key TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,affected_keys TEXT NOT NULL,PRIMARY KEY(person_key,id));
    PRAGMA application_id=${APPLICATION_ID};PRAGMA user_version=${SCHEMA_VERSION};`)
    this.db.prepare('INSERT INTO metadata(id,namespace) VALUES(1,?)').run(this.options.namespace);this.db.exec('COMMIT')
   }catch(error){this.db.exec('ROLLBACK');throw error}
  }else if(version!==SCHEMA_VERSION||application!==APPLICATION_ID)throw new MemoryError('schema-unsupported')
  if(this.db.prepare('SELECT namespace FROM metadata WHERE id=1').get()?.['namespace']!==this.options.namespace)throw new MemoryError('forbidden')
  if(this.db.prepare('PRAGMA journal_mode=WAL').get()?.['journal_mode']!=='wal')throw new MemoryError('unavailable')
  this.db.exec('PRAGMA synchronous=FULL;PRAGMA secure_delete=ON')
 }
 private personKey(person:PersonRef):string{return hash(JSON.stringify([this.options.namespace,scopeKey(person.scope),person.subject]))}
 private sourceKey(person:PersonRef,messageId:MessageId):string{return hash(JSON.stringify([this.options.namespace,scopeKey(person.scope),messageId]))}
 private person(person:PersonRef):string{const key=this.personKey(person);this.db.prepare('INSERT INTO persons(person_key,person_json) VALUES(?,?) ON CONFLICT(person_key) DO NOTHING').run(key,JSON.stringify(person));return key}
 private revision(personKey:string):number{return z.number().int().nonnegative().safe().parse(this.db.prepare('SELECT revision FROM persons WHERE person_key=?').get(personKey)?.['revision']??0)}
 private currentHead(personKey:string,key:string):MemoryHead|null{const row=this.db.prepare('SELECT key,version,forgotten,assertion_id FROM memory_keys WHERE person_key=? AND key=?').get(personKey,key);return row?headSchema.parse({key:row['key'],version:row['version'],forgotten:row['forgotten']===1,assertionId:row['assertion_id']}):null}
 private transaction<T>(body:()=>T):T{if(this.closed)throw new MemoryError('closed');this.db.exec('BEGIN IMMEDIATE');try{const value=body();this.db.exec('COMMIT');return value}catch(error){this.db.exec('ROLLBACK');throw error}}
 /** @param raw - normalized source record. @param now - Host observation time. @returns identity-preserving insert or replay status. */
 observe(raw:unknown,now:number):'stored'|'duplicate'|'redacted'|'conflict'{
  const input=sourceSchema.parse(raw),sourceKey=this.sourceKey(input.person,input.messageId)
  return this.transaction(()=>{
   const existing=this.db.prepare('SELECT fingerprint,forgotten,person_key FROM sources WHERE source_key=?').get(sourceKey)
   if(existing)return existing['fingerprint']===input.fingerprint&&existing['person_key']===this.personKey(input.person)?existing['forgotten']===1?'redacted':'duplicate':'conflict'
   const personKey=this.person(input.person),cutoff=Number(this.db.prepare('SELECT redaction_cutoff FROM persons WHERE person_key=?').get(personKey)?.['redaction_cutoff']),sourceTime=input.sentAt||input.receivedAt,redacted=cutoff>0&&input.origin==='archive'&&(sourceTime<=cutoff||input.sentAt===0)
   this.db.prepare('INSERT INTO sources(source_key,person_key,message_id,fingerprint,text,origin,sent_at,received_at,observed_at,forgotten) VALUES(?,?,?,?,?,?,?,?,?,?)').run(sourceKey,personKey,input.messageId,input.fingerprint,redacted?null:input.text,input.origin,input.sentAt,input.receivedAt,now,redacted?1:0)
   this.db.exec(redacted?'UPDATE metadata SET redacted_sources=redacted_sources+1 WHERE id=1':'UPDATE metadata SET stored_sources=stored_sources+1 WHERE id=1');return redacted?'redacted':'stored'
  })
 }
 /** @param person - authorized subject. @param key - validated logical key. @returns current revision even after forgetting, or null. */
 head(person:PersonRef,key:string):MemoryHead|null{if(this.closed)throw new MemoryError('closed');return this.currentHead(this.personKey(person),key)}
 /** @param person - authorized subject. @param messageId - exact source. @returns body-free metadata and directive flags. */
 source(person:PersonRef,messageId:MessageId):z.infer<typeof sourceInfoSchema>{
  if(this.closed)throw new MemoryError('closed')
  const row=this.db.prepare('SELECT text,forgotten,person_key,seq,origin,sent_at,received_at,observed_at FROM sources WHERE source_key=?').get(this.sourceKey(person,messageId));if(!row)throw new MemoryError('source-missing')
  const item=sourceBody.parse(row);if(item.person_key!==this.personKey(person))throw new MemoryError('forbidden')
  return{messageId,sentAt:item.sent_at,receivedAt:item.received_at,observedAt:item.observed_at,redacted:item.forgotten===1,live:item.origin==='live',canForget:item.origin==='live'&&item.forgotten===0&&/^\s*(?:请\s*)?(?:忘记|删除记忆|删除我的记忆|清除记忆|forget(?:\s|:))\s*[\s\S]+$/iu.test(item.text??'')}
 }
 private replay(personKey:string,id:string,digest:string):MutationReceipt|null{
  const row=this.db.prepare('SELECT digest,revision,affected_keys FROM mutations WHERE person_key=? AND id=?').get(personKey,id);if(!row)return null
  if(row['digest']!==digest)throw new MemoryError('conflict')
  const keys=z.array(z.string()).parse(JSON.parse(String(row['affected_keys'])))
  return receiptSchema.parse({mutationId:id,outcome:'duplicate',revision:row['revision'],currentRevision:this.revision(personKey),affectedKeys:keys.length,headsTruncated:keys.length>this.options.maxReceiptHeads,heads:keys.slice(0,this.options.maxReceiptHeads).flatMap(key=>{const head=this.currentHead(personKey,key);return head?[head]:[]})})
 }
 private receipt(personKey:string,id:string,digest:string,keys:readonly string[]):MutationReceipt{
  this.db.prepare('UPDATE persons SET revision=revision+1 WHERE person_key=?').run(personKey);const revision=this.revision(personKey)
  this.db.prepare('INSERT INTO mutations(person_key,id,digest,revision,affected_keys) VALUES(?,?,?,?,?)').run(personKey,id,digest,revision,JSON.stringify(keys))
  return receiptSchema.parse({mutationId:id,outcome:'applied',revision,currentRevision:revision,affectedKeys:keys.length,headsTruncated:keys.length>this.options.maxReceiptHeads,heads:keys.slice(0,this.options.maxReceiptHeads).flatMap(key=>{const head=this.currentHead(personKey,key);return head?[head]:[]})})
 }
 /** @param raw - validated evidence-grounded proposal. @param now - Host recording time. @returns mutation receipt; stale or missing evidence never changes a key. */
 put(raw:unknown,now:number):MutationReceipt{
  const input=putSchema.parse(raw),digest=hash(JSON.stringify(['put',input])),personKey=this.personKey(input.person)
  return this.transaction(()=>{
   const replay=this.replay(personKey,input.mutationId,digest);if(replay)return replay
   const sourceKey=this.sourceKey(input.person,input.messageId),rawSource=this.db.prepare('SELECT text,forgotten,person_key,seq,origin,sent_at,received_at,observed_at FROM sources WHERE source_key=?').get(sourceKey)
   if(!rawSource)throw new MemoryError('source-missing');const source=sourceBody.parse(rawSource)
   if(source.person_key!==personKey)throw new MemoryError('forbidden');if(source.forgotten||source.text===null)throw new MemoryError('forgotten');if(!source.text.includes(input.quote))throw new MemoryError('evidence-mismatch')
   const fence=Number(this.db.prepare('SELECT redaction_seq FROM persons WHERE person_key=?').get(personKey)?.['redaction_seq']);if(source.seq<=fence)throw new MemoryError('forgotten')
   const previous=this.currentHead(personKey,input.key);if((previous?.version??0)!==input.expectedVersion)throw new MemoryError('conflict')
   if(previous?.assertionId){const old=this.db.prepare('SELECT a.source_key,s.sent_at,s.received_at,s.observed_at FROM assertions a JOIN sources s ON a.source_key=s.source_key WHERE a.id=?').get(previous.assertionId);if(old){const sourceTime=source.sent_at||source.received_at||source.observed_at,oldTime=Number(old['sent_at'])||Number(old['received_at'])||Number(old['observed_at']);if(old['source_key']===sourceKey||sourceTime<oldTime||source.origin==='archive'&&source.sent_at===0)throw new MemoryError('conflict')}}
   const explicit=/^\s*(?:请\s*)?(?:(?:记住|记一下|帮我记住|更正记忆|更新记忆)[\s:：,，]*\S[\s\S]*|remember(?: this| that)?(?:\s+|:\s*)\S[\s\S]*)$/iu.test(source.text),category=input.category==='candidate'&&explicit&&source.origin==='live'&&input.quote.includes(input.content)?'user-requested':input.category
   if(previous?.forgotten){const marker=this.db.prepare('SELECT forgotten_seq FROM memory_keys WHERE person_key=? AND key=?').get(personKey,input.key)?.['forgotten_seq'];if(!input.reopen||category!=='user-requested'||source.seq<=Number(marker))throw new MemoryError('forgotten')}
   const id=brandString<AssertionId>(randomUUID()),version=(previous?.version??0)+1
   this.db.prepare('INSERT INTO assertions(id,person_key,key,version,source_key,content,quote,kind,category,effective_at,recorded_at,replaces_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,personKey,input.key,version,sourceKey,input.content,input.quote,input.kind,category,input.effectiveAt,now,previous?.assertionId??null)
   this.db.exec('UPDATE metadata SET assertions=assertions+1 WHERE id=1')
   this.db.prepare('INSERT INTO memory_keys(person_key,key,version,assertion_id) VALUES(?,?,?,?) ON CONFLICT(person_key,key) DO UPDATE SET version=excluded.version,assertion_id=excluded.assertion_id,forgotten=0').run(personKey,input.key,version,id)
   return this.receipt(personKey,input.mutationId,digest,[input.key])
  })
 }
 /** @param raw - key and expected version. @param now - privacy cutoff for later history imports. @returns atomic redaction receipt; source-sharing assertions are also forgotten. */
 forget(raw:unknown,now:number):MutationReceipt{
  const input=forgetSchema.parse(raw),personKey=this.personKey(input.person),digest=hash(JSON.stringify(['forget',input]))
  const receipt=this.transaction(()=>{
   const replay=this.replay(personKey,input.mutationId,digest);if(replay)return replay
   const previous=this.currentHead(personKey,input.key);if(!previous||previous.version!==input.expectedVersion)throw new MemoryError('conflict')
   if(previous.forgotten)throw new MemoryError('forgotten')
   const rows=this.db.prepare(`WITH RECURSIVE related(key) AS (SELECT ? UNION SELECT a.key FROM assertions a JOIN assertions b ON a.source_key=b.source_key AND a.person_key=b.person_key JOIN related r ON b.key=r.key WHERE a.person_key=?) SELECT key FROM related LIMIT ?`).all(input.key,personKey,this.options.maxForgetKeys+1)
   if(rows.length>this.options.maxForgetKeys)throw new MemoryError('capacity')
   const keys=rows.map(row=>z.string().parse(row['key'])).sort()
   this.db.exec('CREATE TEMP TABLE IF NOT EXISTS staged_forget_keys(key TEXT PRIMARY KEY);DELETE FROM staged_forget_keys')
   const stage=this.db.prepare('INSERT INTO staged_forget_keys(key) VALUES(?)');for(const key of keys)stage.run(key)
   const redacted=this.db.prepare('UPDATE sources SET text=NULL,forgotten=1 WHERE person_key=? AND forgotten=0 AND source_key IN (SELECT source_key FROM assertions WHERE person_key=? AND key IN (SELECT key FROM staged_forget_keys))').run(personKey,personKey)
   const removed=this.db.prepare('DELETE FROM assertions WHERE person_key=? AND key IN (SELECT key FROM staged_forget_keys)').run(personKey)
   this.db.prepare('UPDATE metadata SET stored_sources=stored_sources-?,redacted_sources=redacted_sources+?,assertions=assertions-? WHERE id=1').run(Number(redacted.changes),Number(redacted.changes),Number(removed.changes))
   const watermark=Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS value FROM sources WHERE person_key=?').get(personKey)?.['value'])
   this.db.prepare('UPDATE persons SET redaction_cutoff=MAX(redaction_cutoff,?),redaction_seq=MAX(redaction_seq,?) WHERE person_key=?').run(now,watermark,personKey)
   this.db.prepare('UPDATE memory_keys SET version=version+1,forgotten=1,forgotten_seq=?,assertion_id=NULL WHERE person_key=? AND key IN (SELECT key FROM staged_forget_keys)').run(watermark,personKey)
   return this.receipt(personKey,input.mutationId,digest,keys)
  })
  try{this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')}catch(error){throw new MemoryError('write-uncertain')}return receipt
 }
 /** @param raw - authorized owner selection. @param now - recording time. @returns a new confirmed version without rewriting its original candidate. */
 confirm(raw:unknown,now:number):MutationReceipt{
  const input=confirmSchema.parse(raw),personKey=this.personKey(input.person),digest=hash(JSON.stringify(['confirm',input]))
  return this.transaction(()=>{
   const replay=this.replay(personKey,input.mutationId,digest);if(replay)return replay
   const previous=this.currentHead(personKey,input.key);if(!previous||previous.version!==input.expectedVersion)throw new MemoryError('conflict');if(previous.forgotten||!previous.assertionId)throw new MemoryError('forgotten')
   const row=this.db.prepare('SELECT category FROM assertions WHERE id=?').get(previous.assertionId);if(!row)throw new MemoryError('unavailable');if(row['category']==='owner-confirmed')throw new MemoryError('conflict')
   const id=brandString<AssertionId>(randomUUID()),version=previous.version+1
   const inserted=this.db.prepare("INSERT INTO assertions(id,person_key,key,version,source_key,content,quote,kind,category,effective_at,recorded_at,replaces_id) SELECT ?,person_key,key,?,source_key,content,quote,kind,'owner-confirmed',effective_at,?,id FROM assertions WHERE id=?").run(id,version,now,previous.assertionId);if(Number(inserted.changes)!==1)throw new MemoryError('unavailable')
   this.db.prepare('UPDATE memory_keys SET version=?,assertion_id=? WHERE person_key=? AND key=?').run(version,id,personKey,input.key);this.db.exec('UPDATE metadata SET assertions=assertions+1 WHERE id=1')
   return this.receipt(personKey,input.mutationId,digest,[input.key])
  })
 }
 /** @param raw - bounded query over one authorized subject. @returns exact current or historical assertions with revision-bound pagination. */
 recall(raw:unknown):z.infer<typeof import('./commands.ts').pageSchema>{
  if(this.closed)throw new MemoryError('closed')
  const input=readSchema.parse(raw),personKey=this.personKey(input.person),revision=this.revision(personKey)
  if(input.position&&input.position.revision!==revision)throw new MemoryError('stale-cursor')
  const keys=this.db.prepare('SELECT key FROM memory_keys WHERE person_key=? AND key>? AND forgotten=0 ORDER BY key LIMIT ?').all(personKey,input.position?.after??'',input.maxScanKeys+1)
  const assertions:z.infer<typeof assertionSchema>[]=[],heads:MemoryHead[]=[];let chars=0,partial=false,after:string|null=null,scanned=0
  for(const row of keys.slice(0,input.maxScanKeys)){
   const key=z.string().parse(row['key']);after=key;scanned++
   const value=this.db.prepare('SELECT a.*,s.message_id,s.sent_at,s.received_at,s.observed_at FROM assertions a JOIN sources s ON a.source_key=s.source_key WHERE a.person_key=? AND a.key=? AND a.effective_at<=? AND a.recorded_at<=? AND s.forgotten=0 ORDER BY a.version DESC LIMIT 1').get(personKey,key,input.validAt,input.knownAt)
   if(!value)continue
   const item=assertionSchema.parse({id:value['id'],key,version:value['version'],kind:value['kind'],content:value['content'],category:value['category'],effectiveAt:value['effective_at'],recordedAt:value['recorded_at'],evidence:{messageId:value['message_id'],quote:value['quote'],sentAt:value['sent_at'],receivedAt:value['received_at'],observedAt:value['observed_at']},replaces:value['replaces_id']})
   if(!input.candidates&&!['user-requested','owner-confirmed'].includes(item.category))continue
   if(!item.content.includes(input.query)&&!item.evidence.quote.includes(input.query))continue
   const length=JSON.stringify(item).length;if(chars+length>input.maxResultChars){partial=true;continue}
   chars+=length;assertions.push(item);const head=this.currentHead(personKey,key);if(head)heads.push(head)
   if(assertions.length===input.limit)break
  }
  return{assertions,heads,revision,partial,position:after!==null&&scanned<keys.length?{after,revision}:null}
 }
 /** @returns storage counts without subjects, claims or source text. */
 stats():{storedSources:number;redactedSources:number;assertions:number}{if(this.closed)throw new MemoryError('closed');const row=this.db.prepare('SELECT stored_sources,redacted_sources,assertions FROM metadata WHERE id=1').get();return{storedSources:Number(row?.['stored_sources']),redactedSources:Number(row?.['redacted_sources']),assertions:Number(row?.['assertions'])}}
 /** Close SQLite before releasing the exact owned lease. */
 close():void{if(this.closed)return;this.closed=true;try{try{this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')}finally{this.db.close()}}finally{this.release()}}
}
