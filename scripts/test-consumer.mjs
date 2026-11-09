/** Install the public archives into a fresh consumer and verify strict NodeNext declarations. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,basename,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv
assert.ok(process.env.npm_execpath,'Run through npm run test:consumer')
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','consumer');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),resumed=resume>=0
const area=resumed?await realpath(args[resume+1]):await mkdtemp(join(runs,'run-'))
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume target must stay in this repository consumer-test directory')
const attempt=await mkdtemp(join(area,'attempt-')),archives=[]
for(const path of[join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const target=join(attempt,basename(path));await copyFile(path,target);archives.push(target)}
if(!resumed)await writeFile(join(area,'package.json'),JSON.stringify({name:'isolated-person-memory-consumer',private:true,type:'module',overrides:manifest.overrides},null,2)+'\n')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)&&key.toUpperCase()!=='PATH'))
Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_PRIMARY_RUNTIME:''})
await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{TEMP:join(attempt,'temp'),TMP:join(attempt,'temp')})
const records=[]
async function run(argv){
 const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd:area,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']})
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n')
 let stdout='',stderr='',failure
 child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 records.push({argv,code,signal,timedOut:timeout.aborted,stdout,stderr});await writeFile(join(attempt,'commands.json'),JSON.stringify(records,null,2)+'\n')
 if(failure)throw failure;assert.equal(code,0,stderr.slice(-1800));return stdout
}
const peers=Object.entries(manifest.peerDependencies).filter(([name])=>name!=='dsh-im-kit').map(([name,version])=>name+'@'+version)
await run([process.env.npm_execpath,'install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',join(root,'.npm-cache'),archives[0],...peers,'@deepseek-ai/dsh@0.2.2-rc.1','@types/node@24.0.0','@types/react@18.3.28','@types/react-dom@18.3.7'])
const installed=await verifyInstalledArchive(archives[0],join(area,'node_modules','dsh-person-memory'),join(attempt,'installed-files.json'))
const consumer=join(attempt,'consumer.ts')
await copyFile(join(root,'scripts','consumer-types.ts'),consumer)
const compilerOptions={strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[join(area,'node_modules','@types')],lib:['lib.es2022.d.ts','lib.dom.d.ts'],skipLibCheck:false,allowImportingTsExtensions:true}
const host=ts.createCompilerHost(compilerOptions);host.getCurrentDirectory=()=>area
const program=ts.createProgram([consumer],compilerOptions,host)
const diagnostics=ts.getPreEmitDiagnostics(program)
await writeFile(join(attempt,'type-diagnostics.txt'),ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>area,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}))
assert.equal(diagnostics.length,0,'Strict consumer declaration check failed; see local type diagnostics')
const compilerLib=resolve(root,'node_modules','typescript','lib'),inputFiles=program.getSourceFiles().map(file=>resolve(file.fileName))
for(const path of inputFiles){
 const owned=relative(area,path),compiler=relative(compilerLib,path)
 assert.ok((!owned.startsWith('..')&&!isAbsolute(owned))||(!compiler.startsWith('..')&&!isAbsolute(compiler)),'Consumer borrowed an ancestor dependency')
}
const clientConsumer=join(attempt,'consumer-client.ts');await copyFile(join(root,'scripts','consumer-client-types.ts'),clientConsumer)
const clientProgram=ts.createProgram([clientConsumer],compilerOptions,host),clientDiagnostics=ts.getPreEmitDiagnostics(clientProgram),clientInputs=clientProgram.getSourceFiles().map(file=>resolve(file.fileName))
await writeFile(join(attempt,'client-type-diagnostics.txt'),ts.formatDiagnosticsWithColorAndContext(clientDiagnostics,{getCurrentDirectory:()=>area,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));assert.equal(clientDiagnostics.length,0,'Strict Client declaration check failed')
for(const path of clientInputs){const owned=relative(area,path),compiler=relative(compilerLib,path);assert.ok((!owned.startsWith('..')&&!isAbsolute(owned))||(!compiler.startsWith('..')&&!isAbsolute(compiler)),'Client consumer borrowed an ancestor dependency')}
await writeFile(join(attempt,'runtime.mjs'),`import assert from 'node:assert/strict'
import {Config,name,MemoryError} from 'dsh-person-memory'
import Control from 'dsh-person-memory/control'
assert.equal(name,'person-memory');assert.equal(typeof Control,'function');assert.equal(typeof MemoryError,'function')
assert.equal(Config({}).enabled,false);
console.log(JSON.stringify({passed:true,startedApplications:0,openedDatabases:0}))
`)
const runtime=JSON.parse((await run([join(attempt,'runtime.mjs')])).trim());assert.equal(runtime.passed,true)
await copyFile(join(root,'scripts','consumer-fixture.mjs'),join(attempt,'composition.mjs'));const composition=JSON.parse((await run([join(attempt,'composition.mjs')])).trim());assert.equal(composition.passed,true)
const result={passed:true,installedFilesVerified:installed,declarationFiles:inputFiles.length,clientDeclarationFiles:clientInputs.length,ancestorDependenciesBorrowed:false,strictDeclarationErrors:0,runtimeSmoke:runtime,composition,realModelApiRequests:0,realQqMessagesSent:0}
await writeFile(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({area,attempt,...result}))
