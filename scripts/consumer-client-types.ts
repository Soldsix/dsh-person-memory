/** Client-facing declarations resolve only through the installed public export. */
import {Context} from '@deepseek-ai/cordis'
import {apply,inject} from 'dsh-person-memory/client'
const client:Promise<void>=apply(new Context())
const required:readonly string[]=inject
void [client,required]
