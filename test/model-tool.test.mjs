import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {scheduler} from 'node:timers/promises'
import {identifier} from 'dsh-im-kit'
import {RequestAuthority} from 'dsh-im-requests'
import {assertSupportedJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {Config,resolve} from '../dist/config.js'
import {MemoryEngine} from '../dist/engine.js'
import {MemoryModelTool} from '../dist/model-tool.js'
const id=(kind,value)=>identifier('im.'+kind,value),NOW=Date.UTC(2026,10,9,8)
const scope=(room='room')=>({account:{tenantId:id('tenant','tenant'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer',room)})
const root=new URL('../.test-artifacts/model-tool/',import.meta.url);await mkdir(root,{recursive:true})
async function fixture(t,{mode='sender',memory:custom}={}){
 const dir=await mkdtemp(new URL('run-',root)),spec=resolve(Config({enabled:true,directory:dir,tenants:['tenant'],accounts:['bot'],groups:['room'],operators:[{tenant:'tenant',network:'onebot11',account:'bot',user:'admin'}]}),dir),memory=custom??await MemoryEngine.open(spec,()=>NOW),authority=new RequestAuthority(mode),tool=new MemoryModelTool(spec,memory,authority.service,()=>NOW),definition=tool.definition()
 t.after(async()=>{authority.close();await tool.close();if(!custom)await memory.close()})
 const source=async(message,text,sender='alice')=>{await memory.observe({scope:scope(),messageId:id('message',message),senderId:id('user',sender),sentAt:NOW,receivedAt:NOW,directedToBot:true,parts:[{type:'text',text}]},'live',new AbortController().signal)}
 const bind=(message='one',sender='alice',room='room')=>{const owner={id:randomUUID()},parent=new AbortController(),lease=authority.open(owner,{id:randomUUID(),scope:scope(room),senderId:id('user',sender),messageId:id('message',message)},parent.signal);lease.activate();return{owner,parent,lease,exec:{agent:owner,callId:randomUUID(),signal:parent.signal}}}
 return{memory,source,bind,tool,definition,authority}
}
const remember={action:'remember',key:'preference.drink',kind:'preference',content:'绿茶',quote:'我喜欢绿茶',expectedVersion:0}
test('native schemas and canonical memory results are enforced; only reads are concurrency-safe',async t=>{
 const f=await fixture(t);assertSupportedJsonSchema(f.definition.parameters);assertSupportedJsonSchema(f.definition.output.schema)
 await f.source('one','记住：我喜欢绿茶');const a=f.bind(),stored=await f.definition.execute(remember,a.exec);assert.equal(stored.status,'ok');assert.equal(stored.receipt.heads[0].version,1)
 const read=await f.definition.execute({action:'recall'},a.exec);assert.equal(read.page.assertions[0].content,'绿茶');assert.equal(read.page.assertions[0].category,'user-requested');assert.equal(validateJsonSchemaValue(f.definition.output.schema,read).length,0)
 assert.equal(f.definition.isConcurrencySafe({action:'recall'}),true);assert.equal(f.definition.isConcurrencySafe(remember),false);assert.equal(f.definition.presentCall({action:'head',key:'preference.drink'}).kind,'other');assert.match(f.definition.output.render({},read)[0].text,/untrusted data/)
})
test('identity, scope, source message, classification and operation IDs cannot be promoted by model JSON',async t=>{
 const f=await fixture(t);await f.source('one','记住：我喜欢绿茶');const a=f.bind()
 for(const extra of [{actor:'admin'},{person:{subject:'bob'}},{scope:scope('other')},{messageId:'another'},{mutationId:'choose-operation'},{category:'owner-confirmed'},{action:'confirm'}]){
  const value=await f.definition.execute({...remember,...extra},a.exec);assert.equal(value.status,'refused');assert.equal(value.reason,'invalid-data');assert.equal(f.memory.status().assertions,0)
 }
 const copied={...a.exec,agent:{id:a.owner.id}};assert.equal((await f.definition.execute(remember,copied)).reason,'unbound-request')
 assert.equal((await f.definition.execute(remember,{...a.exec,agent:undefined})).reason,'unbound-request')
 const foreign=f.bind('one','alice','other');assert.equal((await f.definition.execute(remember,foreign.exec)).reason,'forbidden')
})
test('requester isolation is enforced through the actual store and administrator reads stay in the current group',async t=>{
 const f=await fixture(t);await f.source('one','记住：我喜欢绿茶');const a=f.bind();await f.definition.execute(remember,a.exec);a.lease.close()
 await f.source('bob','记住：B_CANARY','bob');const b=f.bind('bob','bob');assert.equal((await f.definition.execute({action:'recall'},b.exec)).page.assertions.length,0)
 assert.equal((await f.definition.execute({action:'recall',subject:'alice'},b.exec)).reason,'forbidden');b.lease.close()
 const admin=f.bind('admin','admin');const value=await f.definition.execute({action:'recall',subject:'alice'},admin.exec);assert.deepEqual(value.page.assertions.map(x=>x.content),['绿茶'])
 assert.equal((await f.definition.execute({...remember,subject:'alice'},admin.exec)).reason,'invalid-data')
})
test('shared group Sessions cannot cache personal tool results for another participant',async t=>{
 const f=await fixture(t,{mode:'shared'});await f.source('one','记住：我喜欢绿茶');const a=f.bind();assert.equal((await f.definition.execute(remember,a.exec)).reason,'sender-isolation-required');assert.equal(f.memory.status().assertions,0)
})
test('replayed tool calls preserve their hidden mutation ID and stale versions do not write twice',async t=>{
 const f=await fixture(t);await f.source('one','记住：我喜欢绿茶');const a=f.bind(),first=await f.definition.execute(remember,a.exec),again=await f.definition.execute(remember,a.exec)
 assert.equal(first.receipt.outcome,'applied');assert.equal(again.receipt.outcome,'duplicate');assert.equal(first.receipt.mutationId,again.receipt.mutationId);assert.equal(f.memory.status().assertions,1)
 assert.equal((await f.definition.execute(remember,{...a.exec,callId:randomUUID()})).reason,'conflict')
})
test('forgetting requires current explicit intent and revokes access to old versions without replaying a write',async t=>{
 const f=await fixture(t);await f.source('one','记住：我喜欢绿茶');const a=f.bind();await f.definition.execute(remember,a.exec)
 assert.equal((await f.definition.execute({action:'forget',key:'preference.drink',expectedVersion:1},a.exec)).reason,'forbidden');a.lease.close()
 await f.source('keep','不要忘记我喜欢绿茶');const keep=f.bind('keep');assert.equal((await f.definition.execute({action:'forget',key:'preference.drink',expectedVersion:1},keep.exec)).reason,'forbidden');keep.lease.close()
 await f.source('erase','忘记我喜欢什么茶');const erase=f.bind('erase'),result=await f.definition.execute({action:'forget',key:'preference.drink',expectedVersion:1},erase.exec)
 assert.equal(result.status,'ok');assert.equal(result.receipt.heads[0].forgotten,true);assert.deepEqual((await f.definition.execute({action:'recall',candidates:true},erase.exec)).page.assertions,[])
})
test('late read data is discarded after the live lease ends and close waits for the owned query body',async t=>{
 let release,entered=false,finished=false;const gate=new Promise(done=>{release=done}),memory={async recall(){entered=true;await gate;finished=true;return{assertions:[],heads:[],revision:0,partial:false,next:null}}}
 const f=await fixture(t,{memory}),a=f.bind(),pending=f.definition.execute({action:'recall'},a.exec);while(!entered)await scheduler.yield();a.lease.close();let closed=false;const close=f.tool.close().then(()=>{closed=true});await scheduler.yield();assert.equal(closed,false)
 release();assert.equal((await pending).reason,'request-ended');await close;assert.equal(finished,true);assert.equal(closed,true)
})
test('operational failures do not include private backend diagnostics',async t=>{
 const f=await fixture(t,{memory:{async recall(){throw Error('SYNTHETIC_PRIVATE_DATABASE_PATH_AND_KEY')}}}),a=f.bind()
 await assert.rejects(f.definition.execute({action:'recall'},a.exec),error=>error.message==='PERSON_MEMORY_UNAVAILABLE'&&!error.message.includes('SYNTHETIC_PRIVATE'))
})

test('malformed model-selected subject IDs are refused in execution and presentation',async t=>{
 const f=await fixture(t),a=f.bind()
 for(const subject of ['', ' alice', 'alice\n', '\u0000', 'x'.repeat(1025)]){
  const input={action:'recall',subject}
  assert.equal((await f.definition.execute(input,a.exec)).reason,'invalid-data')
  assert.equal(f.definition.isConcurrencySafe(input),false)
  assert.equal(f.definition.presentCall(input),undefined)
 }
})
