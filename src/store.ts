/** Bounded worker RPC; a lost write reply remains uncertain and is never silently retried. */
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {readFile,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {MemoryError,replySchema} from './wire.ts'
import type {Spec} from './config.ts'
type Method='observe'|'put'|'forget'|'confirm'|'recall'|'head'|'source'|'stats'|'close'
interface Pending{readonly method:Method;readonly bytes:number;readonly resolve:(value:unknown)=>void;readonly reject:(error:Error)=>void;readonly timer:ReturnType<typeof setTimeout>;settled:boolean}
/** One Host-owned worker, request budget and awaited shutdown. */
export class MemoryStore{
 private readonly worker:Worker
 private readonly leaseId=randomUUID()
 private readonly pending=new Map<number,Pending>()
 private readonly done:Promise<void>
 private readonly ready:Promise<void>
 private fault:MemoryError|undefined
 private serial=0
 private bytes=0
 private exited=false
 private stopping:Promise<void>|undefined
 private constructor(private readonly spec:Spec){
  this.worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{directory:spec.directory,namespace:spec.namespace,busyMs:spec.busyMs,maxForgetKeys:spec.maxForgetKeys,maxReceiptHeads:spec.maxResults,leaseId:this.leaseId}})
  this.done=new Promise(done=>this.worker.once('exit',()=>{this.exited=true;this.fail(new MemoryError('unavailable'));done()}))
  this.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{const error=new MemoryError('timeout');this.fail(error);reject(error)},spec.startupMs)
   const failed=(error:Error)=>{clearTimeout(timer);reject(error)}
   this.worker.once('error',()=>failed(new MemoryError('unavailable')));void this.done.then(()=>failed(new MemoryError('unavailable')))
   this.worker.on('message',(raw:unknown)=>{
    const parsed=replySchema.safeParse(raw);if(!parsed.success){const error=new MemoryError('invalid-data');this.fail(error);failed(error);return}
    const value=parsed.data
    if(value.type==='ready'){clearTimeout(timer);resolve();return}
    if(value.type==='fatal'){const error=new MemoryError(value.code);this.fail(error);failed(error);return}
    const pending=this.pending.get(value.id);if(!pending)return
    this.pending.delete(value.id);this.bytes-=pending.bytes;clearTimeout(pending.timer)
    if(!pending.settled){if(value.ok)pending.resolve(value.value);else pending.reject(new MemoryError(value.code))}
   })
  })
  this.worker.on('error',()=>this.fail(new MemoryError('unavailable')))
 }
 /** @param spec - fully resolved deployment limits. @returns ready storage; startup failures leave no owned worker. */
 static async open(spec:Spec):Promise<MemoryStore>{const store=new MemoryStore(spec);try{await store.ready;return store}catch(error){await store.close();throw error}}
 private fail(error:MemoryError):void{this.fault??=error;for(const item of this.pending.values()){clearTimeout(item.timer);if(!item.settled)item.reject(['observe','put','forget','confirm'].includes(item.method)?new MemoryError('write-uncertain'):this.fault)}this.pending.clear();this.bytes=0}
 /** @returns requests whose worker reply is not yet acknowledged, including timed-out writes. */
 pendingCount():number{return [...this.pending.values()].filter(item=>item.method!=='close').length}
 /** @returns current worker fault without data or private diagnostics. */
 health():import('./wire.ts').Failure|null{return this.fault?.code??null}
 /** @param method - owned protocol operation. @param input - validated serializable data. @param now - recording time. @returns worker acknowledgement; timeout does not imply a write failed. */
 request(method:Method,input:unknown,now:number):Promise<unknown>{
  if(this.fault)return Promise.reject(this.fault)
  if(this.stopping&&method!=='close')return Promise.reject(new MemoryError('closed'))
  let bytes:number;try{bytes=Buffer.byteLength(JSON.stringify(input),'utf8')}catch(error){return Promise.reject(new MemoryError('invalid-data'))}
  if(method!=='close'&&(this.pending.size>=this.spec.maxPending||this.bytes+bytes>this.spec.maxInflightBytes))return Promise.reject(new MemoryError('capacity'))
  const id=++this.serial
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{const item=this.pending.get(id);if(item&&!item.settled){item.settled=true;reject(new MemoryError(['observe','put','forget','confirm'].includes(method)?'write-uncertain':'timeout'))}},this.spec.requestTimeoutMs)
   this.pending.set(id,{method,bytes,timer,resolve,reject,settled:false});this.bytes+=bytes
   try{this.worker.postMessage({id,method,input,now})}catch(error){this.pending.delete(id);this.bytes-=bytes;clearTimeout(timer);reject(new MemoryError('unavailable'))}
  })
 }
 private async releaseDeadWorkerLease():Promise<void>{
  const path=join(this.spec.directory,'owner.lock')
  try{const value:unknown=JSON.parse(await readFile(path,'utf8'));if(value&&typeof value==='object'&&'leaseId'in value&&value.leaseId===this.leaseId)await unlink(path)}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw new MemoryError('unavailable')}
 }
 /** @returns completion only after owned worker exit and exact-lease cleanup; repeated calls share it. */
 close():Promise<void>{
  if(this.stopping)return this.stopping
  this.stopping=(async()=>{
   let expired=false
   const deadline=setTimeout(()=>{expired=true;void this.worker.terminate()},this.spec.shutdownMs)
   try{if(!this.exited&&!this.fault)await this.request('close',null,Date.now());if(!this.exited&&this.fault)await this.worker.terminate();await this.done;if(expired)throw new MemoryError('timeout')}
   finally{clearTimeout(deadline);this.fail(new MemoryError('closed'));if(!this.exited){await this.worker.terminate();await this.done}await this.releaseDeadWorkerLease()}
  })()
  return this.stopping
 }
}
