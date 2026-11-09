/** Verify public package entries, paired documentation and a deliberate artifact allowlist. */
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
/** @param manifest - parsed package metadata. Reject private dependencies and application launchers. */
export function verifyManifest(manifest){
 assert.equal(manifest.name,'dsh-person-memory');assert.equal(manifest.bin,undefined);assert.equal(manifest.type,'module');assert.equal(manifest.license,'MIT')
 for(const [name,version]of [['dsh-im-kit','0.2.1'],['dsh-im-requests','0.1.0']])assert.equal(manifest.dependencies[name],'https://github.com/Soldsix/'+name+'/releases/download/v'+version+'/'+name+'-'+version+'.tgz')
 assert.equal(manifest.dsh.bundle.patch,'./cordis.patch.yml');assert.equal(manifest.dsh.client.platform,'web');assert.equal(manifest.engines.dsh,'0.2.2-rc.1')
 for(const section of ['dependencies','peerDependencies','devDependencies'])for(const value of Object.values(manifest[section]??{}))assert.ok(!/^(?:file:|link:|workspace:|[a-z]:[\\/]|[\\/])/i.test(value))
 for(const [entry,path]of [['.','index'],['./control','control']]){assert.equal(manifest.exports[entry].import,'./dist/'+path+'.js');assert.equal(manifest.exports[entry].types,'./dist/'+path+'.d.ts')}
}
/** @param paths - packed regular-file names. Reject local data, undeclared docs and test fixtures. */
export function verifyFiles(paths){
 const exact=['LICENSE','README.md','README.zh.md','README.i18n.yaml','package.json','cordis.patch.yml']
 for(const path of paths)assert.ok(exact.includes(path)||/^dist\/(?:client\/)?[a-z][a-z-]*\.(?:js|d\.ts)$/.test(path),'Unexpected public file '+path)
 for(const path of [...exact,'dist/index.js','dist/index.d.ts','dist/model-tool.js','dist/model-tool.d.ts','dist/control.js','dist/client.js','dist/worker.js','dist/database.js'])assert.ok(paths.includes(path),'Missing public file '+path)
}
/** @param english - English page. @param chinese - paired Chinese page. Check structure and summaries. */
export function verifyPair(english,chinese){
 for(const text of [english,chinese]){assert.match(text,/^kind: "package-bundle"$/m);assert.match(text,/^description: ".+"$/m);assert.ok(/\r?\n$/.test(text)&&!/\r?\n\r?\n$/.test(text))}
 assert.equal(english.split('\n').length,chinese.split('\n').length)
 assert.deepEqual([...english.matchAll(/<a id="([^"]+)">/g)].map(x=>x[1]),[...chinese.matchAll(/<a id="([^"]+)">/g)].map(x=>x[1]))
 const lines=english.split(/\r?\n/u),start=lines.indexOf('## Summary');assert.ok(start>=0,'Missing summary heading')
 const next=lines.findIndex((line,index)=>index>start&&line.startsWith('## '))
 assert.ok(lines.slice(start+1,next<0?undefined:next).join(' ').trim().split(/\s+/u).length<=100)
}
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(/\.tsx?$/.test(entry.name))result.push(path)}return result}
async function main(){
 verifyManifest(JSON.parse(await readFile(resolve(root,'package.json'),'utf8')))
 verifyPair(await readFile(resolve(root,'README.md'),'utf8'),await readFile(resolve(root,'README.zh.md'),'utf8'))
 assert.ok(process.env.npm_execpath,'Run through npm run check')
 const child=spawn(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--ignore-scripts','--json'],{cwd:root,windowsHide:true,signal:AbortSignal.timeout(60000),stdio:['ignore','pipe','pipe']});let output='',stderr='',failure
 child.stdout.on('data',value=>{output+=value});child.stderr.on('data',value=>{stderr+=value});child.once('error',error=>{failure=error});const code=await new Promise(done=>child.once('close',done));if(failure)throw failure;assert.equal(code,0,stderr)
 const paths=JSON.parse(output)[0].files.map(item=>item.path);verifyFiles(paths)
 for(const path of [...await files(resolve(root,'src')),...paths.map(path=>resolve(root,path))]){
  const text=await readFile(path,'utf8');assert.ok(!/[c-f]:[\\/](?:users|个人|项目工作区)[\\/]/i.test(text),'Private path in public source');assert.ok(!/\bsk-[a-z0-9]{20,}\b/i.test(text),'Credential-like literal in public source');assert.ok(!/\bas unknown\b/.test(text));assert.ok(/\r?\n$/.test(text)&&!/\r?\n\r?\n$/.test(text),'Trailing newline')
 }
 console.log(JSON.stringify({passed:true,packedFiles:paths.length,checks:['public-entries','paired-docs','public-dependencies','artifact-allowlist','source-hygiene']}))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
