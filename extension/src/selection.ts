import type{SearchResult}from'./types.js';
export const MAX_SELECTED=5;
export function initialSelection(results:SearchResult[]):Set<string>{return new Set(results.slice(0,MAX_SELECTED).map(x=>x.profileUrl));}
export function toggleSelection(current:ReadonlySet<string>,url:string,checked:boolean):{selected:Set<string>;message:string}{
 const selected=new Set(current);if(!checked){selected.delete(url);return{selected,message:''};}if(selected.has(url))return{selected,message:''};if(selected.size>=MAX_SELECTED)return{selected,message:'You can select up to five people. Uncheck someone first.'};selected.add(url);return{selected,message:''};
}
