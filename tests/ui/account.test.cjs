const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {parseHTML} = require('linkedom');
const React = require('react');
const {act} = React;
const {createRoot} = require('react-dom/client');
const AccountPanel = require('./AccountPanel.cjs').default;
const {ownerLinkRequest, sendOwnerLink, signOutOwner, ownerCallbackError} = require('./owner-auth.cjs');
const props = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};};
const text = () => document.body.textContent;
let root, client, calls, overrides;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const render = async patch => {overrides={...overrides,...patch};await act(async()=>{root.render(React.createElement(AccountPanel,{client,uid:null,...overrides}));await tick();});};
const renderLink = async patch => {await render(patch);if(document.querySelector('input[type=password]'))await act(async()=>{props([...document.querySelectorAll('button')].find(item=>item.textContent==='Use an email sign-in link')).onClick();});};
const editField = async (name,value) => act(async()=>{props(document.querySelector(`input[name=${name}]`)).onChange({target:{value}});});
const edit = async value => act(async()=>{props(document.querySelector('input')).onChange({target:{value}});});
const submit = async () => act(async()=>{props(document.querySelector('form')).onSubmit({preventDefault(){}});await tick();});
const button = () => document.querySelector('button');
beforeEach(()=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  window.location={href:'https://mighty.example.test/me?next=https://other.test/#ignored'};
  Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  calls=[];overrides={};
  client={auth:{signInWithPassword:async request=>{calls.push(request);return {error:null};},signInWithOtp:async request=>{calls.push(request);return {error:null};},signOut:async options=>{calls.push(options);return {error:null};}}};
  root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());});

