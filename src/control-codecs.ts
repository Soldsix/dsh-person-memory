/** Shared strict JSON codecs for native owner requests and results. */
import * as z from 'zod/mini'
import {brandString} from '@deepseek-ai/dsh-brand'
import type {Settings} from './fields.ts'
import type {MutationId} from './types.ts'
import type {MemoryRuntimeId} from './control-types.ts'
import {personSchema,keySchema,assertionSchema,headSchema,failureSchema,cursorSchema} from './dto.ts'
const strings=z.array(z.string()),integer=z.int().check(z.minimum(0),z.maximum(Number.MAX_SAFE_INTEGER)),revision=z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const runtimeId=z.pipe(z.uuid(),z.transform(value=>brandString<MemoryRuntimeId>(value)))
const fields={enabled:z.boolean(),namespace:z.string(),directory:z.string(),tenants:strings,networks:strings,accounts:strings,groups:strings,privatePeers:strings,operators:z.array(z.strictObject({tenant:z.string(),network:z.string(),account:z.string(),user:z.string()})),maxPending:integer,maxInflightBytes:integer,maxSourceChars:integer,maxContentChars:integer,maxQuoteChars:integer,maxResults:integer,maxScanKeys:integer,maxForgetKeys:integer,maxResultChars:integer,busyMs:integer,requestTimeoutMs:integer,startupMs:integer,shutdownMs:integer,toolsEnabled:z.boolean()} satisfies {[K in keyof Settings]:z.ZodMiniType<Settings[K]>}
/** Complete saved configuration; missing fields do not silently inherit Client defaults. */
export const settingsSchema=z.strictObject(fields)
/** Optimistic settings edits do not carry runtime counters. */
export const saveSchema=z.strictObject({revision,patch:z.partial(settingsSchema)})
/** Body-free operational status remains available while disabled. */
export const snapshotSchema=z.strictObject({config:settingsSchema,revision,runtimeId:z.nullable(runtimeId),active:z.boolean(),healthy:z.boolean(),attached:z.boolean(),pending:integer,generation:integer,storedSources:integer,redactedSources:integer,assertions:integer,maintenance:z.boolean(),lastError:z.nullable(failureSchema),entryDisabled:z.boolean(),refreshMs:integer,toolState:z.enum(['disabled','inactive','waiting-provider','sender-isolation-required','registered']),toolActive:integer})
/** Owner-selected subject and exact absolute time window. */
export const inspectSchema=z.strictObject({person:personSchema,query:z.string().check(z.maxLength(256)),limit:z.int().check(z.minimum(1),z.maximum(100)),validAt:integer,knownAt:integer,candidates:z.boolean(),before:z.optional(cursorSchema)})
/** Confirmation and forgetting require a current selected key version. */
export const manageSchema=z.strictObject({person:personSchema,key:keySchema,expectedVersion:z.int().check(z.minimum(1)),mutationId:z.pipe(z.string().check(z.minLength(1),z.maxLength(1024)),z.transform(value=>brandString<MutationId>(value)))})
/** Public memory page, without worker-only cursor positions. */
export const memoryPageSchema=z.strictObject({assertions:z.array(assertionSchema),heads:z.array(headSchema),revision:integer,partial:z.boolean(),next:z.nullable(cursorSchema)})
/** Owner views carry the runtime identity separately from persisted memory data. */
export const inspectionResultSchema=z.strictObject({page:memoryPageSchema,view:z.strictObject({runtimeId,configRevision:revision,generation:integer})})
/** Source/key selection shared by small owner operations. */
export const selectionSchema=z.strictObject({person:personSchema,key:keySchema})
