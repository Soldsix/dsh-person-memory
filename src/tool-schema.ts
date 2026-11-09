/** Supported native JSON schemas for canonical personal-memory tool results. */
import type {JsonSchemaNode} from '@deepseek-ai/dsh-tools'
import {FAILURES} from './dto.ts'
const string={type:'string'} as const,number={type:'number'} as const,boolean={type:'boolean'} as const
const nullable=(value:JsonSchemaNode):JsonSchemaNode=>({oneOf:[value,{type:'null'}]})
const object=(properties:Record<string,JsonSchemaNode>):JsonSchemaNode=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
const head=object({key:string,version:number,forgotten:boolean,assertionId:nullable(string)})
const assertion=object({id:string,key:string,version:number,kind:{type:'string',enum:['preference','event','note']},content:string,category:{type:'string',enum:['candidate','user-requested','owner-confirmed','joke','roleplay','third-party']},effectiveAt:number,recordedAt:number,evidence:object({messageId:string,quote:string,sentAt:number,receivedAt:number,observedAt:number}),replaces:nullable(string)})
/** Canonical response schema contains only authorized claims, receipts and current heads. */
export const TOOL_OUTPUT_SCHEMA=object({status:{type:'string',enum:['ok','refused']},reason:{type:'string',enum:['none','unbound-request','sender-isolation-required','request-ended',...FAILURES]},action:{type:'string',enum:['recall','remember','forget','head','invalid']},page:nullable(object({assertions:{type:'array',items:assertion},heads:{type:'array',items:head},revision:number,partial:boolean,next:nullable(string)})),receipt:nullable(object({mutationId:string,outcome:{type:'string',enum:['applied','duplicate']},revision:number,currentRevision:number,affectedKeys:number,headsTruncated:boolean,heads:{type:'array',items:head}})),head:nullable(head),queryWindow:nullable(object({validAt:number,knownAt:number}))})
