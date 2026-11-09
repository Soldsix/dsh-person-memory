/** Process-owned lease fixture; a requested exit skips normal worker teardown. */
import {MemoryEngine} from '../dist/engine.js'
import {Config,resolve} from '../dist/config.js'
import {identifier} from 'dsh-im-kit'
const directory=process.argv[2],id=(kind,value)=>identifier('im.'+kind,value),scope={account:{tenantId:id('tenant','tenant'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer','room')},person={scope,subject:id('user','alice')},signal=new AbortController().signal
const memory=await MemoryEngine.open(resolve(Config({enabled:true,directory,tenants:['tenant'],accounts:['bot'],groups:['room']}),directory),()=>1)
await memory.observe({scope,senderId:person.subject,messageId:id('message','crash-source'),parts:[{type:'text',text:'记住：提交后保留'}],sentAt:1,receivedAt:1,directedToBot:false},'live',signal)
await memory.put({person,actor:person.subject,mutationId:'crash-mutation',messageId:id('message','crash-source'),key:'retained',kind:'note',content:'提交后保留',quote:'提交后保留',expectedVersion:0,effectiveAt:1,category:'candidate',reopen:false},signal)
process.on('message',message=>{if(message==='exit-without-disposal')process.exit(23)})
process.send({ready:true})
