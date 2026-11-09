/** Complete explicitly required public DSH peers in a freshly generated QA profile. */
import {readdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
/** @param profile - isolated profile root. @returns undeclared non-optional peer requests from installed DSH packages. */
export async function requiredProfilePeers(profile){
 const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8')),scope=join(profile,'node_modules','@deepseek-ai'),required=new Map()
 for(const name of await readdir(scope)){
  const value=JSON.parse(await readFile(join(scope,name,'package.json'),'utf8'))
  for(const [name,version] of Object.entries(value.peerDependencies??{})){
   if(!name.startsWith('@deepseek-ai/')||value.peerDependenciesMeta?.[name]?.optional||manifest.dependencies?.[name])continue
   const previous=required.get(name);if(previous&&previous!==version)throw Error('Conflicting QA peer versions: '+name)
   required.set(name,version)
  }
 }
 return[...required].sort(([a],[b])=>a.localeCompare(b)).map(([name,version])=>name+'@'+version)
}
