/** Strict native descriptors for owner-only personal-memory operations. */
import type {RemoteResult,TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol/types'
import type {Snapshot,SaveRequest,InspectRequest,ManageRequest,MemoryInspection} from '../control-types.ts'
import type {MutationReceipt} from '../types.ts'
import {snapshotSchema,saveSchema,inspectSchema,manageSchema,inspectionResultSchema} from '../control-codecs.ts'
import {receiptSchema} from '../dto.ts'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface TypertRemoteNamespaceMap{
 /** Source bodies and mutation operations require the profile owner. */
 personMemoryControl:{describe():Promise<RemoteResult<Snapshot>>;save(request:SaveRequest):Promise<RemoteResult<Snapshot>>;inspect(request:InspectRequest):Promise<RemoteResult<MemoryInspection>>;confirm(request:ManageRequest):Promise<RemoteResult<MutationReceipt>>;forget(request:ManageRequest):Promise<RemoteResult<MutationReceipt>>}
}}
/** Native owner remote; model tools do not receive this namespace. */
export const remote:TypertRemoteContribution={package:'dsh-person-memory',descriptors:[
 {id:'personMemoryControl/describe',service:'personMemoryControl',namespace:'personMemoryControl',method:'describe',invocation:{kind:'direct'},parameters:[],result:{mode:'strict',typeSymbol:'dsh-person-memory#snapshot',create:()=>snapshotSchema}},
 ...(['save','inspect','confirm','forget'] as const).map(method=>({id:`personMemoryControl/${method}`,service:'personMemoryControl',namespace:'personMemoryControl',method,invocation:{kind:'direct' as const},parameters:[{name:'request',wire:'request',source:'json' as const,codec:{mode:'strict' as const,typeSymbol:'dsh-person-memory#'+method+'Request',create:()=>method==='save'?saveSchema:method==='inspect'?inspectSchema:manageSchema}}],result:{mode:'strict' as const,typeSymbol:'dsh-person-memory#'+method+'Result',create:()=>method==='save'?snapshotSchema:method==='inspect'?inspectionResultSchema:receiptSchema}})),
]}
