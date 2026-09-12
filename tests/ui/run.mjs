import {spawn} from 'node:child_process';
import {copyFile, mkdtemp, realpath, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {appDependencyStubs} from './mocks.mjs';

// This file lives at tests/ui/run.mjs. Resolve from its location so the suite
// also runs when invoked from outside the checkout or from a path with spaces.
const checkoutRoot = fileURLToPath(new URL('../../', import.meta.url));
const appFile = await realpath(join(checkoutRoot, 'src', 'App.tsx'));
const requireFromCheckout = createRequire(join(checkoutRoot, 'package.json'));
const {build} = requireFromCheckout('esbuild');
const outputDirectory = await mkdtemp(join(tmpdir(), 'mighty-ui-tests-'));

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
          if (args.importer === appFile && Object.hasOwn(appDependencyStubs, args.path)) {
            return {path: args.path, namespace: 'ui-test-stub'};
          }
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
  const childStatus = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', testFile], {
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
