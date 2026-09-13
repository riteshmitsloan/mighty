export const DEFAULT_APP_URLS='https://riteshmitsloan.github.io/mighty/,http://127.0.0.1:5173,http://localhost:5173';

export function configuredAppURLs(value=DEFAULT_APP_URLS){
 return [...new Set(value.split(',').map(entry=>{
  const u=new URL(entry.trim());
  if(u.username||u.password||u.search||u.hash||u.hostname.includes('*')||/[\s*%]/.test(u.pathname)||
   (u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))){
   throw Error('Use HTTPS app base URLs or explicit loopback development URLs, without credentials, queries or wildcards.');
  }
  const path=u.pathname.endsWith('/')?u.pathname:u.pathname+'/';
  if(u.hostname==='riteshmitsloan.github.io'&&(u.port||path!=='/mighty/'))throw Error('Hosted Mighty must use https://riteshmitsloan.github.io/mighty/.');
  return u.origin+path;
 }))];
}

export function appConnectionPatterns(appURLs){
 // Runtime validation additionally checks the exact configured port and sender origin.
 return [...new Set(appURLs.map(value=>{const u=new URL(value);return u.protocol+'//'+u.hostname+u.pathname+'*';}))];
}
