/** Install only the headless browser used by isolated Web tests. */
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url))
const child=spawn(process.execPath,[join(root,'node_modules','playwright','cli.js'),'install','chromium-headless-shell',...process.argv.slice(2)],{env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:join(root,'.test-artifacts','browsers')},stdio:'inherit',windowsHide:true})
child.on('error',error=>{throw error});child.on('close',code=>{process.exitCode=code??1})
