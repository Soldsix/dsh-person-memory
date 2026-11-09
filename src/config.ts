/** Explicit scope, resource and storage resolution before opening a memory worker. */
import z from '@deepseek-ai/schemastery'
import {join,isAbsolute} from 'node:path'
import {identifier,type ConversationScope} from 'dsh-im-kit'
import type {Settings} from './fields.ts'
/** Parsed deployment settings; every selected conversation is opt-in. */
export interface Config extends Settings{}
/** Native schema used by Cordis and the owner controller. */
export const Config:z<Config>=z.object({
 enabled:z.boolean().default(false),namespace:z.string().default('personal'),directory:z.string().default(''),
 tenants:z.array(z.string()).default([]),networks:z.array(z.string()).default(['onebot11']),accounts:z.array(z.string()).default([]),groups:z.array(z.string()).default([]),privatePeers:z.array(z.string()).default([]),operators:z.array(z.object({tenant:z.string(),network:z.string(),account:z.string(),user:z.string()})).default([]),
 maxPending:z.number().min(1).max(4096).step(1).default(128),maxInflightBytes:z.number().min(1024).max(268435456).step(1).default(16777216),maxSourceChars:z.number().min(1).max(1048576).step(1).default(65536),maxContentChars:z.number().min(1).max(65536).step(1).default(2000),maxQuoteChars:z.number().min(1).max(65536).step(1).default(4096),
 maxResults:z.number().min(1).max(100).step(1).default(20),maxScanKeys:z.number().min(1).max(10000).step(1).default(256),maxForgetKeys:z.number().min(1).max(100000).step(1).default(10000),maxResultChars:z.number().min(256).max(16777216).step(1).default(32000),
 busyMs:z.number().min(0).max(10000).step(1).default(1000),requestTimeoutMs:z.number().min(100).max(60000).step(1).default(5000),startupMs:z.number().min(100).max(60000).step(1).default(10000),shutdownMs:z.number().min(100).max(60000).step(1).default(5000),toolsEnabled:z.boolean().default(false),
})
/** Resolved selections and an absolute profile-owned storage directory. */
export interface Spec extends Config{readonly selected:ReadonlySet<string>;readonly operatorKeys:ReadonlySet<string>}
/** @param config - parsed deployment configuration. @param profile - absolute DSH profile directory. @returns disabled state or validated explicit selections. */
export function resolve(config:Config,profile:string):Spec|null{
 if(!/^[a-z][a-z0-9_-]{0,63}$/u.test(config.namespace))throw new Error('Invalid memory namespace')
 if(config.directory&&!isAbsolute(config.directory))throw new Error('Memory directory must be absolute')
 if(config.busyMs>=config.requestTimeoutMs||config.maxResults>config.maxScanKeys||config.maxContentChars>config.maxResultChars)throw new Error('Inconsistent memory resource limits')
 const arrays=[config.tenants.map(value=>identifier('im.tenant',value)),config.networks.map(value=>identifier('im.network',value)),config.accounts.map(value=>identifier('im.account',value)),config.groups.map(value=>identifier('im.peer',value)),config.privatePeers.map(value=>identifier('im.peer',value))]
 if(arrays.some(array=>new Set<string>(array).size!==array.length))throw new Error('Distinct memory scope selections are required')
 const selected=new Set<string>();for(const [index,array]of arrays.entries())for(const value of array)selected.add(JSON.stringify([index,value]))
 const operators=config.operators.map(value=>JSON.stringify([identifier('im.tenant',value.tenant),identifier('im.network',value.network),identifier('im.account',value.account),identifier('im.user',value.user)]));if(new Set(operators).size!==operators.length)throw new Error('Duplicate memory operator')
 if(!config.enabled)return null
 if(!isAbsolute(profile))throw new Error('Memory requires an absolute profile directory')
 if(arrays.slice(0,3).some(array=>!array.length)||(!config.groups.length&&!config.privatePeers.length))throw new Error('Explicit memory scope selections are required')
 return{...config,directory:config.directory||join(profile,'data','person-memory',config.namespace),selected,operatorKeys:new Set(operators)}
}
/** @param spec - resolved scope selections. @param scope - trusted conversation. @returns whether all scope dimensions are selected. */
export function selected(spec:Spec,scope:ConversationScope):boolean{return[scope.account.tenantId,scope.account.networkId,scope.account.accountId,scope.peerId].every((value,index)=>spec.selected.has(JSON.stringify([index===3?(scope.kind==='group'?3:4):index,value])))}
