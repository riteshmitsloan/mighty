export function canonicalProfileURL(value:string,base='https://www.linkedin.com'):string|null{
 try{const u=new URL(value,base);if(u.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(u.hostname.toLowerCase())||u.port||u.username||u.password)return null;
 const m=u.pathname.match(/^\/in\/([^/]+)\/?$/);if(!m)return null;const slug=decodeURIComponent(m[1]).normalize('NFC').toLowerCase();if(!/^[\p{L}\p{N}_-]{1,200}$/u.test(slug))return null;
 return 'https://www.linkedin.com/in/'+encodeURIComponent(slug)+'/';}catch{return null;}
}
export function exactOrigin(value:string,expected:string):boolean{try{const u=new URL(value);return u.origin===new URL(expected).origin&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))&&!u.username&&!u.password;}catch{return false;}}
export function isSearchURL(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&['www.linkedin.com','linkedin.com'].includes(u.hostname)&&/^\/search\/results\/people\/?$/.test(u.pathname);}catch{return false;}}
