import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {verifyManifest,verifyFiles,verifyPair} from '../scripts/verify-package.mjs'
test('memory depends on published messaging libraries and ships no application binary',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
 verifyManifest(manifest)
 assert.equal(manifest.bin,undefined)
 assert.equal(manifest.dependencies['dsh-im-kit'],'https://github.com/Soldsix/dsh-im-kit/releases/download/v0.2.1/dsh-im-kit-0.2.1.tgz')
 for(const value of Object.values({...manifest.dependencies,...manifest.peerDependencies}))assert.equal(/^(file:|link:|workspace:)/.test(value),false)
})

test('public verification rejects undeclared files, local dependencies and unpaired docs',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
 for(const invalid of [{...manifest,bin:{run:'dist/index.js'}},{...manifest,dependencies:{...manifest.dependencies,'dsh-im-requests':'file:../private'}},{...manifest,dependencies:{...manifest.dependencies,'dsh-im-kit':'^0.2.1'}}])assert.throws(()=>verifyManifest(invalid))
 assert.throws(()=>verifyFiles(['package.json','data/chat.sqlite3']));assert.throws(()=>verifyFiles(['package.json']))
 const en=await readFile(new URL('../README.md',import.meta.url),'utf8'),zh=await readFile(new URL('../README.zh.md',import.meta.url),'utf8');verifyPair(en,zh);assert.throws(()=>verifyPair(en,zh+'extra\n'));assert.throws(()=>verifyPair(en,zh.replace('id="install"','id="wrong"')))
 const lf=text=>text.replaceAll('\r\n','\n'),crlf=text=>lf(text).replaceAll('\n','\r\n')
 verifyPair(lf(en),lf(zh));verifyPair(crlf(en),crlf(zh))
 assert.throws(()=>verifyPair(crlf(en)+'\r\n',crlf(zh)))
 assert.throws(()=>verifyPair(en.replace('## Summary','## Missing'),zh),/Missing summary heading/)
})
