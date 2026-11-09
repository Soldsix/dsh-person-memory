/** Scoped personal assertions and trusted ingestion independent of a messaging transport. */
import type {Branded} from '@deepseek-ai/dsh-brand'
import type {ConversationScope,UserId,MessageId,InboundMessage} from 'dsh-im-kit'
/** Immutable assertion identity; it never identifies a person by itself. */
export type AssertionId=Branded<'person-memory.assertion'>
/** Caller-chosen identity for one durable mutation and its receipt. */
export type MutationId=Branded<'person-memory.mutation'>
/** Opaque, process-keyed page token. */
export type MemoryCursor=Branded<'person-memory.cursor'>
/** Exact conversation and authenticated person; the configured namespace is added by the owner. */
export interface PersonRef{readonly scope:ConversationScope;readonly subject:UserId}
/** Evidence is a quoted member statement, not independently verified real-world truth. */
export interface Evidence{readonly messageId:MessageId;readonly quote:string;readonly sentAt:number;readonly receivedAt:number;readonly observedAt:number}
/** Durable immutable version of one named personal assertion. */
export interface Assertion{
 readonly id:AssertionId;readonly key:string;readonly version:number;readonly kind:'preference'|'event'|'note';readonly content:string
 readonly category:'candidate'|'user-requested'|'owner-confirmed'|'joke'|'roleplay'|'third-party'
 readonly effectiveAt:number;readonly recordedAt:number;readonly evidence:Evidence;readonly replaces:AssertionId|null
}
/** Current optimistic revision remains after forgetting; forgotten content is omitted. */
export interface MemoryHead{readonly key:string;readonly version:number;readonly forgotten:boolean;readonly assertionId:AssertionId|null}
/** Body-free metadata for one recorded source; directive flags do not verify a claim's real-world truth. */
export interface SourceInfo{readonly messageId:MessageId;readonly sentAt:number;readonly receivedAt:number;readonly observedAt:number;readonly redacted:boolean;readonly live:boolean;readonly canForget:boolean}
/** Minimal model-adapter status; public Context types do not expose its concrete lifecycle class. */
export interface MemoryToolStatusService{/** @returns owned call count and shutdown state. */status():{readonly active:number;readonly closed:boolean}}
/** Time-aware retrieval with identity bound by trusted caller code. */
export interface RecallRequest{
 readonly person:PersonRef;readonly actor:UserId;readonly query:string;readonly limit:number;readonly validAt:number;readonly knownAt:number
 readonly candidates:boolean;readonly before?:MemoryCursor
}
/** Bounded page of original assertions and an encrypted continuation. */
export interface MemoryPage{readonly assertions:readonly Assertion[];readonly heads:readonly MemoryHead[];readonly revision:number;readonly partial:boolean;readonly next:MemoryCursor|null}
/** Source-grounded proposal; acceptance is computed from the source, never chosen by a model. */
export interface PutRequest{
 readonly person:PersonRef;readonly actor:UserId;readonly mutationId:MutationId;readonly key:string;readonly expectedVersion:number
 readonly kind:'preference'|'event'|'note';readonly content:string;readonly quote:string;readonly messageId:MessageId;readonly effectiveAt:number
 readonly category:'candidate'|'joke'|'roleplay'|'third-party';readonly reopen:boolean
}
/** Retraction deletes every version of the key and redacts sources that supported it. */
export interface ForgetRequest{readonly person:PersonRef;readonly actor:UserId;readonly mutationId:MutationId;readonly key:string;readonly expectedVersion:number}
/** Host-management confirmation; callers must establish profile-owner authority before calling. */
export interface ConfirmRequest{readonly person:PersonRef;readonly mutationId:MutationId;readonly key:string;readonly expectedVersion:number}
/** Inspectable mutation receipt; replay never repeats a write. */
export interface MutationReceipt{readonly mutationId:MutationId;readonly outcome:'applied'|'duplicate';readonly revision:number;readonly currentRevision:number;readonly affectedKeys:number;readonly headsTruncated:boolean;readonly heads:readonly MemoryHead[]}
/** Body-free operational status. */
export interface MemoryStatus{readonly pending:number;readonly attached:boolean;readonly healthy:boolean;readonly generation:number;readonly storedSources:number;readonly redactedSources:number;readonly assertions:number;readonly failures:number;readonly lastError:import('./wire.ts').Failure|null;readonly maintenance:boolean}
/** Host API; transport authentication and any owner-management authorization belong to the caller. */
export interface PersonMemoryService{
 /** @param input - trusted normalized source; scope and sender never come from model JSON. @param origin - live input or archive backfill. @param signal - cancellation joined before return. @returns insert, duplicate, redacted duplicate or conflicting identity. */
 observe(input:InboundMessage,origin:'live'|'archive',signal:AbortSignal):Promise<'stored'|'duplicate'|'redacted'|'conflict'>
 /** @param request - requester, selected person and retrieval filters. @param signal - cancellation of this read. @returns bounded claims; candidates and roleplay are excluded unless requested. */
 recall(request:RecallRequest,signal:AbortSignal):Promise<MemoryPage>
 /** @param request - evidence and expected revision. @param signal - cancelled writes may have committed; reconcile by mutation ID. @returns idempotent receipt without assertion text. */
 put(request:PutRequest,signal:AbortSignal):Promise<MutationReceipt>
 /** @param request - selected key and expected revision. @param signal - cancelled writes may have committed; reconcile by mutation ID. @returns retained tombstone and affected heads; no old version is restored. */
 forget(request:ForgetRequest,signal:AbortSignal):Promise<MutationReceipt>
 /** @param person - selected person. @param actor - authenticated requester. @param key - logical memory key. @param signal - caller cancellation. @returns head revision, including a forgotten head, or null. */
 head(person:PersonRef,actor:UserId,key:string,signal:AbortSignal):Promise<MemoryHead|null>
 /** @param person - exact source subject. @param actor - trusted requester. @param messageId - one selected source. @param signal - cancellation. @returns timestamps and explicit forgetting intent without source text. */
 source(person:PersonRef,actor:UserId,messageId:MessageId,signal:AbortSignal):Promise<SourceInfo>
 /** @param request - selected existing assertion and optimistic version. Caller must verify the profile owner. @param signal - cancelled writes can be uncertain. @returns a new confirmed version; the original evidence is retained. */
 confirm(request:ConfirmRequest,signal:AbortSignal):Promise<MutationReceipt>
 /** @returns body-free runtime counters. */
 status():MemoryStatus
 /** @returns whether idle admission was exclusively paused for an owner update. */
 beginMaintenance():boolean
 /** Release only this service's owner-update admission pause. */
 endMaintenance():void
}
