import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,access} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ImRuntime,identifier} from 'dsh-im-kit'
import * as memory from '../dist/index.js'
const root=new URL('../.test-artifacts/runtime/',import.meta.url);await mkdir(root,{recursive:true})
test('disabled independent memory creates no directory and no service',async t=>{
 const dir=await mkdtemp(new URL('disabled-',root)),ctx=new Context(),fixture=ctx.plugin({name:'memory-profile',apply(child){child.effect(()=>child.provide('profileContext',{dir}))}});await fixture.await();const plugin=ctx.plugin(memory,memory.Config({}));await plugin.await();t.after(async()=>{await plugin.dispose();await fixture.dispose()});assert.equal(ctx.get('personMemory'),undefined);await assert.rejects(access(join(dir,'data')))
})
test('normalized ingestion records sources without producing messages and detaches on unload',async t=>{
 const dir=await mkdtemp(new URL('ingest-',root)),ctx=new Context(),im=new ImRuntime(),fixture=ctx.plugin({name:'memory-profile',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('im',im));child.effect(()=>()=>im.close())}});await fixture.await();const plugin=ctx.plugin(memory,memory.Config({enabled:true,tenants:['tenant'],accounts:['bot'],groups:['room']}));await plugin.await();t.after(async()=>{await plugin.dispose();await fixture.dispose()})
 const service=ctx.get('personMemory');assert.ok(service);assert.equal(service.status().attached,true)
 const id=(domain,value)=>identifier('im.'+domain,value),source={scope:{account:{tenantId:id('tenant','tenant'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer','room')},senderId:id('user','alice'),messageId:id('message','only-source'),sentAt:1,receivedAt:2,directedToBot:false,parts:[{type:'text',text:'remember that I like tea'}]}
 assert.deepEqual(await im.publish(source),{accepted:1,failed:0});assert.equal(service.status().storedSources,1);assert.deepEqual(await im.publish({...source,scope:{...source.scope,peerId:id('peer','excluded')}}),{accepted:0,failed:0});assert.equal(service.status().storedSources,1)
 await plugin.dispose();assert.equal(ctx.get('personMemory'),undefined);assert.deepEqual(await im.publish({...source,messageId:id('message','after-unload')}),{accepted:0,failed:0});await assert.rejects(service.recall({person:{scope:source.scope,subject:source.senderId},actor:source.senderId,query:'',limit:1,validAt:3,knownAt:3,candidates:false},new AbortController().signal),error=>error.code==='closed')
})
