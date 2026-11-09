/** Worker-only data records and query positions; no authority is derived from queued actor fields. */
import {z} from 'zod'
import {identifier} from 'dsh-im-kit'
import {personSchema,keySchema,assertionSchema,headSchema} from './wire.ts'
const timestamp=z.number().int().nonnegative().safe()
/** Transport text is preserved once; attachments remain owned by their source/archive. */
export const sourceSchema=z.strictObject({person:personSchema,messageId:z.string().min(1).transform(value=>identifier('im.message',value)),fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),text:z.string(),origin:z.enum(['live','archive']),sentAt:timestamp,receivedAt:timestamp,hasNonText:z.boolean()})
/** A bounded lexicographic key position is bound to its person revision by the Host. */
export const recallPositionSchema=z.strictObject({after:z.string().max(128),revision:z.number().int().nonnegative().safe()})
/** Internal query includes only normalized filters and resource caps. */
export const readSchema=z.strictObject({person:personSchema,query:z.string().max(256),validAt:timestamp,knownAt:timestamp,candidates:z.boolean(),limit:z.number().int().min(1).max(100),maxScanKeys:z.number().int().positive(),maxResultChars:z.number().int().positive(),position:recallPositionSchema.nullable()})
/** Worker return is checked again before publication. */
export const pageSchema=z.strictObject({assertions:z.array(assertionSchema),heads:z.array(headSchema),revision:z.number().int().nonnegative().safe(),partial:z.boolean(),position:recallPositionSchema.nullable()})
/** Head inspection is limited to one already authorized person. */
export const headRequestSchema=z.strictObject({person:personSchema,key:keySchema})
/** One already authorized source, selected by the live invocation rather than model JSON. */
export const sourceRequestSchema=z.strictObject({person:personSchema,messageId:z.string().min(1).transform(value=>identifier('im.message',value))})
/** Only absolute storage and bounded deployment choices are passed to the worker. */
export const workerOptionsSchema=z.strictObject({directory:z.string().min(1),namespace:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),busyMs:z.number().int().nonnegative().max(10000),leaseId:z.string().uuid(),maxForgetKeys:z.number().int().positive().max(100000),maxReceiptHeads:z.number().int().positive().max(100)})
/** Parsed worker startup options. */
export type WorkerOptions=z.infer<typeof workerOptionsSchema>
