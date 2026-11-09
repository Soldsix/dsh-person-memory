/** Synthetic sources seed only the isolated Web profile after its real service is enabled. */
import {writeFile} from 'node:fs/promises'
import {identifier} from 'dsh-im-kit'
export const inject=['profileContext']
export function apply(ctx,config){
 let seeded=false
 ctx.inject(['personMemory'],child=>{
  child.effect(async()=>{
   if(seeded)return
   const id=(kind,value)=>identifier('im.'+kind,value),scope={account:{tenantId:id('tenant','fixture'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer','room')},person={scope,subject:id('user','alice')},signal=new AbortController().signal,now=Date.now()-1000
   for(const [key,content,explicit]of [['drink','绿茶',true],['food','米饭',true],['music','摇滚 <img src=x onerror=alert(1)>',false]]){
    const messageId=id('message','web-'+key),text=(explicit?'记住：':'随口说：')+content
    await child.personMemory.observe({scope,senderId:person.subject,messageId,parts:[{type:'text',text}],sentAt:now,receivedAt:now,directedToBot:false},'live',signal)
    await child.personMemory.put({person,actor:person.subject,mutationId:id('mutation','web-'+key),messageId,key,kind:'preference',content,quote:content,expectedVersion:0,effectiveAt:now,category:'candidate',reopen:false},signal)
   }
   seeded=true;await writeFile(config.ready,JSON.stringify({seeded:3})+'\n')
  })
 })
}
