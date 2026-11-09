/** One owned SQLite worker executes bounded memory commands without blocking chat. */
import {parentPort,workerData} from 'node:worker_threads'
import {z} from 'zod'
import {MemoryDatabase} from './database.ts'
import {workerOptionsSchema,headRequestSchema,sourceRequestSchema} from './commands.ts'
import {commandSchema,MemoryError} from './wire.ts'
const port=parentPort;if(!port)throw new Error('Memory worker requires a parent port')
let database:MemoryDatabase|undefined
const code=(error:unknown)=>error instanceof MemoryError?error.code:error instanceof z.ZodError?'invalid-data':'unavailable'
try{
 database=new MemoryDatabase(workerOptionsSchema.parse(workerData));port.postMessage({type:'ready'})
 port.on('message',(raw:unknown)=>{
  const parsed=commandSchema.safeParse(raw);if(!parsed.success){port.postMessage({type:'fatal',code:'invalid-data'});database?.close();port.close();return}
  const {id,method,input,now}=parsed.data
  try{
   if(!database)throw new MemoryError('closed')
   let value:unknown
   switch(method){
    case'observe':value=database.observe(input,now);break
    case'put':value=database.put(input,now);break
    case'forget':value=database.forget(input,now);break
    case'confirm':value=database.confirm(input,now);break
    case'recall':value=database.recall(input);break
    case'head':{const request=headRequestSchema.parse(input);value=database.head(request.person,request.key);break}
    case'source':{const request=sourceRequestSchema.parse(input);value=database.source(request.person,request.messageId);break}
    case'stats':value=database.stats();break
    case'close':database.close();database=undefined;value=null;break
   }
   port.postMessage({type:'reply',id,ok:true,value});if(method==='close')port.close()
  }catch(error){port.postMessage({type:'reply',id,ok:false,code:code(error)})}
 })
}catch(error){try{database?.close()}catch(closeError){/* Startup failure still reports a sanitized category. */}port.postMessage({type:'fatal',code:code(error)});port.close()}
