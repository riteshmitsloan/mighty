import type {SupabaseClient} from '@supabase/supabase-js';
type Row=Record<string,any>;
type Result={data:any;error:{message:string;code?:string}|null};
export class MemoryServer{
 tables:Record<string,Row[]>={};actor='A';pageCap=1000;calls:Array<{table:string;mode:string;filters:Record<string,unknown>;inValues?:unknown[]}>=[];rpcCalls:string[]=[];activeRPC=0;maxActiveRPC=0;insertAttempts=0;failReadTable='';
 constructor(tables:Record<string,Row[]>={}){this.tables=structuredClone(tables);}
 client={from:(table:string)=>new Query(this,table),rpc:async(name:string,args:Record<string,unknown>):Promise<Result>=>{
  if(name!=='consume_inbox')throw Error('Unknown test RPC');const id=String(args.p_id);this.rpcCalls.push(id);this.activeRPC++;this.maxActiveRPC=Math.max(this.maxActiveRPC,this.activeRPC);
  try{await new Promise(resolve=>setTimeout(resolve,1));const item=this.tables.outreach_inbox.find(row=>row.id===id&&row.user_id===this.actor);if(!item)return {data:null,error:{code:'42501',message:'Account refused'}};if(item.fail)return {data:null,error:{code:'P0001',message:'Pending fixture failure'}};item.consumed_at='2026-09-12T12:00:00Z';item.relationship_id ||= 'saved-'+id;return {data:item.relationship_id,error:null};}finally{this.activeRPC--;}
 }} as unknown as SupabaseClient;
}
class Query implements PromiseLike<Result>{
 columns='*';filters:Record<string,unknown>={};gtFilters:Record<string,string>={};inValues?:unknown[];inField='';orders:Array<{key:string;ascending:boolean}>=[];count=1000;mode='read';value:Row={};one=false;result?:Promise<Result>;
 constructor(private server:MemoryServer,private table:string){}
 select(columns='*'){this.columns=columns;return this;}
 eq(field:string,value:unknown){this.filters[field]=value;return this;}
 is(field:string,value:unknown){this.filters[field]=value;return this;}
 gt(field:string,value:string){this.gtFilters[field]=value;return this;}
 in(field:string,values:unknown[]){this.inField=field;this.inValues=values;return this;}
 order(key:string,options:{ascending?:boolean}={}){this.orders.push({key,ascending:options.ascending!==false});return this;}
 limit(count:number){this.count=count;return this;}
 maybeSingle(){this.one=true;return this;}
 single(){this.one=true;return this;}
 insert(value:Row){this.mode='insert';this.value=value;return this;}
 update(value:Row){this.mode='update';this.value=value;return this;}
 then<T=Result,U=never>(resolve?:((value:Result)=>T|PromiseLike<T>)|null,reject?:((reason:unknown)=>U|PromiseLike<U>)|null):PromiseLike<T|U>{this.result ||= this.execute();return this.result.then(resolve,reject);}
 private project(row:Row):Row{
  if(this.columns==='*')return structuredClone(row);const output:Row={};
  for(const column of this.columns.split(',')){const[alias,path]=column.includes(':')?column.split(':'):[column,column];const keys=path.split('->');let value:any=row;for(const key of keys)value=value?.[key];output[alias]=value;}
  return structuredClone(output);
 }
 private async execute():Promise<Result>{
  const s=this.server;s.calls.push({table:this.table,mode:this.mode,filters:{...this.filters,...this.gtFilters},inValues:this.inValues});
  if(this.mode==='read'&&s.failReadTable===this.table)return {data:null,error:{code:'500',message:'Fixture read failure'}};
  const table=s.tables[this.table] ||= [];
  if(this.mode==='insert'){
   s.insertAttempts++;if(this.value.user_id!==s.actor)return {data:null,error:{code:'42501',message:'Wrong account'}};
   if(this.table==='outreach_log'&&this.value.profile_url&&table.some(row=>row.user_id===this.value.user_id&&row.profile_url===this.value.profile_url))return {data:null,error:{code:'23505',message:'Unique profile conflict'}};
   const row={id:crypto.randomUUID(),created_at:'2026-09-12T12:00:00Z',...structuredClone(this.value)};table.push(row);return {data:this.project(row),error:null};
  }
  let rows=table.filter(row=>row.user_id===undefined||row.user_id===s.actor).filter(row=>Object.entries(this.filters).every(([key,value])=>row[key]===value)).filter(row=>Object.entries(this.gtFilters).every(([key,value])=>row[key]>value));
  if(this.inValues)rows=rows.filter(row=>this.inValues!.includes(row[this.inField]));
  rows.sort((a,b)=>{for(const order of this.orders){if(a[order.key]!==b[order.key])return (a[order.key]<b[order.key]?-1:1)*(order.ascending?1:-1);}return 0;});
  if(this.mode==='update')for(const row of rows)Object.assign(row,structuredClone(this.value));
  const page=rows.slice(0,Math.min(this.count,s.pageCap)).map(row=>this.project(row));
  return {data:this.one?page[0]??null:page,error:null};
 }
}
export const id=(n:number)=>String(n).padStart(8,'0');
