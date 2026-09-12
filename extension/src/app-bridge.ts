// App-side helper. Never inject this into LinkedIn or share a refresh token.
export function connectExtension(extensionId:string,accessToken:string):Promise<unknown>{return chrome.runtime.sendMessage(extensionId,{type:'mighty:connect',protocol:1,accessToken});}
export function disconnectExtension(extensionId:string):Promise<unknown>{return chrome.runtime.sendMessage(extensionId,{type:'mighty:disconnect',protocol:1});}
type BridgeOptions={extensionId:string;getAccessToken:()=>Promise<string|null>;onStatus?:(status:unknown)=>void};
export function startExtensionBridge(options:BridgeOptions){
 let stopped=false,port:chrome.runtime.Port|undefined,timer:ReturnType<typeof setTimeout>|undefined,attempt=0,syncGeneration=0;
 async function sync(){const generation=++syncGeneration;try{const token=await options.getAccessToken();if(stopped||generation!==syncGeneration)return;
 const reply=token?await connectExtension(options.extensionId,token):await disconnectExtension(options.extensionId);if(!stopped&&generation===syncGeneration)options.onStatus?.(reply);
 }catch{if(!stopped)options.onStatus?.({ok:false,connected:false,message:'Extension connection is unavailable. Check that the unpacked extension is enabled.'});}}
 function open(){if(stopped)return;try{
 port=chrome.runtime.connect(options.extensionId,{name:'mighty:bridge'});
 port.onMessage.addListener(message=>{if(message?.type==='mighty:ready'&&message.protocol===1){attempt=0;void sync();}});
 port.onDisconnect.addListener(()=>{port=undefined;void chrome.runtime.lastError;if(stopped)return;attempt++;if(attempt>8){options.onStatus?.({ok:false,connected:false,message:'Enable the extension, then focus the app to reconnect.'});return;}clearTimeout(timer);timer=setTimeout(open,Math.min(1000,attempt===1?0:100*2**(attempt-2)));});
 }catch{options.onStatus?.({ok:false,connected:false,message:'This browser cannot connect to the extension.'});}}
 const focus=()=>{if(stopped)return;attempt=0;if(!port)open();void sync();};
 addEventListener('focus',focus);open();
 return{sync,dispose(){stopped=true;syncGeneration++;clearTimeout(timer);port?.disconnect();removeEventListener('focus',focus);}};
}
// Call bridge.sync() on Supabase TOKEN_REFRESHED, SIGNED_IN and SIGNED_OUT.
// The getAccessToken callback must read the current app session each time.
