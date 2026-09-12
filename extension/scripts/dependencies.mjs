import{fileURLToPath}from'node:url';
import{createRequire}from'node:module';import{existsSync}from'node:fs';import{resolve}from'node:path';
export const deps=process.env.MIGHTY_DEPS_ROOT||fileURLToPath(new URL('../../',import.meta.url));
if(!existsSync(resolve(deps,'node_modules')))throw Error('Set MIGHTY_DEPS_ROOT to a project with esbuild, tsx, TypeScript, Chrome types, and linkedom.');
export const requireDeps=createRequire(resolve(deps,'package.json'));
