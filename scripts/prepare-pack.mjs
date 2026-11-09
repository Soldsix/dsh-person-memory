/** Prepare the package output directory for a clean checkout. */
import {mkdir} from 'node:fs/promises'
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
