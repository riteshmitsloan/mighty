import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let local={};try{local=Object.fromEntries((await readFile(new URL('../.env',import.meta.url),'utf8')).split('\n').filter(x=>x&&!x.startsWith('#')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));}catch{}
const env={...process.env,MIGHTY_DEPS_ROOT:root,MIGHTY_SUPABASE_URL:process.env.MIGHTY_SUPABASE_URL||local.VITE_SUPABASE_URL||'',MIGHTY_SUPABASE_PUBLISHABLE_KEY:process.env.MIGHTY_SUPABASE_PUBLISHABLE_KEY||local.VITE_SUPABASE_PUBLISHABLE_KEY||''};
const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('../extension/',import.meta.url),env,stdio:'inherit'});process.exit(result.status??1);
