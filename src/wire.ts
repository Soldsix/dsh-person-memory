/** Validation of worker messages, external requests and durable memory rows. */
import {z} from 'zod'
import {brandString} from '@deepseek-ai/dsh-brand'
import {identifier} from 'dsh-im-kit'
import type {MutationId,MemoryCursor} from './types.ts'
const raw=z.string().min(1).max(1024).refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/u.test(value))
const user=raw.transform(value=>identifier('im.user',value)),message=raw.transform(value=>identifier('im.message',value)),timestamp=z.number().int().nonnegative().safe()
export {scopeSchema,personSchema,keySchema,headSchema,assertionSchema,receiptSchema,sourceInfoSchema,failureSchema} from './dto.ts'
import {personSchema,keySchema,failureSchema} from './dto.ts'
const mutation=raw.transform(value=>brandString<MutationId>(value)),cursor=z.string().min(1).max(4096).transform(value=>brandString<MemoryCursor>(value))
/** Recall JSON never obtains authority from the actor field itself. */
export const recallSchema=z.strictObject({person:personSchema,actor:user,query:z.string().max(256),limit:z.number().int().min(1).max(100),validAt:timestamp,knownAt:timestamp,candidates:z.boolean(),before:cursor.optional()})
/** Source evidence and optimistic versions are required for each proposal. */
export const putSchema=z.strictObject({person:personSchema,actor:user,mutationId:mutation,key:keySchema,expectedVersion:z.number().int().nonnegative().safe(),kind:z.enum(['preference','event','note']),content:z.string().min(1),quote:z.string().min(1),messageId:message,effectiveAt:timestamp,category:z.enum(['candidate','joke','roleplay','third-party']),reopen:z.boolean()})
/** Forgetting has a stable operation identity and cannot silently replace a newer revision. */
export const forgetSchema=z.strictObject({person:personSchema,actor:user,mutationId:mutation,key:keySchema,expectedVersion:z.number().int().nonnegative().safe()})
/** Owner-only acceptance is not present in model tool arguments. */
export const confirmSchema=z.strictObject({person:personSchema,mutationId:mutation,key:keySchema,expectedVersion:z.number().int().positive().safe()})
/** Sanitized Host failure category. */
export type Failure=z.infer<typeof failureSchema>
/** Stable error type accepted by independent consumers. */
export class MemoryError extends Error{constructor(readonly code:Failure){super('Personal memory: '+code)}}
/** One bounded worker operation with validated JSON payload. */
export const commandSchema=z.strictObject({id:z.number().int().positive(),method:z.enum(['observe','put','forget','confirm','recall','head','source','stats','close']),input:z.unknown(),now:timestamp})
/** Worker messages are parsed before any value reaches a Host caller. */
export const replySchema=z.union([z.strictObject({type:z.literal('ready')}),z.strictObject({type:z.literal('fatal'),code:failureSchema}),z.strictObject({type:z.literal('reply'),id:z.number().int().positive(),ok:z.literal(true),value:z.unknown()}),z.strictObject({type:z.literal('reply'),id:z.number().int().positive(),ok:z.literal(false),code:failureSchema})])
