import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve as absolute} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {RequestAuthority} from 'dsh-im-requests'
import Control,{Config as ControlConfig} from '../dist/control.js'
import {Config} from '../dist/config.js'
import {snapshotSchema,saveSchema,inspectionResultSchema} from '../dist/control-codecs.js'
const selection={enabled:true,tenants:['tenant'],accounts:['bot'],groups:['room']}
const status=()=>({healthy:true,attached:false,pending:0,generation:0,storedSources:0,redactedSources:0,assertions:0,failures:0,lastError:null,maintenance:false})
async function mount(t,{service,enabled=false,requests,editFailure=false,tool}={}){
 const ctx=new Context(),writes=[],raw=enabled?selection:{enabled:false},entry={options:{id:'person-memory',name:'dsh-person-memory',config:raw},disabled:false,fiber:{effectiveConfig:Config(raw),state:2}}
 const editor={entries:()=>[entry],async edit(target,change){assert.equal(target,entry);const next=change(entry.options.config);if(editFailure)throw Error('SYNTHETIC_EDITOR_FAILURE');writes.push(next);entry.options.config=next;entry.fiber.effectiveConfig=Config(next)}}
 const fixture=ctx.plugin({name:'synthetic-memory-control',apply(child){child.effect(()=>child.provide('profileContext',{dir:absolute('.test-artifacts')}));child.effect(()=>child.provide('configEditor',editor));if(service)child.effect(()=>child.provide('personMemory',service));if(requests)child.effect(()=>child.provide('imRequests',requests));if(tool)child.effect(()=>child.provide('personMemoryModelTool',tool))}});await fixture.await()
 const control=ctx.plugin(Control,ControlConfig({}));await control.await();t.after(async()=>{await control.dispose();await fixture.dispose()});return{control:ctx.personMemoryControl,entry,writes}
}
test('native settings remain available while disabled and reject stale or unknown edits',async t=>{
 const f=await mount(t),initial=await f.control.describe();assert.equal(snapshotSchema.safeParse(initial).success,true);assert.equal(initial.active,false)
 const saved=await f.control.save({revision:initial.revision,patch:{tenants:['tenant'],accounts:['bot'],groups:['room']}});assert.deepEqual(saved.config.groups,['room'])
 await assert.rejects(f.control.save({revision:initial.revision,patch:{enabled:true}}),error=>error.details.reason==='conflict')
 await assert.rejects(async()=>f.control.save({revision:saved.revision,patch:{secret:'private'}}),error=>error.details.reason==='invalid');assert.equal(saveSchema.safeParse({revision:saved.revision,patch:{arbitrary:1}}).success,false)
 assert.equal((await f.control.save({revision:saved.revision,patch:{enabled:true}})).config.enabled,true)
})
test('memory or tool activity refuses a config update without interrupting work',async t=>{
 let released=0;const service={status,beginMaintenance:()=>false,endMaintenance(){released++}}
 const busy=await mount(t,{service,enabled:true}),before=await busy.control.describe();await assert.rejects(busy.control.save({revision:before.revision,patch:{maxResults:10}}),error=>error.details.reason==='busy');assert.equal(released,0);assert.equal(busy.writes.length,0)
 const idle={status,beginMaintenance:()=>true,endMaintenance(){}},tool=await mount(t,{service:idle,enabled:true,tool:{status:()=>({active:1,closed:false})}}),snapshot=await tool.control.describe();await assert.rejects(tool.control.save({revision:snapshot.revision,patch:{maxResults:10}}),error=>error.details.reason==='busy');assert.equal(tool.writes.length,0)
})
test('failed native config application releases its admission pause and does not publish success',async t=>{
 let held=false,release=0;const service={status,beginMaintenance(){held=true;return true},endMaintenance(){held=false;release++}}
 const f=await mount(t,{service,enabled:true,editFailure:true}),snapshot=await f.control.describe();await assert.rejects(f.control.save({revision:snapshot.revision,patch:{maxResults:10}}),error=>error.details.reason==='apply-failed');assert.equal(held,false);assert.equal(release,1);assert.equal(f.writes.length,0)
})
test('a failed enabled runtime can be disabled and its cross-field settings repaired through the owner page',async t=>{
 const f=await mount(t,{enabled:true});f.entry.fiber.effectiveConfig=Config({enabled:true});const current=await f.control.describe();assert.equal(current.active,false);assert.equal(current.config.enabled,true)
 const off=await f.control.save({revision:current.revision,patch:{enabled:false}});assert.equal(off.config.enabled,false)
 const configured=await f.control.save({revision:off.revision,patch:{tenants:['tenant'],accounts:['bot'],groups:['room']}});assert.deepEqual(configured.config.groups,['room'])
})
test('authenticated model tools require a live source provider and sender-isolated group histories',async t=>{
 const service={status,beginMaintenance:()=>true,endMaintenance(){}},missing=await mount(t,{service,enabled:true}),before=await missing.control.describe();await assert.rejects(missing.control.save({revision:before.revision,patch:{toolsEnabled:true}}),error=>error.details.reason==='request-provider-missing')
 const authority=new RequestAuthority('shared');t.after(()=>authority.close());const shared=await mount(t,{service,enabled:true,requests:authority.service}),s=await shared.control.describe();await assert.rejects(shared.control.save({revision:s.revision,patch:{toolsEnabled:true}}),error=>error.details.reason==='sender-isolation-required')
 const isolated=new RequestAuthority('sender');t.after(()=>isolated.close());const allowed=await mount(t,{service,enabled:true,requests:isolated.service}),a=await allowed.control.describe();assert.equal((await allowed.control.save({revision:a.revision,patch:{toolsEnabled:true}})).config.toolsEnabled,true)
})
test('owner inspection binds the selected subject and confirmation is separate from model actions',async t=>{
 const calls=[],service={status,async recall(request){calls.push(request);return{assertions:[],heads:[],revision:0,partial:false,next:null}},async confirm(request){calls.push(request);return{mutationId:request.mutationId,outcome:'applied',revision:1,currentRevision:1,affectedKeys:1,headsTruncated:false,heads:[]}},async forget(request){calls.push(request);return{mutationId:request.mutationId,outcome:'applied',revision:2,currentRevision:2,affectedKeys:1,headsTruncated:false,heads:[]}}},f=await mount(t,{service,enabled:true})
 const person={scope:{account:{tenantId:'tenant',networkId:'onebot11',accountId:'bot'},kind:'group',peerId:'room'},subject:'alice'}
 await f.control.inspect({person,query:'tea',limit:5,validAt:100,knownAt:200,candidates:false});assert.equal(calls[0].actor,'alice');assert.equal(calls[0].person.scope.peerId,'room')
 await f.control.confirm({person,key:'drink',expectedVersion:1,mutationId:'owner-accept'});assert.equal(calls[1].expectedVersion,1)
 await f.control.forget({person,key:'drink',expectedVersion:2,mutationId:'owner-forget'});assert.equal(calls[2].actor,'alice')
 await assert.rejects(async()=>f.control.confirm({person,key:'drink',expectedVersion:2,mutationId:'owner-accept',accepted:true}),error=>error.details.reason==='invalid')
})

test('owner query stamps distinguish fresh data from a delayed status poll without becoming memory fields',async t=>{
 let generation=0;const service={status:()=>({...status(),generation}),async recall(){generation++;return{assertions:[],heads:[],revision:generation,partial:false,next:null}}},f=await mount(t,{service,enabled:true}),old=await f.control.describe()
 const person={scope:{account:{tenantId:'tenant',networkId:'onebot11',accountId:'bot'},kind:'group',peerId:'room'},subject:'alice'},result=await f.control.inspect({person,query:'',limit:5,validAt:100,knownAt:200,candidates:false}),fresh=await f.control.describe()
 assert.equal(result.view.runtimeId,old.runtimeId);assert.equal(result.view.configRevision,old.revision);assert.ok(result.view.generation>old.generation)
 assert.equal(fresh.runtimeId,result.view.runtimeId);assert.equal(fresh.generation,result.view.generation);assert.equal(inspectionResultSchema.safeParse(result).success,true)
 assert.equal('runtimeId'in result.page,false);assert.equal(inspectionResultSchema.safeParse({...result,view:{...result.view,runtimeId:'untyped'}}).success,false)
})
