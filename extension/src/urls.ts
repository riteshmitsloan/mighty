export function canonicalProfileURL(value:string,base='https://www.linkedin.com'):string|null{
 try{const u=new URL(value,base);if(u.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(u.hostname.toLowerCase())||u.port||u.username||u.password)return null;
 const m=u.pathname.match(/^\/in\/([^/]+)\/?$/);if(!m)return null;const slug=decodeURIComponent(m[1]).normalize('NFC').toLowerCase();if(!/^[\p{L}\p{N}_-]{1,200}$/u.test(slug))return null;
 return 'https://www.linkedin.com/in/'+encodeURIComponent(slug)+'/';}catch{return null;}
}
export function exactOrigin(value:string,expected:string):boolean{try{const u=new URL(value);return u.origin===new URL(expected).origin&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))&&!u.username&&!u.password;}catch{return false;}}
/** A configured app may occupy one directory on a shared hosting origin. */
export function exactAppURL(value:string,expected:string):boolean{
 try{
  const u=new URL(value),app=new URL(expected);
  if(!exactOrigin(value,expected)||app.username||app.password||app.search||app.hash)return false;
  const base=app.pathname.endsWith('/')?app.pathname:app.pathname+'/';
  // Do not accept encoded path separators whose server interpretation may differ.
  return !/%(?:2f|5c)/i.test(u.pathname)&&u.pathname.startsWith(base);
 }catch{return false;}
}
export function isSearchURL(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&['www.linkedin.com','linkedin.com'].includes(u.hostname)&&/^\/search\/results\/people\/?$/.test(u.pathname);}catch{return false;}}
