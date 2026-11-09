import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {scheduler} from 'node:timers/promises'
import {identifier} from 'dsh-im-kit'
import {Config,resolve} from '../dist/config.js'
import {MemoryEngine} from '../dist/engine.js'
const root=new URL('../.test-artifacts/core/',import.meta.url);await mkdir(root,{recursive:true})
const id=(domain,value)=>identifier('im.'+domain,value),MON=Date.UTC(2026,10,2,9),TUE=MON+86400000,WED=TUE+86400000,THU=WED+86400000,NOW=THU+86400000
function person(subject='alice',room='room',account='bot',kind='group'){return{scope:{account:{tenantId:id('tenant','tenant'),networkId:id('network','onebot11'),accountId:id('account',account)},kind,peerId:id('peer',room)},subject:id('user',subject)}}
const base={enabled:true,tenants:['tenant'],accounts:['bot'],groups:['room','other'],privatePeers:['alice'],operators:[{tenant:'tenant',network:'onebot11',account:'bot',user:'admin'}]}
async function fixture(t,options={}){
 const dir=await mkdtemp(new URL('run-',root)),spec=resolve(Config({...base,directory:dir,...options}),dir),events=[];let now=MON
 const engine=await MemoryEngine.open(spec,()=>now,(person,revision)=>events.push({person,revision}));t.after(()=>engine.close())
 const source=(message,text,who=person(),sentAt=now)=>({scope:who.scope,senderId:who.subject,messageId:id('message',message),sentAt,receivedAt:now,directedToBot:true,parts:[{type:'text',text}]})
 const observe=(message,text,who=person(),origin='live',sentAt=now)=>engine.observe(source(message,text,who,sentAt),origin,new AbortController().signal)
 const put=(message,key,content,expectedVersion=0,extra={})=>engine.put({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key,content,quote:content,messageId:id('message',message),expectedVersion,kind:'preference',effectiveAt:now,category:'candidate',reopen:false,...extra},new AbortController().signal)
 const recall=(extra={})=>engine.recall({person:person(),actor:id('user','alice'),query:'',limit:20,validAt:NOW,knownAt:NOW,candidates:false,...extra},new AbortController().signal)
 return{dir,spec,engine,events,source,observe,put,recall,setNow:value=>{now=value},signal:new AbortController().signal}
}
test('disabled and invalid settings do not create memory storage',async()=>{
 const dir=await mkdtemp(new URL('disabled-',root)),target=join(dir,'absent')
 assert.equal(resolve(Config({directory:target}),dir),null);await assert.rejects(access(target))
 for(const settings of [{enabled:true},{...base,groups:['room','room']},{...base,busyMs:5000,requestTimeoutMs:1000},{...base,namespace:'../foreign'},{...base,maxResults:10,maxScanKeys:2}])assert.throws(()=>resolve(Config(settings),dir))
 assert.throws(()=>resolve(Config({enabled:false,groups:['room','room']}),dir))
})
test('large source-linked retractions stay atomic and receipts explicitly bound their head list',async t=>{
 const f=await fixture(t,{maxResults:1});await f.observe('one','记住：绿茶 咖啡');await f.put('one','drink','绿茶');await f.put('one','backup','咖啡')
 const receipt=await f.engine.forget({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key:'drink',expectedVersion:1},f.signal)
 assert.equal(receipt.affectedKeys,2);assert.equal(receipt.heads.length,1);assert.equal(receipt.headsTruncated,true);assert.equal(f.engine.status().assertions,0)
})

test('queued source ingestion snapshots scope and message fields before caller mutation',async t=>{
 const f=await fixture(t),input=f.source('snapshot','记住：绿茶'),pending=f.engine.observe(input,'live',f.signal)
 input.scope.peerId=id('peer','unselected');input.messageId=id('message','changed');input.parts[0].text='changed'
 assert.equal(await pending,'stored')
 await f.put('snapshot','drink','绿茶');assert.equal((await f.recall()).assertions[0].content,'绿茶')
})

