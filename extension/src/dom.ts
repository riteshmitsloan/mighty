const excluded='script,style,noscript,template,nav,footer,aside,.visually-hidden,.sr-only,.screen-reader-text';
export function rendered(element:Element|null):boolean{
 if(!element)return false;for(let p:Element|null=element;p;p=p.parentElement){if(p.matches(excluded)||p.hasAttribute('hidden'))return false;const inline=(p.getAttribute('style')||'').replace(/\s/g,'').toLowerCase();if(/(?:^|;)(display:none|visibility:hidden|visibility:collapse)(?:;|$|!important)/.test(inline))return false;const view=p.ownerDocument.defaultView;if(view&&typeof view.getComputedStyle==='function'){const s=view.getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false;}}return true;
}
export function textOf(element:Element|null,max=1000):string{
 if(!element||!rendered(element))return '';const walker=element.ownerDocument.createTreeWalker(element,4);let text='';let node:Node|null;while((node=walker.nextNode())&&text.length<max*2){if(rendered(node.parentElement))text+=' '+(node.nodeValue||'');}return text.replace(/\s+/g,' ').trim().slice(0,max);
}
export function firstRendered(root:ParentNode,selectors:string):Element|null{return Array.from(root.querySelectorAll(selectors)).find(rendered)||null;}
