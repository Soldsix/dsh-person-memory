import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {identifier} from 'dsh-im-kit'
import {Config,resolve} from '../dist/config.js'
import {MemoryEngine} from '../dist/engine.js'
const root=new URL('../.test-artifacts/process/',import.meta.url);await mkdir(root,{recursive:true})
test('a live process lease refuses another owner; committed data survives a crash and exact lease recovery',async t=>{
 const directory=await mkdtemp(new URL('run-',root)),spec=resolve(Config({enabled:true,directory,tenants:['tenant'],accounts:['bot'],groups:['room']}),directory),child=spawn(process.execPath,[fileURLToPath(new URL('./crash-child.mjs',import.meta.url)),directory],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,signal:AbortSignal.timeout(15000)})
 let stderr='',failed,closed=false;child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failed=error})
 const exit=new Promise(done=>child.once('close',(code,signal)=>{closed=true;done({code,signal})}));t.after(async()=>{if(!closed)child.kill();await exit})
 const ready=await Promise.race([new Promise(done=>child.once('message',done)),exit.then(()=>{throw failed??Error('Fixture exited before readiness: '+stderr)})]);assert.equal(ready.ready,true)
 await assert.rejects(MemoryEngine.open(spec),error=>error.code==='owned')
 const before=JSON.parse(await readFile(join(directory,'owner.lock'),'utf8'));assert.equal(before.pid,child.pid)
 child.send('exit-without-disposal');assert.deepEqual(await exit,{code:23,signal:null})
 const memory=await MemoryEngine.open(spec);t.after(()=>memory.close())
 const id=(kind,value)=>identifier('im.'+kind,value),person={scope:{account:{tenantId:id('tenant','tenant'),networkId:id('network','onebot11'),accountId:id('account','bot')},kind:'group',peerId:id('peer','room')},subject:id('user','alice')},page=await memory.recall({person,actor:person.subject,query:'',limit:20,validAt:Date.now(),knownAt:Date.now(),candidates:false},new AbortController().signal)
 assert.equal(page.assertions[0].content,'提交后保留');assert.equal(page.assertions[0].evidence.messageId,'crash-source')
})
