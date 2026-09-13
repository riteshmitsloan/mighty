import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configuredAppURLs,appConnectionPatterns} from '../scripts/app-config.mjs';

test('default build preserves hosted base path and source manifest uses the same narrow connection patterns',async()=>{
 const urls=configuredAppURLs(),patterns=appConnectionPatterns(urls);
 assert.equal(urls[0],'https://riteshmitsloan.github.io/mighty/');
 assert.deepEqual(patterns,['https://riteshmitsloan.github.io/mighty/*','http://127.0.0.1/*','http://localhost/*']);
 const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.externally_connectable.matches,patterns);
 assert.equal(manifest.version,'0.3.7');
 assert.ok(manifest.host_permissions.every(value=>value.includes('linkedin.com/')));
});
test('build config retains deployment paths, deduplicates base URLs and refuses malformed or broader hosted scopes',()=>{
 assert.deepEqual(configuredAppURLs('https://example.test/app,https://example.test/app/,http://localhost:5174'),['https://example.test/app/','http://localhost:5174/']);
 for(const value of ['https://riteshmitsloan.github.io/','https://riteshmitsloan.github.io/other/','https://riteshmitsloan.github.io:444/mighty/','https://*.github.io/mighty/','https://user:password@example.test/app/','https://example.test/app/?next=other','https://example.test/app/#token','https://example.test/*','https://example.test/%2fapp','http://remote.example/app/'])assert.throws(()=>configuredAppURLs(value),undefined,value);
});
