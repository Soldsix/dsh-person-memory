/** Headless isolated DSH Web profile; no desktop or real QQ interaction. */
import assert from 'node:assert/strict'
import {pnpmScript} from './pnpm.mjs'
import {requiredProfilePeers} from './profile-peers.mjs'
import {verifyInstalledArchive} from './verify-installed.mjs'
import {setTimeout as delay} from 'node:timers/promises'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile,writeFile,realpath,copyFile} from 'node:fs/promises'
import {join,delimiter,relative,isAbsolute} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),runs=join(root,'.test-artifacts','web');await mkdir(runs,{recursive:true})
const resume=process.argv.indexOf('--resume'),area=resume<0?await mkdtemp(join(runs,'web-')):await realpath(process.argv[resume+1])
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned)&&owned.startsWith('web-'),'Resume area must be an isolated Web test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='memory-web',profileRoot=join(home,'profiles',profile)
const argument=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0&&process.argv[index+1],'Required '+name);return process.argv[index+1]}
const dsh=await realpath(join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'))
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),memoryInput=process.argv.includes('--memory')?await realpath(argument('--memory')):join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz'),memory=join(attempt,'memory.tgz')
await copyFile(memoryInput,memory)
const browserCache=await realpath(process.argv.includes('--browser-cache')?argument('--browser-cache'):join(root,'.test-artifacts','browsers'))
process.env.PLAYWRIGHT_BROWSERS_PATH=browserCache
const {chromium}=await import(pathToFileURL(await realpath(join(root,'node_modules','playwright','index.mjs'))).href)
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|DEEPSEEK_BASE_URL/i.test(key)&&key.toUpperCase()!=='PATH'))
await mkdir(join(area,'temp'),{recursive:true});Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_HOME:home,TEMP:join(area,'temp'),TMP:join(area,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic isolated Web profile.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:9/anthropic',PLAYWRIGHT_BROWSERS_PATH:browserCache})
const setup=[]
async function run(argv,cwd){
 const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']});let output='',failure
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({argv,pid:child.pid,startedAt:new Date().toISOString()})+'\n')
 child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(done=>child.once('close',(...values)=>done(values)))
 setup.push({argv,code,signal,output});await writeFile(join(attempt,'setup-last.json'),JSON.stringify(setup.at(-1),null,2)+'\n');await writeFile(join(attempt,'setup.json'),JSON.stringify(setup,null,2)+'\n')
 if(failure)throw failure;assert.equal(signal,null);assert.equal(code,0,output.slice(-1800));return output
}
const pnpm=await pnpmScript(root)
if(resume<0)await run([dsh,'--profile',profile,'--from-default-profile','web','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8')),own=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
profileManifest.pnpm={...profileManifest.pnpm,overrides:own.overrides};await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','native','pnpm-store').replaceAll('\\','/')+'\n')
const boot=JSON.parse(await readFile(join(root,'node_modules','@deepseek-ai','dsh-app-boot','package.json'),'utf8')),peers=new Map([...Object.entries(boot.peerDependencies),...Object.entries(manifest.peerDependencies),['@deepseek-ai/cordis-plugin-timer','~1.2.0'],...['client-connection','sandbox','llm-deepseek','llm-deepseek-api-key'].map(name=>['@deepseek-ai/dsh-'+name,'0.2.2-rc.1'])])
await run([pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1',...[...peers].map(([name,version])=>name+'@'+version),'--ignore-scripts'],profileRoot)
const installedManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));for(const [name,version]of peers)assert.equal(installedManifest.dependencies[name],version,'Profile peer version changed during install: '+name)
await run([dsh,'plugin','--profile',profile,'add',memory],area)
for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}
const installed=await verifyInstalledArchive(memory,join(profileRoot,'node_modules',manifest.name),join(attempt,'installed-files.json'))
const fixture=join(profileRoot,'memory-web-fixture.mjs'),seedReady=join(attempt,'seed.json');await copyFile(join(root,'scripts','web-fixture.mjs'),fixture)
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify([{id:'person-memory-settings',config:{statusRefreshMs:250}},{id:'person-memory',config:{directory:join(attempt,'memory')}},{id:'session-title-llm',disabled:true},{id:'session-telemetry-otel',disabled:true},{insert:[{id:'memory-web-fixture',name:pathToFileURL(fixture).href,config:{ready:seedReady}}]}],null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile,'--host','127.0.0.1','--port','0','--no-open'],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode,context,page;const errors=[],checks=[],exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Web profile did not report ready')),60000),inspect=()=>{const match=(stdout+'\n'+stderr).match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);if(match){clearTimeout(timer);resolve(match[0])}};child.stdout.on('data',data=>{stdout+=data;inspect()});child.stderr.on('data',data=>{stderr+=data;inspect()});void exit.then(()=>{clearTimeout(timer);reject(Error('Web profile exited before ready'))})})
try{
 const login=await ready,origin=new URL(login).origin
 await mkdir(join(attempt,'downloads'),{recursive:true})
 context=await chromium.launchPersistentContext(join(attempt,'browser-profile'),{headless:true,acceptDownloads:true,downloadsPath:join(attempt,'downloads'),viewport:{width:1280,height:1000},locale:'zh-CN',colorScheme:'light',env})
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort()})
 page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 await page.goto(login,{waitUntil:'domcontentloaded'});const proceed=page.getByRole('button',{name:/^继续$|^Continue$/});await proceed.waitFor({state:'visible',timeout:5000}).catch(()=>{});if(await proceed.isVisible())await proceed.click()
 const dismiss=page.getByRole('dialog').getByRole('button',{name:/^关闭$|^Close$/});if(await dismiss.isVisible())await dismiss.click()
 await page.getByRole('button',{name:/^插件$|^Plugins$/}).first().click();if(await proceed.isVisible())await proceed.click();await page.getByText('dsh-person-memory',{exact:true}).first().click()
 const form=page.locator('.personmemory-page'),inspector=form.locator('.personmemory-inspector'),record=inspector.locator('.personmemory-record'),save=form.getByRole('button',{name:/^保存$|^Save$/})
 const settled=()=>form.getByText(/^(有未保存的修改|Unsaved changes|设置已在别处更改.*|Settings changed elsewhere.*)$/u).waitFor({state:'hidden'})
 const saved=async()=>{await save.click();await page.getByText(/^人物记忆设置已保存$|^Memory settings saved$/).waitFor();await settled()}
 const query=async()=>{await inspector.getByRole('button',{name:/^查询记忆$|^Query memory$/}).click();await inspector.getByRole('button',{name:/^导出当前页$|^Export this page$/}).waitFor()}
 await form.getByText(/人物记忆未运行|Personal memory inactive/).waitFor();checks.push('owner-page-is-visible-with-disabled-runtime')
 await form.getByLabel(/租户 ID|Tenant IDs/).fill('fixture');await form.getByLabel(/机器人账号 ID|Bot account IDs/).fill('bot');await form.getByLabel(/群 ID|Group IDs/).fill('room')
 const operators=form.getByLabel(/跨人物读取者|Cross-person readers/);await operators.fill('{broken');await save.click();await page.getByText(/^请检查配置、身份与日期$|^Check settings, identity and dates$/).waitFor();assert.equal(await operators.inputValue(),'{broken');checks.push('invalid-settings-retain-the-owner-draft')
 await operators.fill('[]');await saved();await form.getByRole('switch',{name:/^启用人物记忆$|^Enable personal memory$/}).click();await saved();await form.getByText(/人物记忆运行中|Personal memory active/).waitFor()
 const deadline=Date.now()+15000;for(;;){try{assert.equal(JSON.parse(await readFile(seedReady,'utf8')).seeded,3);break}catch(error){if(error.code!=='ENOENT')throw error;assert.ok(Date.now()<deadline,'Synthetic source seed was not ready');await delay(30)}}checks.push('service-enabled-and-real-store-seeded')
 const modelTool=form.getByRole('switch',{name:/^启用可信记忆工具$|^Enable authenticated memory tool$/});await modelTool.click();await save.click();await page.getByText(/^请先启用可信消息请求提供方$|^Enable a trusted messaging request provider first$/).waitFor();assert.equal(await modelTool.getAttribute('aria-checked'),'true');await modelTool.click();checks.push('missing-request-provider-refuses-model-tool-save')
 for(const [name,value]of [[/^租户$|^Tenant$/,'fixture'],[/^机器人账号$|^Bot account$/,'bot'],[/^会话 ID$|^Conversation ID$/,'room'],[/^人物 ID$|^Person ID$/,'alice']])await inspector.getByLabel(name).fill(value)
 await query();assert.equal(await record.count(),2);assert.ok(!(await inspector.innerText()).includes('摇滚'));checks.push('default-inspection-excludes-model-candidates')
 await inspector.getByRole('switch',{name:/包含候选|Include candidates/}).click();await query();assert.equal(await record.count(),3);await inspector.getByText('摇滚 <img src=x onerror=alert(1)>',{exact:true}).first().waitFor();assert.equal(await inspector.locator('img').count(),0);checks.push('candidate-evidence-is-displayed-as-escaped-data')
 const music=record.filter({has:page.getByText('music',{exact:true})});await music.getByRole('button',{name:/接纳这条|Accept this sourced/}).click();await page.getByText(/^已保存新的接纳版本$|^A new accepted revision was stored$/).waitFor();await query();const accepted=record.filter({has:page.getByText('music',{exact:true})});assert.match(await accepted.innerText(),/所有者已接纳|Owner accepted/)
 const downloaded=page.waitForEvent('download');await inspector.getByRole('button',{name:/导出当前页|Export this page/}).click();const download=await downloaded,target=join(attempt,'memory-page.json');await download.saveAs(target);const exported=JSON.parse(await readFile(target,'utf8'));assert.equal(exported.format,'dsh-person-memory-page');assert.equal(exported.completeBackup,false);assert.equal(exported.page.assertions.length,3);checks.push('owner-acceptance-and-revalidated-page-download')
 const drink=record.filter({has:page.getByText('drink',{exact:true})});await drink.getByRole('button',{name:/^遗忘此键$|^Forget this key$/}).click();await page.getByText(/^已遗忘记忆与关联来源$|^Memory and linked sources were forgotten$/).waitFor();assert.equal(await record.count(),0);await query();assert.equal(await record.count(),2);assert.ok(!(await inspector.innerText()).includes('绿茶'));checks.push('forget-clears-visible-data-and-removes-source-linked-values')
 const maxResults=form.getByLabel(/每页结果上限|Maximum results per page/);await maxResults.fill('1');await saved();await query();assert.equal(await record.count(),1);await inspector.getByRole('button',{name:/^下一页$|^Next page$/}).click();await record.getByText('music',{exact:true}).waitFor();checks.push('config-reload-retains-data-and-revision-bound-pagination')
 await page.screenshot({path:join(attempt,'light.png'),fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(attempt,'dark.png'),fullPage:true})
 await page.getByRole('button',{name:/^收起侧边栏$|^Collapse sidebar$/}).click();await page.setViewportSize({width:520,height:1000});await form.evaluate(element=>element.scrollIntoView({block:'start'}));assert.ok(await form.evaluate(element=>element.scrollWidth<=element.clientWidth+2));await page.screenshot({path:join(attempt,'narrow.png'),fullPage:true});checks.push('light-dark-and-narrow-owner-layout')
 await page.setViewportSize({width:1280,height:1000});await form.getByRole('switch',{name:/^启用人物记忆$|^Enable personal memory$/}).click();await saved();await form.getByText(/人物记忆未运行|Personal memory inactive/).waitFor();assert.equal(await record.count(),0);checks.push('disabling-memory-clears-the-inspector-and-retains-owner-entry')
 assert.deepEqual(errors,[]);await writeFile(join(attempt,'summary.json'),JSON.stringify({passed:true,checks,installed,clientErrors:errors,realQqMessagesSent:0,realModelApiRequests:0},null,2)+'\n');console.log(JSON.stringify({area,attempt,passed:true,checks,installed,realQqMessagesSent:0,realModelApiRequests:0}))
}catch(error){await writeFile(join(attempt,'failure.json'),JSON.stringify({message:String(error),checks},null,2)+'\n');if(page){await page.screenshot({path:join(attempt,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(attempt,'body.txt'),await page.locator('body').innerText()).catch(()=>{})}throw error
}finally{
 await context?.close();if(exitCode===undefined){child.kill('SIGINT');const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}await writeFile(join(attempt,'process.log'),stdout+'\n'+stderr)
}