test('request forbids signup and fixes the redirect to the validated current origin',()=>{
  assert.deepEqual(ownerLinkRequest('  Owner+test@example.test  ','https://mighty.example.test/private?next=https://other.test/#token'),{
    email:'Owner+test@example.test',options:{shouldCreateUser:false,emailRedirectTo:'https://mighty.example.test/'},
  });
  for(const origin of ['http://localhost:5173','http://127.0.0.1:5173']) assert.equal(ownerLinkRequest('owner@example.test',origin).options.emailRedirectTo,origin+'/');
});
test('insecure remote, credential-bearing and non-web redirect origins fail before any request',async()=>{
  for(const url of ['http://mighty.example.test','http://localhost.other.test','http://127.0.0.2:5173','https://user:password@mighty.example.test','javascript:alert(1)','file:///private/tmp/app.html','not a url']) {
    await assert.rejects(sendOwnerLink(client,'owner@example.test',url));
  }
  assert.equal(calls.length,0);
});
test('hosted owner links return to the Mighty app directory with no callback or redirect parameters',async()=>{
 const origin='https://riteshmitsloan.github.io';
 for(const path of ['/mighty','/mighty/','/mighty/index.html?next=https://other.test/#access_token=fixture'])assert.equal(ownerLinkRequest('owner@example.test',origin+path).options.emailRedirectTo,origin+'/mighty/');
 window.location.href=origin+'/mighty/?code=fixture#ignored';
 await renderLink();await edit('owner@example.test');await submit();
 assert.deepEqual(calls,[{email:'owner@example.test',options:{shouldCreateUser:false,emailRedirectTo:origin+'/mighty/'}}]);
});
test('another repository on the hosted origin cannot request a Mighty sign-in callback',async()=>{
 const origin='https://riteshmitsloan.github.io';
 for(const path of ['/','/other/','/mighty-other/','/mighty/../other/','/mighty/%2e%2e/other/','/mighty/%2f../other/'])await assert.rejects(sendOwnerLink(client,'owner@example.test',origin+path),/Open the Mighty app/);
 assert.equal(calls.length,0);
});
test('invalid email never reaches auth; local part casing and plus addressing are retained',async()=>{
  for(const email of ['','bad address','person@','<person>@example.test','a'.repeat(255)+'@example.test']) await assert.rejects(sendOwnerLink(client,email,'https://mighty.example.test'));
  assert.equal(calls.length,0);
});
test('helper propagates returned, thrown and rejected auth failures',async()=>{
  for(const invoke of [()=>({error:{message:'Denied'}}),()=>{throw Error('Denied');},()=>Promise.reject(Error('Denied'))]) {
    client.auth.signInWithOtp=invoke;
    await assert.rejects(sendOwnerLink(client,'owner@example.test','https://mighty.example.test'),/Denied/);
  }
});
test('sign out is explicitly local and errors are preserved',async()=>{
  await signOutOwner(client);assert.deepEqual(calls,[{scope:'local'}]);
  client.auth.signOut=async()=>({error:{message:'Could not sign out'}});
  await assert.rejects(signOutOwner(client),/Could not sign out/);
});
test('mount, typing and a parent rerender never automatically send email',async()=>{
  await renderLink();await edit('owner@example.test');await renderLink({busy:true});await renderLink({busy:false});assert.equal(calls.length,0);
});
test('synchronous double submission sends once, and its message stays bound to the submitted email',async()=>{
  const request=deferred();client.auth.signInWithOtp=value=>{calls.push(value);return request.promise;};
  await renderLink();await edit('first@example.test');
  await act(async()=>{const form=props(document.querySelector('form'));form.onSubmit({preventDefault(){}});form.onSubmit({preventDefault(){}});await tick();});
  assert.equal(calls.length,1);assert.equal(button().disabled,true);
  // Simulate a later field update to ensure completion never reads the live draft.
  await edit('second@example.test');
  await act(async()=>{request.resolve({error:null});await tick();});
  assert.match(text(),/Check first@example.test for a sign-in link/);assert.doesNotMatch(text(),/Check second/);
  assert.match(button().textContent,/Resend in 60s/);await submit();assert.equal(calls.length,1);
});
test('resend becomes available after sixty seconds without sending automatically',async()=>{
  await renderLink();await edit('owner@example.test');await submit();assert.equal(button().disabled,true);
  const oldNow=Date.now;
  try {Date.now=()=>oldNow()+61_000;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});}
  finally {Date.now=oldNow;}
  assert.equal(button().disabled,false);assert.equal(calls.length,1);await submit();assert.equal(calls.length,2);
});
test('synchronous and asynchronous failures show an error and restore the submit button',async()=>{
  await renderLink();await edit('owner@example.test');
  client.auth.signInWithOtp=()=>{throw Error('Network unavailable');};await submit();assert.match(text(),/Network unavailable/);assert.equal(button().disabled,false);
  client.auth.signInWithOtp=()=>Promise.reject(Error('Try later'));await submit();assert.match(text(),/Try later/);assert.equal(button().disabled,false);
  client.auth.signInWithOtp=async()=>({error:{message:'Existing accounts only'}});await submit();assert.match(text(),/Existing accounts only/);assert.equal(button().disabled,false);
});
test('parent busy, session loading and missing configuration suppress requests',async()=>{
  await renderLink({busy:true});assert.equal(button().disabled,true);await submit();assert.equal(calls.length,0);
  await renderLink({busy:false,ready:false});assert.match(text(),/Checking your account/);assert.equal(document.querySelector('form'),null);
  await renderLink({ready:true,client:null});assert.match(text(),/unavailable here/);assert.equal(document.querySelector('form'),null);
});
test('pending completion cannot carry a private email or error across account changes',async()=>{
  const request=deferred();client.auth.signInWithOtp=()=>request.promise;
  await renderLink();await edit('private@example.test');await submit();
  await renderLink({uid:'fixture-owner',email:'signedin@example.test'});
  await act(async()=>{request.reject(Error('Private request failed'));await tick();});
  assert.doesNotMatch(text(),/private@example.test|Private request failed/);assert.match(text(),/signedin@example.test/);
  assert.equal(button().disabled,false);
});
test('sign out relies on parent identity updates, uses a mutex, and restores errors',async()=>{
  const request=deferred();client.auth.signOut=options=>{calls.push(options);return request.promise;};
  await renderLink({uid:'fixture-owner'});
  await act(async()=>{const onClick=props(button()).onClick;onClick();onClick();await tick();});assert.deepEqual(calls,[{scope:'local'}]);
  await act(async()=>{request.resolve({error:{message:'Could not sign out'}});await tick();});
  assert.match(text(),/Could not sign out/);assert.match(text(),/Your account/);assert.equal(button().disabled,false);
});
test('unmount during a request safely ignores its eventual result',async()=>{
  const request=deferred();client.auth.signInWithOtp=()=>request.promise;
  await renderLink();await edit('owner@example.test');await submit();
  await act(async()=>{root.render(null);});
  await act(async()=>{request.resolve({error:null});await tick();});assert.equal(document.body.textContent,'');
});

test('callback errors in query or hash return one fixed retry notice',()=>{
  const expected='That sign-in link could not be used. Request a new link and open it in this browser.';
  for(const suffix of ['?error=access_denied','#error=access_denied','?error_code=otp_expired','#error_code=otp_expired','?error=','#error_code=','?%65rror=access_denied']) {
    assert.equal(ownerCallbackError('https://mighty.example.test/'+suffix),expected);
  }
});
test('callback error descriptions and tokens are never echoed or interpreted as markup',()=>{
  const synthetic='synthetic-private-value';
  const url='https://mighty.example.test/?access_token='+synthetic+'#error=untrusted&error_description='+encodeURIComponent('<img src=x onerror=alert(1)> '+synthetic)+'&refresh_token='+synthetic;
  const notice=ownerCallbackError(url);
  assert.match(notice,/Request a new link/);
  assert.doesNotMatch(notice,/synthetic-private-value|img|onerror|untrusted|access_token|refresh_token/);
});
test('successful, ordinary, malformed, and description-only URLs do not signal failure',()=>{
  for(const url of ['https://mighty.example.test/','https://mighty.example.test/#access_token=synthetic&refresh_token=synthetic&type=magiclink','https://mighty.example.test/?code=synthetic','https://mighty.example.test/?error_description=irrelevant','https://mighty.example.test/#section','not a URL']) {
    assert.equal(ownerCallbackError(url),null);
  }
});

