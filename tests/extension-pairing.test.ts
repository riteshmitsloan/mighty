import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedExtensionId,withoutExtensionRequest} from '../src/lib/extension-pairing';
const base='https://riteshmitsloan.github.io/mighty/';
const id='abcdefghijklmnopabcdefghijklmnop';
test('pairing accepts exactly one lowercase Chrome extension identifier',()=>{
 assert.equal(requestedExtensionId(base+'?mighty_extension='+id+'#connect-extension'),id);
 for(const url of [base,'broken',base+'#mighty_extension='+id,...['','a'.repeat(31),'a'.repeat(33),'z'.repeat(32),id.toUpperCase(),' '+id].map(value=>base+'?mighty_extension='+encodeURIComponent(value)),base+'?mighty_extension='+id+'&mighty_extension='+id])assert.equal(requestedExtensionId(url),null);
});
test('dismissal only removes pairing fields without changing a callback or unrelated navigation',()=>{
 assert.equal(withoutExtensionRequest(base+'?view=settings&mighty_extension='+id+'#connect-extension'),base+'?view=settings');
 assert.equal(withoutExtensionRequest(base+'?mighty_extension='+id+'&error_code=synthetic#another-section'),base+'?error_code=synthetic#another-section');
});
