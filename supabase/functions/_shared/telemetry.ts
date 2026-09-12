export const VOCABULARY = {
 event_name:['strategy_saved','person_saved','capture_saved','assist_requested','draft_copied','import_completed','feature_opened'],
 approach:['manual','assist','archive','extension'],source:['web','pwa','extension','linkedin_archive','mailbox'],
 reason:['user_action','reminder','follow_up','goal_fit','not_enough_data'],
} as const;
// One rule rejects names, email addresses, URLs, and any value outside the vocabulary.
export function safeCategory(value:unknown,allowed:readonly string[]):value is string {
 return typeof value==='string'&&!(/(?=.*\s)(?=.*[A-Z])|@|:\//.test(value))&&allowed.includes(value);
}
export function sanitizeEvent(input:unknown):Record<string,string|number|boolean> {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid event.');
 const out:Record<string,string|number|boolean>={};
 for(const [key,value] of Object.entries(input)){
  if(key in VOCABULARY){if(!safeCategory(value,VOCABULARY[key as keyof typeof VOCABULARY]))throw Error('Event contains a value outside the closed vocabulary.');out[key]=value;}
  else if(key==='count'&&Number.isInteger(value)&&Number(value)>=0&&Number(value)<=10000)out[key]=Number(value);
  else if(key==='success'&&typeof value==='boolean')out[key]=value;
  else throw Error('Event contains an unsupported field or value.');
 }
 if(!out.event_name)throw Error('An event name is required.');return out;
}