test('private password form labels credentials correctly and makes no request from typing',async()=>{
  await render();
  assert.match(text(),/Login ID or email/);
  assert.equal(document.querySelector('input[name=password]').type,'password');
  assert.equal(props(document.querySelector('input[name=password]')).autoComplete,'current-password');
  await editField('username','Jayati');await editField('password','synthetic-password');
  await render({busy:true});await render({busy:false});
  assert.equal(calls.length,0);
  assert.doesNotMatch(text(),/synthetic-password|accounts\.mighty\.invalid/);
});

test('password submission clears the field immediately, dispatches once and never sends mail',async()=>{
  const request=deferred();
  client.auth.signInWithPassword=value=>{calls.push(value);return request.promise;};
  client.auth.signInWithOtp=()=>{throw Error('Unexpected email');};
  await render();await editField('username',' JaYaTi ');await editField('password',' synthetic-password ');
  // Application code must not store credentials; normal SDK session handling is mocked here.
  window.localStorage=window.sessionStorage={setItem(){throw Error('Credential persistence is forbidden');}};
  await act(async()=>{const form=props(document.querySelector('form'));form.onSubmit({preventDefault(){}});form.onSubmit({preventDefault(){}});await tick();});
  assert.deepEqual(calls,[{email:'jayati@accounts.mighty.invalid',password:' synthetic-password '}]);
  assert.equal(document.querySelector('input[name=password]').value,'');
  assert.equal(button().disabled,true);
  await act(async()=>{request.resolve({error:null});await tick();});
  assert.match(text(),/Signed in\. Loading your account/);
  assert.doesNotMatch(text(),/Check .*sign-in link|synthetic-password/);
});

test('password failures are generic and leave no password or fake delivery notice',async()=>{
  client.auth.signInWithPassword=async()=>({error:{message:'Email not confirmed: private-detail'}});
  await render();await editField('username','jayati');await editField('password','synthetic-password');await submit();
  assert.match(text(),/Could not sign in\. Check your login ID or email and password/);
  assert.doesNotMatch(text(),/private-detail|Email not confirmed|Check jayati|synthetic-password/);
  assert.equal(document.querySelector('input[name=password]').value,'');
  assert.equal(button().disabled,false);
});

test('switching sign-in method clears password and preserves the email link path',async()=>{
  await render();await editField('username','jayati');await editField('password','synthetic-password');
  await renderLink();
  assert.equal(document.querySelector('input[name=password]'),null);
  await edit('owner@example.test');await submit();
  assert.deepEqual(calls,[{email:'owner@example.test',options:{shouldCreateUser:false,emailRedirectTo:'https://mighty.example.test/'}}]);
  await act(async()=>{props([...document.querySelectorAll('button')].find(item=>item.textContent==='Use a login ID or password')).onClick();});
  assert.equal(document.querySelector('input[name=password]').value,'');
  assert.equal(button().disabled,false,'Email resend throttle must not block password sign-in');
});

test('late password results cannot change a replacement account or restore the previous credential',async()=>{
  const request=deferred();client.auth.signInWithPassword=()=>request.promise;
  await render();await editField('username','jayati');await editField('password','synthetic-password');await submit();
  await render({uid:'another-account',email:'owner@example.test'});
  await act(async()=>{request.resolve({error:{message:'private-detail'}});await tick();});
  assert.match(text(),/owner@example.test/);assert.doesNotMatch(text(),/jayati|private-detail|Could not sign in|synthetic-password/);
  await render({uid:null});
  assert.equal(document.querySelector('input[name=password]').value,'');
  assert.equal(document.querySelector('input[name=username]').value,'');
});

test('connected private identities display a login ID and reserved addresses cannot request email',async()=>{
  await render({uid:'private-account',email:'jayati@accounts.mighty.invalid'});
  assert.match(text(),/Login ID: jayati/);assert.doesNotMatch(text(),/@accounts\.mighty\.invalid/);
  await renderLink({uid:null});await edit('jayati@accounts.mighty.invalid');await submit();
  assert.match(text(),/cannot receive email links/);assert.equal(calls.length,0);
});
