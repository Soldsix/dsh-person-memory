/** Authorized personal memory operations and encrypted person/revision-bound pagination. */
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto'
import {z} from 'zod'
import {brandString} from '@deepseek-ai/dsh-brand'
import {scopeKey,type InboundMessage,type UserId,type MessageId} from 'dsh-im-kit'
import {MemoryStore} from './store.ts'
import {selected,type Spec} from './config.ts'
import {MemoryError,personSchema,keySchema,putSchema,forgetSchema,confirmSchema,recallSchema,headSchema,receiptSchema,sourceInfoSchema} from './wire.ts'
import {recallPositionSchema,pageSchema,sourceSchema} from './commands.ts'
import type {PersonMemoryService,PersonRef,MemoryCursor,MemoryStatus,RecallRequest,PutRequest,ForgetRequest,ConfirmRequest,MutationReceipt} from './types.ts'
const statsSchema=z.strictObject({storedSources:z.number().int().nonnegative().safe(),redactedSources:z.number().int().nonnegative().safe(),assertions:z.number().int().nonnegative().safe()})
/** One namespace and store owner; the public service never accepts a model-selected identity. */
export class MemoryEngine implements PersonMemoryService{
 private readonly cursorKey=randomBytes(32)
 private readonly tasks=new Set<Promise<unknown>>()
 private readonly lifetime=new AbortController()
 private stopping:Promise<void>|undefined
 private maintenance=false
 private attached=false
 private stats={storedSources:0,redactedSources:0,assertions:0}
 private failures=0
 private lastError:import('./wire.ts').Failure|null=null
 private generation=0
 /** @param spec - resolved selections and limits. @param store - storage owner exclusively held by this engine. @param clock - trusted wall time used only for recording. @param changed - data-free post-commit notification. */
 private constructor(private readonly spec:Spec,private readonly store:MemoryStore,private readonly clock:()=>number,private readonly changed:(person:PersonRef,revision:number)=>void){}
 /** @param spec - resolved settings. @param clock - trusted Host clock. @param changed - post-commit notification. @returns ready engine with retained counters. */
 static async open(spec:Spec,clock:()=>number=Date.now,changed:(person:PersonRef,revision:number)=>void=()=>{}):Promise<MemoryEngine>{const store=await MemoryStore.open(spec),engine=new MemoryEngine(spec,store,clock,changed);try{await engine.refresh();return engine}catch(error){await store.close();throw error}}
 private async refresh():Promise<void>{this.stats=statsSchema.parse(await this.store.request('stats',null,this.clock()))}
 private authorize(person:PersonRef,actor:UserId,write=false):void{
  if(!selected(this.spec,person.scope))throw new MemoryError('forbidden')
  const {tenantId,networkId,accountId}=person.scope.account,operator=this.spec.operatorKeys.has(JSON.stringify([tenantId,networkId,accountId,actor]))
  if(person.scope.kind==='private'&&String(person.scope.peerId)!==String(person.subject))throw new MemoryError('forbidden')
  if(person.subject!==actor&&(!operator||write))throw new MemoryError('forbidden')
 }
 private run<T>(signal:AbortSignal,body:(signal:AbortSignal)=>Promise<T>,write=false):Promise<T>{
  if(this.stopping)return Promise.reject(new MemoryError('closed'))
  if(this.maintenance)return Promise.reject(new MemoryError('busy'))
  if(signal.aborted)return Promise.reject(new MemoryError('cancelled'))
  const combined=AbortSignal.any([signal,this.lifetime.signal])
  const task=Promise.resolve().then(async()=>{
   if(combined.aborted)throw new MemoryError('cancelled')
   try{const result=await body(combined);if(combined.aborted)throw new MemoryError(write?'write-uncertain':'cancelled');return result}catch(error){this.failures++;this.lastError=error instanceof MemoryError?error.code:'unavailable';throw error instanceof MemoryError?error:new MemoryError('unavailable')}
  })
  this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task
 }
 /** @param input - trusted source. @param origin - live event or archive backfill. @param signal - caller cancellation. @returns durable ingestion state; no reply is generated. */
 observe(input:InboundMessage,origin:'live'|'archive',signal:AbortSignal):ReturnType<PersonMemoryService['observe']>{
  let person:PersonRef
  try{person=personSchema.parse({scope:input.scope,subject:input.senderId});this.authorize(person,input.senderId,true)}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}
  const text=input.parts.filter(part=>part.type==='text').map(part=>part.text).join('\n');if(text.length>this.spec.maxSourceChars)return Promise.reject(new MemoryError('capacity'))
  const fingerprint=createHash('sha256').update(JSON.stringify([input.scope,input.messageId,input.senderId,input.sentAt,input.directedToBot,input.parts])).digest('hex')
  let source:z.infer<typeof sourceSchema>
  try{source=sourceSchema.parse({person,messageId:input.messageId,fingerprint,text,origin,sentAt:input.sentAt,receivedAt:input.receivedAt,hasNonText:input.parts.some(part=>part.type!=='text')})}catch(error){return Promise.reject(new MemoryError('invalid-data'))}
  return this.run(signal,async()=>{const result=z.enum(['stored','duplicate','redacted','conflict']).parse(await this.store.request('observe',source,this.clock()));if(result==='stored'||result==='redacted')await this.refresh();return result},true)
 }
 private aad(input:Pick<RecallRequest,'person'|'actor'|'query'|'validAt'|'knownAt'|'candidates'>):string{return JSON.stringify([this.spec.namespace,scopeKey(input.person.scope),input.person.subject,input.actor,input.query,input.validAt,input.knownAt,input.candidates])}
 private seal(position:z.infer<typeof recallPositionSchema>,aad:string):MemoryCursor{const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.cursorKey,nonce);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(JSON.stringify(position)),cipher.final()]);return brandString<MemoryCursor>(Buffer.concat([nonce,cipher.getAuthTag(),data]).toString('base64url'))}
 private position(token:MemoryCursor,aad:string):z.infer<typeof recallPositionSchema>{try{const bytes=Buffer.from(token,'base64url');if(bytes.length<29)throw new MemoryError('invalid-data');const cipher=createDecipheriv('aes-256-gcm',this.cursorKey,bytes.subarray(0,12));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(bytes.subarray(12,28));return recallPositionSchema.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')))}catch(error){throw new MemoryError('invalid-data')}}
 /** @param raw - authenticated requester and bounded filters. @param signal - caller cancellation. @returns sourced assertions; model candidates are opt-in. */
 recall(raw:RecallRequest,signal:AbortSignal):Promise<import('./types.ts').MemoryPage>{
  let input:z.infer<typeof recallSchema>;try{input=recallSchema.parse(raw);this.authorize(input.person,input.actor);if(input.limit>this.spec.maxResults)throw new MemoryError('invalid-data')}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}
  let position:z.infer<typeof recallPositionSchema>|null=null;const aad=this.aad(input);try{if(input.before)position=this.position(input.before,aad)}catch(error){return Promise.reject(error)}
  return this.run(signal,async()=>{const page=pageSchema.parse(await this.store.request('recall',{person:input.person,query:input.query,validAt:input.validAt,knownAt:input.knownAt,candidates:input.candidates,limit:input.limit,maxScanKeys:this.spec.maxScanKeys,maxResultChars:this.spec.maxResultChars,position},this.clock()));return{assertions:page.assertions,heads:page.heads,revision:page.revision,partial:page.partial,next:page.position?this.seal(page.position,aad):null}})
 }
 private mutate<T extends PutRequest|ForgetRequest|ConfirmRequest>(method:'put'|'forget'|'confirm',input:T,signal:AbortSignal):Promise<MutationReceipt>{
  return this.run(signal,async()=>{const receipt=receiptSchema.parse(await this.store.request(method,input,this.clock()));await this.refresh();if(receipt.outcome==='applied'){this.generation++;try{this.changed(input.person,receipt.currentRevision)}catch(error){/* Observers cannot invalidate an already committed mutation. */}}return receipt},true)
 }
 /** @param raw - source evidence and expected version. @param signal - caller cancellation. @returns mutation receipt, never an unmarked model belief. */
 put(raw:PutRequest,signal:AbortSignal):Promise<MutationReceipt>{let input:PutRequest;try{input=putSchema.parse(raw);this.authorize(input.person,input.actor,true);if(input.content.length>this.spec.maxContentChars||input.quote.length>this.spec.maxQuoteChars)throw new MemoryError('capacity')}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}return this.mutate('put',input,signal)}
 /** @param raw - logical key and expected revision. @param signal - caller cancellation. @returns tombstones; source-linked assertions are redacted atomically. */
 forget(raw:ForgetRequest,signal:AbortSignal):Promise<MutationReceipt>{let input:ForgetRequest;try{input=forgetSchema.parse(raw);this.authorize(input.person,input.actor,true)}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}return this.mutate('forget',input,signal)}
 /** @param person - exact subject. @param actor - authenticated requester. @param key - logical key. @param signal - cancellation. @returns head or null. */
 head(person:PersonRef,actor:UserId,key:string,signal:AbortSignal):ReturnType<PersonMemoryService['head']>{try{personSchema.parse(person);keySchema.parse(key);this.authorize(person,actor)}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}return this.run(signal,async()=>z.nullable(headSchema).parse(await this.store.request('head',{person,key},this.clock())))}
 /** @param person - exact source subject. @param actor - authenticated requester. @param messageId - selected source. @param signal - caller cancellation. @returns no original message body. */
 source(person:PersonRef,actor:UserId,messageId:MessageId,signal:AbortSignal):ReturnType<PersonMemoryService['source']>{try{personSchema.parse(person);this.authorize(person,actor)}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}return this.run(signal,async()=>sourceInfoSchema.parse(await this.store.request('source',{person,messageId},this.clock())))}
 /** @param raw - profile-owner selection, never model arguments. @param signal - cancellation. @returns new accepted version with unchanged evidence. */
 confirm(raw:ConfirmRequest,signal:AbortSignal):Promise<MutationReceipt>{let input:ConfirmRequest;try{input=confirmSchema.parse(raw);if(!selected(this.spec,input.person.scope))throw new MemoryError('forbidden')}catch(error){return Promise.reject(error instanceof MemoryError?error:new MemoryError('invalid-data'))}return this.mutate('confirm',input,signal)}
 /** @param attached - whether an optional ingestion provider is mounted. */
 setAttached(attached:boolean):void{this.attached=attached}
 /** @returns source, assertion and queue counts without body data. */
 status():MemoryStatus{const fault=this.store.health();return{...this.stats,pending:this.store.pendingCount(),attached:this.attached,healthy:fault===null,generation:this.generation,failures:this.failures,lastError:fault??this.lastError,maintenance:this.maintenance}}
 /** @returns whether an idle runtime is exclusively paused. */
 beginMaintenance():boolean{if(this.maintenance||this.stopping||this.tasks.size||this.store.pendingCount())return false;this.maintenance=true;return true}
 /** Resume admission after the owner update. */
 endMaintenance():void{this.maintenance=false}
 /** @returns completion after caller bodies, outstanding worker operations and worker exit. */
 close():Promise<void>{if(this.stopping)return this.stopping;this.lifetime.abort();return this.stopping=(async()=>{await Promise.allSettled([...this.tasks]);await this.store.close()})()}
}
