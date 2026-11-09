/** Installed DSH profile and native model executor against a controlled loopback HTTP backend. */
import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {mkdir,mkdtemp,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {join,relative,isAbsolute,basename,delimiter} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {pnpmScript} from './pnpm.mjs'
import {requiredProfilePeers} from './profile-peers.mjs'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv,option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]},manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','native');await mkdir(runs,{recursive:true});const resumed=option('--resume'),area=resumed?await realpath(resumed):await mkdtemp(join(runs,'run-')),owned=relative(runs,area)
assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume path must be an owned native fixture')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='person-memory-native',profileRoot=join(home,'profiles',profile),archives=[]
for(const [name,input]of [['dsh-qq-chat',option('--chat')??'https://github.com/Soldsix/dsh-qq-chat/releases/download/v0.3.0-development/dsh-qq-chat-0.3.0-development.tgz'],[manifest.name,option('--memory')??join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]]){
 const target=join(attempt,name+'.tgz');if(input.startsWith('https://')){const response=await fetch(input,{signal:AbortSignal.timeout(90000)});assert.ok(response.ok,'Public input unavailable: '+name);await writeFile(target,Buffer.from(await response.arrayBuffer()))}else await copyFile(await realpath(input),target)
 const {stdout}=await promisify(execFile)('tar',['-xOf',target,'package/package.json'],{windowsHide:true,maxBuffer:1024*1024});archives.push({name,path:target,manifest:JSON.parse(stdout),sha256:createHash('sha256').update(await readFile(target)).digest('hex')})
}
await writeFile(join(attempt,'inputs.json'),JSON.stringify(archives.map(({name,sha256})=>({name,sha256})),null,2)+'\n')
const captures=[],failures=[],parallelSeen=new Set();let active=0,peak=0,releaseParallel;const parallelReady=new Promise(done=>{releaseParallel=done})
const marker=data=>{const content=data.messages?.filter(item=>item.role==='user').at(-1)?.content;if(Array.isArray(content)&&content.some(item=>item.type==='tool_result'))return null;const text=typeof content==='string'?content:content?.filter(item=>item.type==='text').map(item=>item.text).join('\n');return text?.match(/MEMORY_NATIVE_[A-Z_]+/g)?.at(-1)}
const server=createServer(async(req,res)=>{
 if(req.url?.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[{id:'deepseek-flash',object:'model',owned_by:'fixture',input_modalities:['text'],output_modalities:['text'],api_capabilities:{anthropic_messages:{}}}]}));return}
 if(!req.url?.endsWith('/messages')){res.statusCode=404;res.end();return}
 let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw),command=marker(data);captures.push({data,marker:command});active++;peak=Math.max(peak,active)
 const stopped=new AbortController();res.once('close',()=>stopped.abort())
 try{
  if(command==='MEMORY_NATIVE_PARALLEL_A'||command==='MEMORY_NATIVE_PARALLEL_B'){parallelSeen.add(command);if(parallelSeen.size===2)releaseParallel();const timeout=new AbortController();try{await Promise.race([parallelReady,delay(15000,undefined,{signal:AbortSignal.any([stopped.signal,timeout.signal]),ref:false}).then(()=>{throw Error('Independent conversations did not overlap')})])}finally{timeout.abort()}}
  const plain=command==='MEMORY_NATIVE_DISABLED'||command==='MEMORY_NATIVE_PLAIN'
  if(command&&!plain)assert.ok(data.tools?.some(tool=>tool.name==='person_memory'),'Native memory tool is absent from '+command)
  if(command==='MEMORY_NATIVE_DISABLED')assert.ok(!data.tools?.some(tool=>tool.name==='person_memory'),'Disabled tool is still advertised')
  res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type,payload)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...payload})+'\n\n')
  send('message_start',{message:{id:'memory-'+captures.length,type:'message',role:'assistant',model:data.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})
  if(command&&!plain){
   let input={action:'recall'}
   if(command==='MEMORY_NATIVE_REMEMBER_A')input={action:'remember',key:'preference.drink',kind:'preference',content:'绿茶',quote:'我喜欢绿茶',expectedVersion:0}
   if(command==='MEMORY_NATIVE_CORRECT_A')input={action:'remember',key:'preference.drink',kind:'preference',content:'咖啡',quote:'现在改喝咖啡',expectedVersion:1}
   if(command==='MEMORY_NATIVE_ADMIN'||command==='MEMORY_NATIVE_ADMIN_OTHER')input={action:'recall',subject:'alice'}
   if(command==='MEMORY_NATIVE_FORGET_A')input={action:'forget',key:'preference.drink',expectedVersion:2}
   send('content_block_start',{index:0,content_block:{type:'tool_use',id:'memory-call-'+captures.length,name:'person_memory',input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:10}})
  }else{send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'MEMORY_REPLY_OK'}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}})}
  send('message_stop',{});res.end()
 }catch(error){if(!stopped.signal.aborted){failures.push(error.message);if(!res.headersSent){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Synthetic protocol assertion failed'}}))}else res.destroy(error)}}finally{active--}
})
server.listen(0,'127.0.0.1');await once(server,'listening');server.unref()
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|DEEPSEEK_BASE_URL/i.test(key)&&key.toUpperCase()!=='PATH'))
await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_HOME:home,TEMP:join(attempt,'temp'),TMP:join(attempt,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic personal-memory integration. No user persona or skills.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:'+server.address().port+'/anthropic'})
const setup=[]
async function run(argv,cwd){const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']});let output='',failure;child.stdout.on('data',value=>{output+=value});child.stderr.on('data',value=>{output+=value});child.once('error',error=>{failure=error});const [code,signal]=await new Promise(done=>child.once('close',(...values)=>done(values)));setup.push({argv,code,signal,timedOut:timeout.aborted,output});await writeFile(join(attempt,'setup.json'),JSON.stringify(setup,null,2)+'\n');if(failure)throw failure;assert.equal(timeout.aborted,false);assert.equal(signal,null);assert.equal(code,0,output.slice(-2200));return output}
let child,exit,exitCode,stdout='',stderr=''
try{
 const bootstrap=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js');if(!resumed)await run([bootstrap,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
 const pm=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));pm.pnpm={...pm.pnpm,overrides:manifest.overrides};await writeFile(join(profileRoot,'package.json'),JSON.stringify(pm,null,2)+'\n');await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(runs,'pnpm-store').replaceAll('\\','/')+'\n')
 const pnpm=await pnpmScript(root),boot=JSON.parse(await readFile(join(root,'node_modules','@deepseek-ai','dsh-app-boot','package.json'),'utf8')),peers=new Map(Object.entries(boot.peerDependencies));for(const item of archives)for(const pair of Object.entries(item.manifest.peerDependencies))peers.set(...pair)
 await run([pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1','@deepseek-ai/dsh-llm-deepseek-api-key@0.2.2-rc.1',...[...peers].map(([name,version])=>name+'@'+version),'--ignore-scripts'],profileRoot)
 for(const item of archives)await run([bootstrap,'plugin','--profile',profile,'add',item.path],area)
 for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}
 const installed={};for(const item of archives)installed[item.name]=await verifyInstalledArchive(item.path,join(profileRoot,'node_modules',item.name),join(attempt,item.name+'-installed.json'))
 const fixture=join(profileRoot,'native-fixture.mjs');await copyFile(join(root,'scripts','native-fixture.mjs'),fixture)
 const directory=join(attempt,'memory'),resultPath=join(attempt,'result.json')
 const overlay=[{id:'person-memory',config:{enabled:true,directory,namespace:'native-memory',tenants:['fixture'],accounts:['bot'],groups:['room','room-two'],operators:[{tenant:'fixture',network:'onebot11',account:'bot',user:'admin'}],busyMs:5000,requestTimeoutMs:10000,toolsEnabled:true}},{id:'qq-chat-runtime',config:{enabled:true,namespace:'memory-'+basename(attempt).toLowerCase(),databasePath:join(attempt,'chat.sqlite3'),workspacePath:join(attempt,'workspace'),presetId:'memory-test',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:256,isolateGroupSenders:true,allowedTools:['person_memory']}},{insert:[{id:'memory-test-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'memory-test'}},{id:'memory-test-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'memory-test',plugins:[]}},{id:'memory-test-fixture',name:pathToFileURL(fixture).href,config:{resultPath,memoryDirectory:directory}}]}]
 await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
 child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdout.on('data',value=>{stdout+=value});child.stderr.on('data',value=>{stderr+=value});exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
 let result;const deadline=Date.now()+90000;while(Date.now()<deadline){try{result=JSON.parse(await readFile(resultPath,'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}assert.equal(exitCode,undefined,'DSH exited before the native memory probe');await delay(30)}
 assert.ok(result,'Native memory probe timed out');assert.equal(result.passed,true,JSON.stringify(result));assert.deepEqual(failures,[]);assert.equal(captures.length,26);assert.ok(peak>=2)
 const prior=data=>{for(const value of [...data.messages??[]].reverse()){if(value.role!=='user')continue;const text=typeof value.content==='string'?value.content:value.content?.filter(block=>block.type==='text').map(block=>block.text).join('\n');const command=text?.match(/MEMORY_NATIVE_[A-Z_]+/g)?.at(-1);if(command)return command}}
 const continuation=command=>{const entry=captures.find(value=>value.marker===null&&prior(value.data)===command);assert.ok(entry,'Missing result for '+command);return entry.data}
 const value=command=>{const data=continuation(command),blocks=data.messages.filter(item=>item.role==='user').at(-1).content,block=blocks.find(item=>item.type==='tool_result');assert.ok(block);const text=typeof block.content==='string'?block.content:block.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');return JSON.parse(text.slice(text.indexOf('{')))}
 assert.equal(value('MEMORY_NATIVE_REMEMBER_A').receipt.heads[0].version,1);assert.equal(value('MEMORY_NATIVE_RECALL_A').page.assertions[0].content,'绿茶');assert.deepEqual(value('MEMORY_NATIVE_RECALL_B').page.assertions,[])
 assert.equal(JSON.stringify(continuation('MEMORY_NATIVE_RECALL_B').messages).includes('我喜欢绿茶'),false);assert.equal(value('MEMORY_NATIVE_ADMIN').page.assertions[0].content,'绿茶');assert.deepEqual(value('MEMORY_NATIVE_ADMIN_OTHER').page.assertions,[])
 assert.equal(value('MEMORY_NATIVE_RECALL_CORRECTED').page.assertions[0].content,'咖啡');assert.deepEqual(value('MEMORY_NATIVE_RECALL_FORGOTTEN').page.assertions,[]);assert.deepEqual(value('MEMORY_NATIVE_RECALL_AFTER_RELOAD').page.assertions,[])
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n');assert.deepEqual(await Promise.race([exit,delay(15000,undefined,{ref:false}).then(()=>{throw Error('Native shutdown timed out')})]),{code:0,signal:null})
 const path=join(directory,'memory.sqlite3'),before=createHash('sha256').update(await readFile(path)).digest('hex'),bin=join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js')
 await run([bin,'plugin','--profile',profile,'remove',manifest.name],area);assert.equal(JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8')).dependencies?.[manifest.name],undefined);assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),before)
 await run([bin,'plugin','--profile',profile,'add',archives[1].path],area);await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules',manifest.name),join(attempt,'reinstalled-files.json'));assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),before)
 result.checks.push('native-cli-removal-and-reinstallation-retain-memory-and-tombstones')
 const summary={...result,installed,normalShutdown:true,nativeAdapterRequests:captures.length,peakConcurrentRequests:peak,modelBackend:'controlled loopback Messages through the actual DSH native adapter',semanticQualityVerified:false,realModelApiRequests:0,realQqMessagesSent:0};await writeFile(join(attempt,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({area,attempt,...summary}))
}finally{
 if(child&&exitCode===undefined){child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(timer)}server.closeAllConnections();await new Promise(done=>server.close(done));await writeFile(join(attempt,'process.log'),stdout+'\n'+stderr);await writeFile(join(attempt,'model-requests.json'),JSON.stringify({captures,failures},null,2)+'\n')
}
