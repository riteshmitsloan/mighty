import {spawn} from 'node:child_process';
import {copyFile, mkdtemp, realpath, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {delimiter, join, resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {appDependencyStubs} from './mocks.mjs';

// This file lives at tests/ui/run.mjs. Resolve from its location so the suite
// also runs when invoked from outside the checkout or from a path with spaces.
const checkoutRoot = fileURLToPath(new URL('../../', import.meta.url));
const appFile = await realpath(join(checkoutRoot, 'src', 'App.tsx'));
const requireFromCheckout = createRequire(join(checkoutRoot, 'package.json'));
const {build} = requireFromCheckout('esbuild');
const outputDirectory = await mkdtemp(join(tmpdir(), 'mighty-ui-tests-'));
const stubPaths=new Map(['./lib/local-sources','./lib/owner-handoff'].map(path=>[resolve(dirname(appFile),path),path]));

try {
  await build({
    entryPoints: [appFile],
    outfile: join(outputDirectory, 'app.cjs'),
    absWorkingDir: checkoutRoot,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: {'.css': 'empty'},
    // The mailbox worker is outside this suite. Supplying its base URL avoids
    // changing the original App or emitting an import.meta warning in CJS.
    define: {'import.meta.url': JSON.stringify(pathToFileURL(appFile).href)},
    plugins: [{
      name: 'app-ui-boundaries',
      setup(builder) {
        builder.onResolve({filter: /.*/}, args => {
          const key=args.importer===appFile&&Object.hasOwn(appDependencyStubs,args.path)?args.path:args.path.startsWith('.')?stubPaths.get(resolve(dirname(args.importer),args.path)):undefined;
          if(key)return {path:key,namespace:'ui-test-stub'};
        });
        builder.onLoad({filter: /.*/, namespace: 'ui-test-stub'}, args => ({
          contents: appDependencyStubs[args.path],
          loader: 'ts',
        }));
      },
    }],
  });
  const testFile = join(outputDirectory, 'app.test.cjs');
  await copyFile(new URL('./app.test.cjs', import.meta.url), testFile);
  await build({entryPoints:[join(checkoutRoot,'src/components/AccountPanel.tsx'),join(checkoutRoot,'src/lib/owner-auth.ts')],outdir:outputDirectory,entryNames:'[name]',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external'});
  const accountTestFile=join(outputDirectory,'account.test.cjs');
  await copyFile(new URL('./account.test.cjs',import.meta.url),accountTestFile);
  const handoffPath=join(checkoutRoot,'src/lib/device-handoff.ts');
  await build({entryPoints:[join(checkoutRoot,'src/components/DeviceSourcesPanel.tsx')],outfile:join(outputDirectory,'panel.cjs'),bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},plugins:[{name:'device-panel-boundaries',setup(builder){
    builder.onResolve({filter:/\/local-sources$/},()=>({path:'local',namespace:'device-fixture'}));
    builder.onResolve({filter:/\/owner-handoff$/},()=>({path:'handoff',namespace:'device-fixture'}));
    builder.onLoad({filter:/.*/,namespace:'device-fixture'},({path})=>({contents:path==='local'?'export const localSources=key=>globalThis.__DEVICE_PANEL__.readLocal(key);':`export {HANDOFF_FIELDS} from ${JSON.stringify(handoffPath)}; export const prepareDeviceHandoff=(...args)=>globalThis.__DEVICE_PANEL__.prepare(...args);`,loader:'js',resolveDir:checkoutRoot}));
  }}]});
  await build({entryPoints:[handoffPath],outfile:join(outputDirectory,'handoff.cjs'),bundle:true,platform:'node',format:'cjs'});
  const deviceTestFile=join(outputDirectory,'device-panel.test.cjs');
  await copyFile(new URL('./device-panel.test.cjs',import.meta.url),deviceTestFile);
  const childStatus = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', testFile, accountTestFile, deviceTestFile], {
      cwd: checkoutRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Both the temporary bundle and copied tests must resolve the same
        // installed React instance. NODE_PATH is only used by this CJS child.
        NODE_PATH: [join(checkoutRoot, 'node_modules'), process.env.NODE_PATH]
          .filter(Boolean).join(delimiter),
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  process.exitCode = childStatus;
} finally {
  await rm(outputDirectory, {recursive: true, force: true});
}