test('redacted archive backfill updates body-free counters without a later mutation',async t=>{
 const f=await fixture(t);await f.observe('one','记住：绿茶');await f.put('one','drink','绿茶')
 f.setNow(TUE);await f.engine.forget({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key:'drink',expectedVersion:1},f.signal)
 const before=f.engine.status().redactedSources
 assert.equal(await f.observe('old-archive','旧来源',person(),'archive',MON),'redacted')
 assert.equal(f.engine.status().redactedSources,before+1)
})
test('a week-long timeline uses both effective and recorded times; old-source extraction cannot overwrite a correction',async t=>{
 const f=await fixture(t);await f.observe('mon','记住：我喜欢绿茶');const first=await f.put('mon','preference.drink','绿茶');assert.equal(first.heads[0].version,1)
 f.setNow(WED);await f.observe('wed','更新记忆：我现在喝咖啡');const changed=await f.put('wed','preference.drink','咖啡',1);assert.equal(changed.heads[0].version,2)
 assert.equal((await f.recall({validAt:TUE})).assertions[0].content,'绿茶')
 assert.equal((await f.recall()).assertions[0].content,'咖啡')
 assert.equal((await f.recall({knownAt:TUE})).assertions[0].content,'绿茶')
 assert.equal((await f.recall({query:'绿茶'})).assertions.length,0)
 await assert.rejects(f.put('mon','preference.drink','绿茶',2),error=>error.code==='conflict')
 assert.equal((await f.recall()).assertions[0].evidence.messageId,'wed');assert.equal(f.events.length,2)
})
test('a later correction can backdate its effective date without erasing the earlier knowledge state',async t=>{
 const f=await fixture(t);await f.observe('mon','记住我喜欢绿茶');await f.put('mon','drink','绿茶')
 f.setNow(WED);await f.observe('wed','记住我改喝咖啡');await f.put('wed','drink','咖啡',1)
 f.setNow(THU);await f.observe('thu','更正记忆：从周二开始喝乌龙');await f.put('thu','drink','乌龙',2,{effectiveAt:TUE})
 assert.equal((await f.recall({validAt:MON})).assertions[0].content,'绿茶')
 assert.equal((await f.recall({validAt:WED})).assertions[0].content,'乌龙')
 assert.equal((await f.recall({validAt:WED,knownAt:WED})).assertions[0].content,'咖啡')
})
test('model proposals, jokes and roleplay do not become accepted real-life memories',async t=>{
 const f=await fixture(t);await f.observe('guess','假如我喜欢伏特加，那我就是鲸鱼宇航员');await f.put('guess','drink','伏特加')
 await f.observe('joke','记住：今天我统治银河系');await f.put('joke','story','统治银河系',0,{category:'roleplay',kind:'note'})
 await f.observe('paraphrase','记住：我喝红茶');await f.put('paraphrase','invented','可乐',0,{quote:'我喝红茶'})
 assert.deepEqual((await f.recall()).assertions,[])
 const proposals=(await f.recall({candidates:true})).assertions;assert.equal(proposals.length,3);assert.ok(proposals.every(value=>!['user-requested','owner-confirmed'].includes(value.category)))
 assert.ok(proposals.every(value=>value.evidence.quote&&value.evidence.messageId))
})
test('source evidence and authenticated subject are required before a memory write',async t=>{
 const f=await fixture(t);await f.observe('source','记住：我喝绿茶')
 await assert.rejects(f.put('source','drink','红茶'),error=>error.code==='evidence-mismatch')
 await assert.rejects(f.put('missing','drink','绿茶'),error=>error.code==='source-missing')
 await assert.rejects(f.put('source','drink','绿茶',0,{actor:id('user','bob')}),error=>error.code==='forbidden')
 await assert.rejects(f.put('source','drink','绿茶',0,{actor:id('user','admin')}),error=>error.code==='forbidden')
 assert.equal(f.engine.status().assertions,0)
})
test('people, accounts, conversations and private peers stay isolated; explicit operators may only read across subjects',async t=>{
 const f=await fixture(t);await f.observe('a','记住：A_CANARY');await f.put('a','note','A_CANARY')
 await f.observe('b','记住：B_CANARY',person('bob'));await f.put('b','note','B_CANARY',0,{person:person('bob'),actor:id('user','bob')})
 assert.deepEqual((await f.recall()).assertions.map(x=>x.content),['A_CANARY'])
 await assert.rejects(f.recall({actor:id('user','bob')}),error=>error.code==='forbidden')
 assert.deepEqual((await f.recall({actor:id('user','admin')})).assertions.map(x=>x.content),['A_CANARY'])
 assert.deepEqual((await f.recall({person:person('alice','other')})).assertions,[])
 await assert.rejects(f.recall({person:person('alice','room','another')}),error=>error.code==='forbidden')
 await assert.rejects(f.recall({person:person('bob','alice','bot','private'),actor:id('user','bob')}),error=>error.code==='forbidden')
 await f.observe('private','记住：PRIVATE_CANARY',person('alice','alice','bot','private'));await f.put('private','note','PRIVATE_CANARY',0,{person:person('alice','alice','bot','private')})
 assert.deepEqual((await f.recall({person:person('alice','alice','bot','private')})).assertions.map(x=>x.content),['PRIVATE_CANARY'])
})
test('duplicate sources preserve identity and a changed sender or body is a conflict',async t=>{
 const f=await fixture(t);assert.equal(await f.observe('one','original'),'stored');assert.equal(await f.observe('one','original'),'duplicate')
 assert.equal(await f.observe('one','changed'),'conflict');assert.equal(await f.observe('one','original',person('bob')),'conflict');assert.equal(f.engine.status().storedSources,1)
})
test('simultaneous corrections use optimistic versions and never overwrite each other',async t=>{
 const f=await fixture(t);await f.observe('one','记住：绿茶');await f.put('one','drink','绿茶');f.setNow(TUE)
 await f.observe('two','记住：咖啡');await f.observe('three','记住：红茶')
 const outcomes=await Promise.allSettled([f.put('two','drink','咖啡',1),f.put('three','drink','红茶',1)])
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'conflict')
 assert.equal((await f.engine.head(person(),id('user','alice'),'drink',f.signal)).version,2);assert.equal(f.engine.status().assertions,2)
})
test('mutation replay is idempotent; a changed payload under the same operation ID is refused',async t=>{
 const f=await fixture(t);await f.observe('one','记住：绿茶和红茶');const mutationId=randomUUID(),first=await f.put('one','drink','绿茶',0,{mutationId}),again=await f.put('one','drink','绿茶',0,{mutationId})
 assert.equal(first.outcome,'applied');assert.equal(again.outcome,'duplicate');assert.equal(again.revision,first.revision);assert.equal(f.engine.status().assertions,1)
 await assert.rejects(f.put('one','drink','红茶',0,{mutationId}),error=>error.code==='conflict')
})
test('forgetting redacts all revisions and source-linked assertions; replay, new mutation IDs and backfill cannot revive them',async t=>{
 const f=await fixture(t),canary='ERASE_THIS_MEMORY_CANARY_58';await f.observe('one','记住：'+canary+' also');const mutationId=randomUUID();await f.put('one','drink',canary,0,{mutationId});await f.put('one','note','also')
 f.setNow(TUE);await f.observe('two','记住：NEXT_CANARY');await f.put('two','drink','NEXT_CANARY',1)
 const forgotten=await f.engine.forget({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key:'drink',expectedVersion:2},f.signal)
 assert.deepEqual(new Set(forgotten.heads.map(x=>x.key)),new Set(['drink','note']));assert.ok(forgotten.heads.every(x=>x.forgotten))
 assert.deepEqual((await f.recall({candidates:true})).assertions,[]);assert.equal(f.engine.status().assertions,0);assert.equal(f.engine.status().redactedSources,2)
 assert.equal(await f.observe('one','记住：'+canary+' also',person(),'live',MON),'redacted')
 const replay=await f.put('one','drink',canary,0,{mutationId,effectiveAt:MON});assert.equal(replay.outcome,'duplicate');assert.ok(replay.heads[0].forgotten);assert.ok(replay.currentRevision>replay.revision)
 await assert.rejects(f.put('one','drink',canary,3,{reopen:true}),error=>error.code==='forgotten')
 f.setNow(WED);await f.observe('backfill','记住：'+canary,person(),'archive',MON);await assert.rejects(f.put('backfill','drink',canary,3,{reopen:true}),error=>error.code==='forgotten')
 await f.engine.close();const bytes=await readFile(join(f.dir,'memory.sqlite3'));assert.equal(bytes.includes(Buffer.from(canary)),false);assert.equal(bytes.includes(Buffer.from('NEXT_CANARY')),false)
})
test('only a fresh explicit source can reopen a forgotten key, with its retained revision',async t=>{
 const f=await fixture(t);await f.observe('one','记住：绿茶');await f.put('one','drink','绿茶');await f.engine.forget({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key:'drink',expectedVersion:1},f.signal)
 f.setNow(TUE);await f.observe('new','记住：现在重新记下咖啡')
 await assert.rejects(f.put('new','drink','咖啡',0,{reopen:true}),error=>error.code==='conflict')
 await assert.rejects(f.put('new','drink','咖啡',2),error=>error.code==='forgotten')
 await f.put('new','drink','咖啡',2,{reopen:true});assert.equal((await f.recall()).assertions[0].content,'咖啡')
})
test('live sources with coarse equal timestamps can be fresh, while older unused material stays behind the forgetting fence',async t=>{
 const f=await fixture(t);await f.observe('one','记住：绿茶');await f.observe('unused','记住：以前另说过旧地址');await f.put('one','drink','绿茶')
 await f.engine.forget({person:person(),actor:id('user','alice'),mutationId:randomUUID(),key:'drink',expectedVersion:1},f.signal)
 await assert.rejects(f.put('unused','address','旧地址'),error=>error.code==='forgotten')
 await f.observe('fresh','记住：现在重新记咖啡');await f.put('fresh','drink','咖啡',2,{reopen:true})
 assert.equal((await f.recall()).assertions[0].content,'咖啡')
})
test('owner confirmation appends a version, retains evidence, and does not allow its source to overwrite the confirmed result',async t=>{
 const f=await fixture(t);await f.observe('one','我也许喜欢可可');await f.put('one','drink','可可');assert.deepEqual((await f.recall()).assertions,[])
 const mutationId=randomUUID(),request={person:person(),mutationId,key:'drink',expectedVersion:1};await f.engine.confirm(request,f.signal)
 const value=(await f.recall()).assertions[0];assert.equal(value.category,'owner-confirmed');assert.equal(value.version,2);assert.equal(value.evidence.quote,'可可');assert.ok(value.replaces)
 const replay=await f.engine.confirm(request,f.signal);assert.equal(replay.outcome,'duplicate');assert.equal(f.engine.status().assertions,2)
 await assert.rejects(f.put('one','drink','可可',2),error=>error.code==='conflict')
})
test('encrypted pagination binds requester, filters, scope, restart and revision',async t=>{
 const f=await fixture(t);for(let n=0;n<3;n++){await f.observe('s'+n,'记住：VALUE_'+n);await f.put('s'+n,'key'+n,'VALUE_'+n)}
 const first=await f.recall({limit:1});assert.ok(first.next);const second=await f.recall({limit:1,before:first.next});assert.notEqual(first.assertions[0].key,second.assertions[0].key)
 for(const input of [{actor:id('user','admin')},{query:'different'},{person:person('alice','other')},{candidates:true}])await assert.rejects(f.recall({limit:1,before:first.next,...input}),error=>error.code==='invalid-data')
 await f.observe('four','记住：VALUE_4');await f.put('four','key4','VALUE_4');await assert.rejects(f.recall({limit:1,before:first.next}),error=>error.code==='stale-cursor')
 await f.engine.close();const restarted=await MemoryEngine.open(f.spec,()=>NOW);t.after(()=>restarted.close());await assert.rejects(restarted.recall({person:person(),actor:id('user','alice'),query:'',limit:1,validAt:NOW,knownAt:NOW,candidates:false,before:second.next},f.signal),error=>error.code==='invalid-data')
 assert.equal((await restarted.recall({person:person(),actor:id('user','alice'),query:'',limit:20,validAt:NOW,knownAt:NOW,candidates:false},f.signal)).assertions.length,4)
})
test('a live owner is not displaced and retained namespace changes are refused',async t=>{
 const f=await fixture(t);await assert.rejects(MemoryEngine.open(f.spec),error=>error.code==='owned');await f.observe('one','记住：still alive');await f.put('one','alive','still alive')
 await f.engine.close();const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(join(f.dir,'memory.sqlite3')))
 await assert.rejects(MemoryEngine.open({...f.spec,namespace:'another'}),error=>error.code==='forbidden');assert.equal(hash(await readFile(join(f.dir,'memory.sqlite3'))),before)
 await assert.rejects(access(join(f.dir,'owner.lock')))
})
test('foreign and future databases are refused without rewriting their bytes',async()=>{
 for(const future of [false,true]){
  const dir=await mkdtemp(new URL('unsupported-',root)),path=join(dir,'memory.sqlite3'),db=new DatabaseSync(path)
  db.exec(future?'PRAGMA application_id=1146309957;PRAGMA user_version=99':'CREATE TABLE foreign_table(value TEXT);INSERT INTO foreign_table VALUES(\'retained\')');db.close()
  const before=await readFile(path),spec=resolve(Config({...base,directory:dir}),dir);await assert.rejects(MemoryEngine.open(spec),error=>error.code==='schema-unsupported');assert.deepEqual(await readFile(path),before)
 }
})
test('capacity, maintenance and cancellation remain isolated while SQLite is busy',async t=>{
 const f=await fixture(t,{maxPending:1});await f.observe('one','记住：绿茶');const other=new DatabaseSync(join(f.dir,'memory.sqlite3'));t.after(()=>other.close());other.exec('BEGIN IMMEDIATE')
 const abort=new AbortController(),pending=f.put('one','drink','绿茶',0);pending.catch(()=>{})
 while(f.engine.status().pending===0)await scheduler.yield()
 assert.equal(f.engine.beginMaintenance(),false);await assert.rejects(f.put('one','second','绿茶'),error=>error.code==='capacity');other.exec('COMMIT');await pending
 assert.equal(f.engine.beginMaintenance(),true);await assert.rejects(f.recall(),error=>error.code==='busy');f.engine.endMaintenance()
 abort.abort();await assert.rejects(f.engine.recall({person:person(),actor:id('user','alice'),query:'',limit:1,validAt:NOW,knownAt:NOW,candidates:false},abort.signal),error=>error.code==='cancelled')
 assert.equal((await f.recall()).assertions.length,1)
})
