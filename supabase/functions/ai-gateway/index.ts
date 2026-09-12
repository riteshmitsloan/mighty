import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createGateway} from './handler.ts';
Deno.serve(createGateway({env:key=>Deno.env.get(key),client:(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}));
