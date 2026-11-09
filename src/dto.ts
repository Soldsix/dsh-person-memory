/** Shared small JSON codecs for worker rows, native clients and independent consumers. */
import * as z from 'zod/mini'
import {brandString} from '@deepseek-ai/dsh-brand'
import {identifier} from 'dsh-im-kit'
import type {AssertionId,MutationId,MemoryCursor} from './types.ts'
const raw=z.string().check(z.minLength(1),z.maxLength(1024),z.refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/u.test(value)))
const user=z.pipe(raw,z.transform(value=>identifier('im.user',value))),message=z.pipe(raw,z.transform(value=>identifier('im.message',value))),timestamp=z.int().check(z.minimum(0),z.maximum(Number.MAX_SAFE_INTEGER))
/** Exact authenticated conversation IDs; lists are never inferred from message text. */
export const scopeSchema=z.strictObject({account:z.strictObject({tenantId:z.pipe(raw,z.transform(value=>identifier('im.tenant',value))),networkId:z.pipe(raw,z.transform(value=>identifier('im.network',value))),accountId:z.pipe(raw,z.transform(value=>identifier('im.account',value)))}),kind:z.enum(['group','private']),peerId:z.pipe(raw,z.transform(value=>identifier('im.peer',value)))})
/** One exact subject in one conversation. */
export const personSchema=z.strictObject({scope:scopeSchema,subject:user})
/** Keys are logical labels; member content belongs in assertion values and evidence. */
export const keySchema=z.string().check(z.regex(/^[a-z][a-z0-9_.-]{0,127}$/u))
const mutation=z.pipe(raw,z.transform(value=>brandString<MutationId>(value))),assertionId=z.pipe(raw,z.transform(value=>brandString<AssertionId>(value)))
/** Opaque page token; decoding and authorization remain Host-only. */
export const cursorSchema=z.pipe(z.string().check(z.minLength(1),z.maxLength(4096)),z.transform(value=>brandString<MemoryCursor>(value)))
/** Tombstones retain optimistic versions without their old content. */
export const headSchema=z.strictObject({key:keySchema,version:z.int().check(z.minimum(1)),forgotten:z.boolean(),assertionId:z.nullable(assertionId)})
/** Source-linked assertion; categories do not independently establish objective truth. */
export const assertionSchema=z.strictObject({id:assertionId,key:keySchema,version:z.int().check(z.minimum(1)),kind:z.enum(['preference','event','note']),content:z.string().check(z.minLength(1)),category:z.enum(['candidate','user-requested','owner-confirmed','joke','roleplay','third-party']),effectiveAt:timestamp,recordedAt:timestamp,evidence:z.strictObject({messageId:message,quote:z.string().check(z.minLength(1)),sentAt:timestamp,receivedAt:timestamp,observedAt:timestamp}),replaces:z.nullable(assertionId)})
/** Receipt separates the original applied revision from the current state of its keys. */
export const receiptSchema=z.strictObject({mutationId:mutation,outcome:z.enum(['applied','duplicate']),revision:timestamp,currentRevision:timestamp,affectedKeys:timestamp,headsTruncated:z.boolean(),heads:z.array(headSchema)})
/** Current source timestamps and intent flags, without a message body. */
export const sourceInfoSchema=z.strictObject({messageId:message,sentAt:timestamp,receivedAt:timestamp,observedAt:timestamp,redacted:z.boolean(),live:z.boolean(),canForget:z.boolean()})
/** Failure vocabulary shared by the worker, Host and localized Client. */
export const FAILURES=['invalid-data','forbidden','conflict','source-missing','evidence-mismatch','forgotten','stale-cursor','capacity','busy','cancelled','timeout','write-uncertain','closed','schema-unsupported','owned','unavailable'] as const
/** Sanitized operational category. */
export const failureSchema=z.enum(FAILURES)
