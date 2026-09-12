import{readFile,writeFile,mkdir,cp,rm}from'node:fs/promises';import{requireDeps}from'./dependencies.mjs';
const {build}=requireDeps('esbuild');
const origins=(process.env.MIGHTY_APP_ORIGINS||'http://127.0.0.1:5173,http://localhost:5173').split(',').map(x=>new URL(x.trim()).origin);
for(const origin of origins){const u=new URL(origin);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Only HTTPS app origins or explicit loopback development origins are supported.');}
const supabaseUrl=(process.env.MIGHTY_SUPABASE_URL||'').replace(/\/$/,'');if(supabaseUrl){const u=new URL(supabaseUrl);if(u.protocol!=='https:'||u.pathname!=='/'||u.username||u.password)throw Error('Supabase URL must be an HTTPS origin.');}
const publishableKey=process.env.MIGHTY_SUPABASE_PUBLISHABLE_KEY||'';
if(publishableKey&&!publishableKey.startsWith('sb_publishable_')){let role='';try{role=JSON.parse(Buffer.from(publishableKey.split('.')[1]||'','base64url').toString()).role;}catch{}if(role!=='anon')throw Error('Only a Supabase publishable key or legacy anon key may be bundled. Secret/service-role keys are forbidden.');}
const publicConfig={appOrigins:origins,supabaseUrl,publishableKey};
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
await build({entryPoints:['src/worker.ts','src/content.ts','src/popup.ts'],outdir:'dist',bundle:true,format:'iife',platform:'browser',target:'chrome120',define:{__PUBLIC_CONFIG__:JSON.stringify(publicConfig)},sourcemap:false,minify:false});
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
manifest.externally_connectable.matches=[...new Set(origins.map(x=>new URL(x).protocol+'//'+new URL(x).hostname+'/*'))];
if(supabaseUrl)manifest.host_permissions.push(supabaseUrl+'/*');
manifest.content_security_policy.extension_pages="script-src 'self'; object-src 'none'; connect-src 'self'"+(supabaseUrl?' '+supabaseUrl:'')+';';
await writeFile('dist/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Built unpacked prototype. Supabase integration '+(supabaseUrl&&publicConfig.publishableKey?'configured.':'is not configured; account connection will explain this.'));
