/** Explicit owner-selected memory browsing, confirmation, forgetting and page export. */
import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {Button,Input,Switch} from '@deepseek-ai/dsh-client-ui-primitives'
import type {PropsLocale} from '@deepseek-ai/dsh-client-ui-slots'
import {brandString} from '@deepseek-ai/dsh-brand'
import {inspectSchema} from '../control-codecs.ts'
import type {Snapshot,InspectRequest,ManageRequest,MemoryInspection} from '../control-types.ts'
import type {MemoryPage,Assertion,MutationId,MutationReceipt} from '../types.ts'
import {PageProblem} from './problem.ts'
/** Owner-only data operations, without model access to the control namespace. */
export interface InspectorFace{readonly inspect:(request:InspectRequest)=>Promise<MemoryInspection>;readonly confirm:(request:ManageRequest)=>Promise<MutationReceipt>;readonly forget:(request:ManageRequest)=>Promise<MutationReceipt>;readonly notify:(text:string,success:boolean)=>void}
/** @param props - current body-free generation and owner operations. @returns a selected-person inspector with no automatic body queries. */
export function Inspector({snapshot,t,inspect,confirm,forget,notify}:InspectorFace&PropsLocale<'personMemory'>&{snapshot:Snapshot}):ReactNode{
 const id=useId(),alive=useRef(true),serial=useRef(0),writing=useRef(false),request=useRef<InspectRequest|null>(null),hasData=useRef(false),view=useRef<MemoryInspection['view']|null>(null)
 const [fields,setFields]=useState({tenant:'',network:'onebot11',account:'',conversation:'',person:'',query:'',validAt:'',knownAt:''}),[privateChat,setPrivate]=useState(false),[candidates,setCandidates]=useState(false),[busy,setBusy]=useState(false),[page,setPage]=useState<MemoryPage|null>(null),[hint,setHint]=useState('')
 const clear=()=>{serial.current++;hasData.current=false;view.current=null;setPage(null);request.current=null}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;serial.current++}},[])
 useEffect(()=>{const displayed=view.current;if(displayed&&snapshot.active&&snapshot.healthy&&displayed.runtimeId===snapshot.runtimeId&&displayed.configRevision===snapshot.revision&&snapshot.generation<=displayed.generation)return;const affected=hasData.current||writing.current;clear();if(affected)setHint(t('changed'))},[snapshot.generation,snapshot.runtimeId,snapshot.revision,snapshot.active,snapshot.healthy])
 const error=(value:unknown)=>{clear();notify(value instanceof PageProblem?t(value.reason):t('unavailable'),false)}
 const run=async(body:()=>Promise<void>)=>{if(writing.current)return;writing.current=true;setBusy(true);try{await body()}catch(value){if(alive.current)error(value)}finally{writing.current=false;if(alive.current)setBusy(false)}}
 const fresh=():InspectRequest=>{
  const now=Date.now(),parsed=inspectSchema.safeParse({person:{scope:{account:{tenantId:fields.tenant,networkId:fields.network,accountId:fields.account},kind:privateChat?'private':'group',peerId:fields.conversation},subject:fields.person},query:fields.query,limit:snapshot.config.maxResults,validAt:fields.validAt?Date.parse(fields.validAt):now,knownAt:fields.knownAt?Date.parse(fields.knownAt):now,candidates})
  if(!parsed.success)throw new PageProblem('invalid');return parsed.data
 }
 const query=(next=false)=>run(async()=>{
  const base=next&&request.current?request.current:fresh(),selected=next&&page?.next?{...base,before:page.next}:base,turn=++serial.current
  const value=await inspect(selected);if(!alive.current||turn!==serial.current)return
  request.current=selected;hasData.current=true;view.current=value.view;setHint('');setPage(value.page)
 })
 const manage=(action:'confirm'|'forget',item:Assertion)=>run(async()=>{
  const selection=request.current,head=page?.heads.find(head=>head.key===item.key);if(!selection||!head||head.assertionId!==item.id)throw new PageProblem('conflict')
  clear();const value={person:selection.person,key:item.key,expectedVersion:head.version,mutationId:brandString<MutationId>(crypto.randomUUID())}
  await(action==='confirm'?confirm(value):forget(value));if(alive.current)notify(t(action==='confirm'?'confirmed':'forgot'),true)
 })
 const download=()=>run(async()=>{
  const selected=request.current,turn=serial.current;if(!selected)throw new PageProblem('invalid')
  const value=await inspect(selected);if(!alive.current||turn!==serial.current)return
  const content=JSON.stringify({format:'dsh-person-memory-page',version:1,completeBackup:false,person:selected.person,queryWindow:{validAt:selected.validAt,knownAt:selected.knownAt},page:value.page},null,2)+'\n',url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}))
  try{const link=document.createElement('a');link.href=url;link.download='person-memory-page.json';link.click()}finally{URL.revokeObjectURL(url)}
 })
 const changed=(key:keyof typeof fields,value:string)=>{clear();setHint('');setFields(previous=>({...previous,[key]:value}))}
 return<section className="personmemory-inspector"><h3>{t('inspector')}</h3><p>{t('forgetHelp')}</p><form onSubmit={event=>{event.preventDefault();void query()}}>
  {(Object.keys(fields) as (keyof typeof fields)[]).map(key=><div className="personmemory-field" key={key}><label htmlFor={`${id}-${key}`}>{t(key)}</label><Input id={`${id}-${key}`} type={key==='validAt'||key==='knownAt'?'datetime-local':'text'} disabled={busy} value={fields[key]} onChange={event=>changed(key,event.currentTarget.value)}/></div>)}
  <div className="personmemory-field"><span>{t('private')}</span><Switch label={t('private')} checked={privateChat} disabled={busy} onChange={value=>{clear();setPrivate(value)}}/></div><div className="personmemory-field"><span>{t('candidates')}</span><Switch label={t('candidates')} checked={candidates} disabled={busy} onChange={value=>{clear();setCandidates(value)}}/></div>
  <Button type="submit" disabled={busy||!snapshot.active||!snapshot.healthy}>{t('inspect')}</Button>
 </form>{!snapshot.healthy&&snapshot.active&&<p role="alert">{t('unhealthy')}</p>}{hint&&<p role="status">{hint}</p>}
 {page&&<><div className="personmemory-actions"><Button disabled={busy||!page.next} onClick={()=>{void query(true)}}>{t('next')}</Button><Button disabled={busy} onClick={()=>{void download()}}>{t('exportPage')}</Button></div>{page.partial&&<p role="status">{t('partial')}</p>}{page.assertions.length===0&&<p>{t('empty')}</p>}
 {page.assertions.map(item=>{const current=page.heads.some(head=>head.assertionId===item.id);return<article className="personmemory-record" key={item.id}><strong>{item.key}</strong><p>{t('version')}: {item.version} · {t('category')}: {t(item.category)}</p><p>{item.content}</p><p>{t('effective')}: {new Date(item.effectiveAt).toISOString()} · {t('recorded')}: {new Date(item.recordedAt).toISOString()}</p><p>{t('evidence')}: {item.evidence.messageId}</p><blockquote>{item.evidence.quote}</blockquote><div className="personmemory-actions"><Button disabled={busy||!current||item.category==='owner-confirmed'} onClick={()=>{void manage('confirm',item)}}>{t('confirm')}</Button><Button disabled={busy||!current} onClick={()=>{void manage('forget',item)}}>{t('forget')}</Button></div></article>})}</>}
 </section>
}
