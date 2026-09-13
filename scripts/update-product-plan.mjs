import {access, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

// The founder's personal plan stays local and is not part of a public checkout.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plan=resolve(root,'work/product-plan');
try{await access(resolve(plan,'build-plan.mjs'));}catch{process.exit(0);}
const file=resolve(plan,'build-log.json');
const history=JSON.parse(await readFile(file,'utf8'));
let commit='uncommitted',dirty=true;
try{commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());}catch{/* A copied local workspace can still keep build evidence. */}
history.builds.push({at:new Date().toISOString(),commit,dirty,result:'Production app and extension packages built successfully.',acceptance:'Feature acceptance is recorded separately; a successful build verifies compilation and packaging.'});
await writeFile(file,JSON.stringify(history,null,2)+'\n');
execFileSync(process.execPath,[resolve(plan,'build-plan.mjs')],{cwd:root,stdio:'inherit'});
console.log('Updated the local product plan build record.');
