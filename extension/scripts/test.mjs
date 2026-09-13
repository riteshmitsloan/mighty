import{spawnSync}from'node:child_process';import{resolve}from'node:path';import{readdirSync}from'node:fs';import{deps}from'./dependencies.mjs';
const tests=readdirSync('tests').filter(name=>name.endsWith('.test.ts')).sort().map(name=>'tests/'+name);
const r=spawnSync(process.execPath,['--import',resolve(deps,'node_modules/tsx/dist/loader.mjs'),'--test',...tests,'tests/app-config.test.mjs'],{stdio:'inherit',env:{...process.env,MIGHTY_DEPS_ROOT:deps}});process.exit(r.status??1);
