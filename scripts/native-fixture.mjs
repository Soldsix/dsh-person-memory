/** Synthetic IM/native owner/model composition; it performs no external messaging. */
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {setImmediate as nextTurn,setTimeout as delay} from 'node:timers/promises'
import {ImRuntime,identifier} from 'dsh-im-kit'
import {DatabaseSync} from 'node:sqlite'
import {join} from 'node:path'
export const name='person-memory-native-fixture'
export function apply(ctx,config){
 const im=new ImRuntime(),outputs=[],id=(kind,value)=>identifier('im.'+kind,value),lifetime=new AbortController(),account={tenantId:id('tenant','fixture'),networkId:id('network','onebot11'),accountId:id('account','bot')}
 ctx.effect(()=>()=>im.close());ctx.effect(()=>ctx.provide('im',im));ctx.effect(()=>im.register({account,async availability(){return'available'},async send(value){outputs.push(structuredClone(value));return{status:'accepted',messageIds:[]}},async dispose(){}}))
 ctx.inject(['configEditor','tools','sdkSessionActivation','typertGateway','remoteAccess'],owner=>{const work=probe(owner);owner.effect(()=>async()=>{lifetime.abort();await work})})
 async function probe(owner){
  const checks=[],diagnostics=[],scope=room=>({account,kind:'group',peerId:id('peer',room)}),service=name=>{const value=owner.get(name);assert.ok(value,'Missing '+name);return value};let serial=0
  owner.on('qq-chat/diagnostic',({stage,error})=>diagnostics.push({stage,message:error?.message}))
  const event=(text,sender='alice',room='room',directed=true)=>{const now=Date.now();return{scope:scope(room),senderId:id('user',sender),messageId:id('message','memory-source-'+(++serial)),sentAt:now,receivedAt:now,directedToBot:directed,parts:[{type:'text',text}]}}
  const publish=async(source,expected=2)=>{const result=await im.publish(source,lifetime.signal);assert.equal(result.failed,0,JSON.stringify(diagnostics));assert.equal(result.accepted,expected)}
  const send=(text,sender='alice',room='room',directed=true,expected=2)=>publish(event(text,sender,room,directed),expected)
  try{
   await nextTurn();const deadline=Date.now()+15000;while(!owner.get('personMemoryModelTool')||!owner.get('qqChat')?.status().transportAttached||!owner.get('personMemory')?.status().attached){assert.ok(Date.now()<deadline,'Memory composition did not attach');await delay(20,undefined,{signal:lifetime.signal})}
   const control=service('personMemoryControl'),initial=await control.describe();assert.equal(initial.toolState,'registered');assert.equal(initial.healthy,true);checks.push('native-memory-bundle-and-owner-entry-are-ready')
   const first=event('记住：我喜欢绿茶 MEMORY_NATIVE_REMEMBER_A');await publish(first);assert.equal(outputs.length,1);assert.equal(service('personMemory').status().assertions,1)
   await send('你还记得我喝什么吗 MEMORY_NATIVE_RECALL_A','alice','room',false);assert.equal(outputs.length,2);checks.push('first-live-tool-write-and-unmentioned-recall-use-native-authentication')
   await send('MEMORY_NATIVE_RECALL_B','bob');assert.equal(outputs.length,3)
   await send('MEMORY_NATIVE_ADMIN','admin');assert.equal(outputs.length,4);await send('MEMORY_NATIVE_ADMIN_OTHER','admin','room-two');assert.equal(outputs.length,5);checks.push('separate-person-sessions-and-operator-reads-stay-in-selected-scope')
   await send('更新记忆：现在改喝咖啡 MEMORY_NATIVE_CORRECT_A');await send('MEMORY_NATIVE_RECALL_CORRECTED');assert.equal(outputs.length,7);assert.equal(service('personMemory').status().assertions,2);checks.push('new-source-correction-replaces-the-current-view-without-erasing-its-history')
   const ownerPeer={id:'memory-owner',ctx:owner,principal:{kind:'owner'},signal:lifetime.signal,interactions:'none',async dispose(){}}
   const invoke=(method,args={},peer=ownerPeer)=>owner.typertGateway.invoke({namespace:'personMemoryControl',method,args,peer,signal:lifetime.signal})
   owner.effect(()=>owner.remoteAccess.registerPolicy('memory-test-guest',{bindings:()=>[{resource:{kind:'global'},role:{name:'memory-qa',resource:'global',actions:['personMemoryControl/describe','personMemoryControl/save','personMemoryControl/inspect','personMemoryControl/confirm','personMemoryControl/forget']}}]}))
   const guest={...ownerPeer,id:'memory-guest',principal:{kind:'memory-test-guest'}},person={scope:scope('room'),subject:id('user','alice')},now=Date.now()
   for(const [method,args]of [['describe',{}],['save',{request:{revision:initial.revision,patch:{enabled:false}}}],['inspect',{request:{person,query:'',limit:10,validAt:now,knownAt:now,candidates:true}}],['confirm',{request:{person,key:'preference.drink',expectedVersion:2,mutationId:'guest-confirm'}}],['forget',{request:{person,key:'preference.drink',expectedVersion:2,mutationId:'guest-forget'}}]])await assert.rejects(invoke(method,args,guest),error=>error.code==='person-memory/control'&&error.details.reason==='forbidden')
   const view=await invoke('inspect',{request:{person,query:'',limit:10,validAt:now,knownAt:now,candidates:false}});assert.equal(view.page.assertions[0].content,'咖啡');checks.push('all-native-owner-operations-refuse-non-owner-even-with-a-global-policy')
   await send('忘记我喝什么 MEMORY_NATIVE_FORGET_A');assert.equal(service('personMemory').status().assertions,0);await send('MEMORY_NATIVE_RECALL_FORGOTTEN');assert.equal(outputs.length,9)
   await publish({...first,receivedAt:Date.now()});assert.equal(outputs.length,9);assert.equal(service('personMemory').status().assertions,0);checks.push('forgetting-redacts-linked-sources-and-replay-does-not-regenerate-or-resurrect')
   const a=event('我也许喜欢可可','witness','room',false);await publish(a);assert.equal(outputs.length,9)
   const witness={scope:a.scope,subject:a.senderId};await service('personMemory').put({person:witness,actor:a.senderId,mutationId:'candidate-proposal',key:'preference.drink',content:'可可',quote:'我也许喜欢可可',messageId:a.messageId,expectedVersion:0,kind:'preference',effectiveAt:a.sentAt,category:'candidate',reopen:false},lifetime.signal)
   const candidate=await invoke('inspect',{request:{person:witness,query:'',limit:10,validAt:Date.now(),knownAt:Date.now(),candidates:true}});assert.equal(candidate.page.assertions[0].category,'candidate')
   await invoke('confirm',{request:{person:witness,key:'preference.drink',expectedVersion:1,mutationId:'owner-confirmation'}});const accepted=await invoke('inspect',{request:{person:witness,query:'',limit:10,validAt:Date.now(),knownAt:Date.now(),candidates:false}});assert.equal(accepted.page.assertions[0].category,'owner-confirmed');checks.push('owner-confirms-a-new-version-with-original-source-evidence')
   await Promise.all([send('MEMORY_NATIVE_PARALLEL_A'),send('MEMORY_NATIVE_PARALLEL_B','bob','room-two')]);assert.equal(outputs.length,11);checks.push('parallel-conversations-keep-memory-and-model-histories-separate')
   const locked=new DatabaseSync(join(config.memoryDirectory,'memory.sqlite3'));let unlocked=false
   try{
    locked.exec('BEGIN IMMEDIATE');const plain=event('MEMORY_NATIVE_PLAIN'),pending=publish(plain);pending.catch(()=>{})
    const until=Date.now()+10000;while(!outputs.some(value=>value.parts.some(part=>part.type==='reply'&&part.messageId===plain.messageId))){assert.ok(Date.now()<until,'Chat did not reply while memory was waiting');await delay(10,undefined,{signal:lifetime.signal})}
    assert.ok(service('personMemory').status().pending>0,'No storage operation was held when chat replied');locked.exec('COMMIT');unlocked=true;await pending;assert.equal(outputs.length,12)
   }finally{if(!unlocked)locked.exec('ROLLBACK');locked.close()}
   checks.push('plain-chat-replies-before-a-blocked-memory-ingestion-is-acknowledged')
   let saved=await invoke('describe');const previousRuntimeId=saved.runtimeId;saved=await invoke('save',{request:{revision:saved.revision,patch:{maxScanKeys:300}}});assert.equal(saved.config.maxScanKeys,300);assert.notEqual(saved.runtimeId,previousRuntimeId)
   const restored=await invoke('inspect',{request:{person:witness,query:'',limit:10,validAt:Date.now(),knownAt:Date.now(),candidates:false}});assert.equal(restored.page.assertions[0].content,'可可');assert.equal(restored.view.runtimeId,saved.runtimeId)
   await send('MEMORY_NATIVE_RECALL_AFTER_RELOAD');assert.equal(outputs.length,13);assert.equal(service('personMemory').status().assertions,2);checks.push('native-config-reload-retains-accepted-data-and-forgetting-tombstones')
   saved=await invoke('describe');await invoke('save',{request:{revision:saved.revision,patch:{enabled:false}}});assert.equal(owner.get('personMemory'),undefined);assert.equal((await invoke('describe')).active,false)
   await send('MEMORY_NATIVE_DISABLED','alice','room',true,1);assert.equal(outputs.length,14);checks.push('disabled-memory-keeps-its-owner-entry-and-does-not-disable-chat')
   await writeFile(config.resultPath,JSON.stringify({passed:true,checks,outputs:outputs.length,realModelApiRequests:0,realQqMessagesSent:0},null,2)+'\n')
  }catch(error){await writeFile(config.resultPath,JSON.stringify({passed:false,checks,error:{message:error.message,stack:error.stack},diagnostics},null,2)+'\n')}
 }
}
