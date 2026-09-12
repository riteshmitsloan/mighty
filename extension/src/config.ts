import type{PublicConfig}from'./types.js';
declare const __PUBLIC_CONFIG__:PublicConfig;
export const config=__PUBLIC_CONFIG__;
export function configured(){return Boolean(config.supabaseUrl&&config.publishableKey);}
