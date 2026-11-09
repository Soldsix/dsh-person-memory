/** Owner-only configuration, inspection, acceptance and source-linked forgetting. */
import {createHash,randomUUID} from 'node:crypto'
import type {Context} from '@deepseek-ai/cordis'
import type {Entry} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import {Remote,RemoteError,TypertRemoteService,principalOf} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from 'dsh-im-requests/cordis'
import type {} from './index.ts'
import {Config as RuntimeConfig,resolve} from './config.ts'
import {FIELDS,type Settings} from './fields.ts'
import {saveSchema,inspectSchema,manageSchema} from './control-codecs.ts'
import {MemoryError} from './wire.ts'
import type {PersonMemoryService,MutationReceipt,MemoryCursor} from './types.ts'
import type {ControlFailure,Snapshot,MemoryInspection,MemoryRuntimeId} from './control-types.ts'
import {brandString} from '@deepseek-ai/dsh-brand'
export type {Snapshot,SaveRequest,InspectRequest,ManageRequest,ControlFailure,MemoryInspection,MemoryRuntimeId} from './control-types.ts'
/** Native component ID and status polling cadence. */
export interface ControlConfig{targetEntryId:string;statusRefreshMs:number}
/** The controller is independent of enabled storage. */
export const Config:z<ControlConfig>=z.object({targetEntryId:z.string().default('person-memory'),statusRefreshMs:z.number().min(250).max(60000).step(1).default(3000)})
declare module '@deepseek-ai/cordis'{interface Context{readonly personMemoryControl:MemoryControl}}
const fail=(reason:ControlFailure)=>new RemoteError('person-memory/control','Personal memory operation could not complete',{reason})
function parse(raw:unknown,_profile:string):Settings{try{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!Object.hasOwn(FIELDS,key)))throw fail('invalid');return z.resolve(raw,RuntimeConfig,{})[0]}catch(error){throw fail('invalid')}}
function revision(config:Settings):string{return createHash('sha256').update(JSON.stringify(Object.keys(FIELDS).map(key=>[key,config[key as keyof Settings]]))).digest('hex')}
/** Only the profile owner can inspect bodies or change their stored classifications. */
export class MemoryControl extends TypertRemoteService{
 static inject=['configEditor','profileContext']
 static Config=Config
 private readonly lifetime=new AbortController()
 private tail:Promise<void>=Promise.resolve()
 private readonly runtimes=new WeakMap<PersonMemoryService,MemoryRuntimeId>()
 private runtimeId(service:PersonMemoryService):MemoryRuntimeId{let id=this.runtimes.get(service);if(!id){id=brandString<MemoryRuntimeId>(randomUUID());this.runtimes.set(service,id)}return id}
 /** @param ctx - native config editor and owner invocation context. @param config - exact runtime row and polling cadence. */
 constructor(ctx:Context,private readonly config:ControlConfig){super(ctx,'personMemoryControl');if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(config.targetEntryId))throw new Error('Invalid memory target entry');ctx.effect(()=>async()=>{this.lifetime.abort();await this.tail})}
 private owner():void{if(principalOf(this.ctx.invocation))throw fail('forbidden');if(this.lifetime.signal.aborted||this.ctx.invocation?.signal.aborted)throw fail('cancelled')}
 private target():Entry{const entries=this.ctx.configEditor.entries(),entry=entries.find(value=>value.options.id===this.config.targetEntryId);if(!entry?.fiber||entry.options.name!=='dsh-person-memory'||entries.some(value=>value!==entry&&value.options.name==='dsh-person-memory'))throw fail('unavailable');return entry}
 private snapshot():Snapshot{
  const entry=this.target(),config=parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir),service=this.ctx.get('personMemory'),status=service?.status(),requests=this.ctx.get('imRequests')?.status(),tool=this.ctx.get('personMemoryModelTool')?.status()
  const toolState=!config.toolsEnabled?'disabled':!service?'inactive':!requests||requests.closed?'waiting-provider':config.groups.length&&requests.groupSessionMode!=='sender'?'sender-isolation-required':tool&&!tool.closed?'registered':'waiting-provider'
  return{config:structuredClone(config),revision:revision(config),runtimeId:service?this.runtimeId(service):null,active:Boolean(service),healthy:status?.healthy??false,attached:status?.attached??false,pending:status?.pending??0,generation:status?.generation??0,storedSources:status?.storedSources??0,redactedSources:status?.redactedSources??0,assertions:status?.assertions??0,maintenance:status?.maintenance??false,lastError:status?.lastError??null,entryDisabled:entry.disabled,refreshMs:this.config.statusRefreshMs,toolState,toolActive:tool?.active??0}
 }
 private serial<T>(body:()=>Promise<T>):Promise<T>{this.owner();const task=this.tail.then(async()=>{this.owner();try{return await body()}catch(error){if(error instanceof MemoryError)throw fail(error.code);throw error instanceof RemoteError?error:fail('unavailable')}});this.tail=task.then(()=>{},()=>{});return task}
 private signal():AbortSignal{return this.ctx.invocation?AbortSignal.any([this.lifetime.signal,this.ctx.invocation.signal]):this.lifetime.signal}
 /** @returns saved settings and data-free operational metadata. */
 @Remote
 describe():Promise<Snapshot>{return this.serial(async()=>this.snapshot())}
 /** @param request - current revision and changed deployment fields. @returns saved settings after an idle-only update. */
 @Remote
 save(request:unknown):Promise<Snapshot>{
  this.owner();const parsed=saveSchema.safeParse(request);if(!parsed.success)throw fail('invalid');const edit=parsed.data
  return this.serial(async()=>{
   const entry=this.target(),current=parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir);if(revision(current)!==edit.revision)throw fail('conflict')
   const patch=Object.fromEntries(Object.entries(edit.patch).filter(([,value])=>value!==undefined)),next=parse({...current,...patch},this.ctx.profileContext.dir)
   try{resolve(next,this.ctx.profileContext.dir)}catch(error){throw fail('invalid')}
   if(next.enabled&&next.toolsEnabled){const provider=this.ctx.get('imRequests')?.status();if(!provider||provider.closed)throw fail('request-provider-missing');if(next.groups.length&&provider.groupSessionMode!=='sender')throw fail('sender-isolation-required')}
   const service=this.ctx.get('personMemory');if(current.enabled&&!service&&next.enabled||this.ctx.get('personMemoryModelTool')?.status().active)throw fail('busy');if(service&&!service.beginMaintenance())throw fail('busy')
   try{if(entry.disabled)throw fail('unavailable');await this.ctx.configEditor.edit(entry,raw=>{if(revision(parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir))!==edit.revision)throw fail('conflict');return{...raw,...patch}})}catch(error){throw error instanceof RemoteError?error:fail('apply-failed')}finally{service?.endMaintenance()}
   return this.snapshot()
  })
 }
 /** @param request - selected person and time window. @returns sourced memory only after owner authorization. */
 @Remote
 inspect(request:unknown):Promise<MemoryInspection>{
  this.owner();const parsed=inspectSchema.safeParse(request);if(!parsed.success)throw fail('invalid');const input=parsed.data
  return this.serial(async()=>{const service=this.ctx.get('personMemory');if(!service)throw fail('unavailable');const configRevision=revision(parse(this.target().fiber?.effectiveConfig,this.ctx.profileContext.dir)),page=await service.recall({person:input.person,actor:input.person.subject,query:input.query,limit:input.limit,validAt:input.validAt,knownAt:input.knownAt,candidates:input.candidates,...input.before?{before:brandString<MemoryCursor>(input.before)}:{}},this.signal());return{page,view:{runtimeId:this.runtimeId(service),configRevision,generation:service.status().generation}}})
 }
 /** @param request - existing key and version. @returns a new owner-confirmed version without editing original evidence. */
 @Remote
 confirm(request:unknown):Promise<MutationReceipt>{this.owner();const parsed=manageSchema.safeParse(request);if(!parsed.success)throw fail('invalid');return this.serial(async()=>{const service=this.ctx.get('personMemory');if(!service)throw fail('unavailable');return service.confirm(parsed.data,this.signal())})}
 /** @param request - existing key and version. @returns tombstones after source-linked deletion. Retained QQ/DSH logs are outside this operation. */
 @Remote
 forget(request:unknown):Promise<MutationReceipt>{this.owner();const parsed=manageSchema.safeParse(request);if(!parsed.success)throw fail('invalid');return this.serial(async()=>{const service=this.ctx.get('personMemory');if(!service)throw fail('unavailable');return service.forget({...parsed.data,actor:parsed.data.person.subject},this.signal())})}
}
export default MemoryControl
