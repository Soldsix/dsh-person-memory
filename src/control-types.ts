/** Owner-only native settings and selected-person memory management. */
import type {Settings} from './fields.ts'
import type {PersonRef,MemoryCursor,MutationId,MemoryPage} from './types.ts'
import type {Branded} from '@deepseek-ai/dsh-brand'
import type {Failure} from './wire.ts'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
/** Saved settings and body-free runtime counters. */
export interface Snapshot{readonly config:Settings;readonly revision:string;readonly runtimeId:MemoryRuntimeId|null;readonly active:boolean;readonly healthy:boolean;readonly attached:boolean;readonly pending:number;readonly generation:number;readonly storedSources:number;readonly redactedSources:number;readonly assertions:number;readonly maintenance:boolean;readonly lastError:Failure|null;readonly entryDisabled:boolean;readonly refreshMs:number;readonly toolState:'disabled'|'inactive'|'waiting-provider'|'sender-isolation-required'|'registered';readonly toolActive:number}
/** Ephemeral identity of one owner-visible service instance, never a person or database ID. */
export type MemoryRuntimeId=Branded<'person-memory/runtime'>
/** A query and its service/configuration generation for late-status invalidation. */
export interface MemoryInspection{readonly page:MemoryPage;readonly view:{readonly runtimeId:MemoryRuntimeId;readonly configRevision:string;readonly generation:number}}
/** Revision-checked partial settings edit. Undefined fields are omitted by JSON transport. */
export interface SaveRequest{readonly revision:string;readonly patch:{readonly [K in keyof Settings]?:Settings[K]|undefined}}
/** Owner selects one subject and explicit time window; identity is never inferred from message text. */
export interface InspectRequest{readonly person:PersonRef;readonly query:string;readonly limit:number;readonly validAt:number;readonly knownAt:number;readonly candidates:boolean;readonly before?:MemoryCursor|undefined}
/** Optimistic owner confirmation or retraction. */
export interface ManageRequest{readonly person:PersonRef;readonly key:string;readonly expectedVersion:number;readonly mutationId:MutationId}
/** Sanitized remote failure; no private diagnostics or argument values are exposed. */
export type ControlFailure=Failure|'invalid'|'unavailable'|'apply-failed'|'request-provider-missing'|'sender-isolation-required'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface RemoteErrorDetailsMap{
 /** Owner operations cannot reveal source text in failures. */
 'person-memory/control':{readonly reason:ControlFailure}
}}
