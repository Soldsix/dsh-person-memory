/** Opt-in scoped personal memory with optional normalized IM ingestion and native model tools. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from 'dsh-im-kit/cordis'
import type {} from 'dsh-im-requests/cordis'
import {Config,resolve,selected} from './config.ts'
import {MemoryEngine} from './engine.ts'
import {MemoryModelTool} from './model-tool.ts'
import type {PersonMemoryService,PersonRef,MemoryToolStatusService} from './types.ts'
export {Config}
export {MemoryError} from './wire.ts'
export type {Failure} from './wire.ts'
export type * from './types.ts'
export {MEMORY_TOOL} from './model-tool.ts'
export type {MemoryToolValue} from './model-tool.ts'
/** Cordis plugin identity. */
export const name='person-memory'
/** Storage belongs to a DSH profile; optional providers are mounted reversibly. */
export const inject=['profileContext']
declare module '@deepseek-ai/cordis'{interface Context{readonly personMemory:PersonMemoryService;readonly personMemoryModelTool:MemoryToolStatusService}interface Events{
 /** A committed person revision changed; observers must re-query authorized data. @mode parallel @param payload - data-free subject and revision. */
 'person-memory/changed'(payload:{readonly person:PersonRef;readonly revision:number}):void
}}
/** @param ctx - profile-owned services. @param config - parsed explicit selections and resource limits. @returns complete reversible runtime installation. */
export async function apply(ctx:Context,config:Config):Promise<void>{
 const spec=resolve(config,ctx.profileContext.dir);if(!spec)return
 if(ctx.get('personMemory'))throw new Error('Another personal memory service is installed')
 const engine=await MemoryEngine.open(spec,Date.now,(person,revision)=>{void ctx.parallel('person-memory/changed',{person,revision}).catch(observerError=>{/* Consumers must verify the current revision before using cached memory. */})})
 ctx.effect(()=>()=>engine.close());ctx.effect(()=>ctx.provide('personMemory',engine))
 ctx.inject(['im'],child=>{engine.setAttached(true);child.effect(()=>()=>engine.setAttached(false));child.effect(()=>child.im.subscribe((input,signal)=>engine.observe(input,'live',signal).then(result=>{if(result==='conflict')throw new Error('PERSON_MEMORY_SOURCE_CONFLICT')}),input=>selected(spec,input.scope)))})
 if(spec.toolsEnabled)ctx.inject(['tools','imRequests'],child=>{
  if(spec.groups.length&&child.imRequests.status().groupSessionMode!=='sender')return
  const tool=new MemoryModelTool(spec,engine,child.imRequests)
  child.effect(()=>{const detach=child.tools.register(tool.definition());return async()=>{detach();await tool.close()}});child.effect(()=>child.provide('personMemoryModelTool',tool))
 })
}
