/** Synthetic installed runtime composition with a fresh, independently owned memory store. */
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {ImRuntime,identifier} from 'dsh-im-kit'
import * as memory from 'dsh-person-memory'
import {mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const area=fileURLToPath(new URL('./memory-profile/',import.meta.url));await mkdir(area,{recursive:true})
const ctx=new Context(),runtime=new ImRuntime(),id=(kind,value)=>identifier('im.'+kind,value)
const fixture=ctx.plugin({name:'memory-consumer-provider',apply(child){child.effect(()=>child.provide('profileContext',{dir:area}));child.effect(()=>child.provide('im',runtime));child.effect(()=>()=>runtime.close())}});await fixture.await()
const plugin=ctx.plugin(memory,memory.Config({enabled:true,tenants:['fixture'],accounts:['bot'],groups:['room']}));await plugin.await()
try{
 const scope={account:{tenantId:id('tenant','fixture'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer','room')},person={scope,subject:id('user','alice')},signal=new AbortController().signal
 await ctx.personMemory.observe({scope,senderId:person.subject,messageId:id('message','one'),parts:[{type:'text',text:'记住：喜欢绿茶'}],sentAt:1,receivedAt:1,directedToBot:false},'live',signal)
 await ctx.personMemory.put({person,actor:person.subject,mutationId:id('mutation','put'),messageId:id('message','one'),key:'drink',kind:'preference',content:'绿茶',quote:'喜欢绿茶',expectedVersion:0,effectiveAt:1,category:'candidate',reopen:false},signal)
 const page=await ctx.personMemory.recall({person,actor:person.subject,query:'',limit:20,validAt:Date.now(),knownAt:Date.now(),candidates:false},signal)
 assert.equal(page.assertions[0].content,'绿茶')
 await ctx.personMemory.forget({person,actor:person.subject,key:'drink',expectedVersion:1,mutationId:id('mutation','forget')},signal)
 assert.equal((await ctx.personMemory.head(person,person.subject,'drink',signal)).forgotten,true)
 console.log(JSON.stringify({passed:true,accepted:page.assertions.length,forgotten:true,realQqMessagesSent:0}))
}finally{await plugin.dispose();await fixture.dispose()}
