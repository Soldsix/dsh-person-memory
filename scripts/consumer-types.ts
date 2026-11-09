/** Independent installed declarations; no workspace paths or skipped library checks. */
import {Context} from '@deepseek-ai/cordis'
import {brandString} from '@deepseek-ai/dsh-brand'
import {identifier} from 'dsh-im-kit'
import {RequestAuthority} from 'dsh-im-requests'
import {Config,apply,MemoryError,MEMORY_TOOL,type PersonMemoryService,type PersonRef,type MutationReceipt} from 'dsh-person-memory'
import Control,{Config as ControlConfig,type Snapshot,type InspectRequest} from 'dsh-person-memory/control'
const context=new Context(),person:PersonRef={scope:{account:{tenantId:identifier('im.tenant','tenant'),networkId:identifier('im.network','onebot11'),accountId:identifier('im.account','bot')},kind:'group',peerId:identifier('im.peer','room')},subject:identifier('im.user','alice')}
const service:PersonMemoryService=context.personMemory
const control:Control=context.personMemoryControl
const pending:Promise<MutationReceipt>=service.confirm({person,key:'drink',expectedVersion:1,mutationId:brandString<import('dsh-person-memory').MutationId>('synthetic-operation')},new AbortController().signal)
const authority=new RequestAuthority('sender')
void [Config,apply,MemoryError,MEMORY_TOOL,ControlConfig,service,control,pending,authority]
void (undefined as Snapshot|InspectRequest|undefined)
