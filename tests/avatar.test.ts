import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const checkout=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url));
const {buildSync}=require('esbuild'),{parseHTML}=require('linkedom'),React=require('react'),{createRoot}=require('react-dom/client');
const built=buildSync({stdin:{contents:'export {Avatar} from "./src/components/DesignPrimitives"; export {default as RelationshipViews} from "./src/components/RelationshipViews";',resolveDir:checkout,loader:'tsx'},
 bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*','react-dom/*'],loader:{'.css':'empty'},define:{'import.meta.env':'{}'}}).outputFiles[0].text;
const compiled={exports:{} as any};
new Function('require','module','exports',built)(require,compiled,compiled.exports);
const {Avatar,RelationshipViews}=compiled.exports;
const photo='https://media.licdn.com/dms/image/v2/SYNTHETIC_PHOTO/profile-displayphoto-shrink_100_100/0/1?e=1800000000&v=beta&t=synthetic_signature';
const props=(element:any)=>element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))!];
async function fixture(run:(root:any,document:Document)=>Promise<void>){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
 const previous={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(window.document.getElementById('root'));
 try{await run(root,window.document);}finally{await React.act(async()=>root.unmount());Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act});}
}

test('Avatar renders a validated photo without a referrer and falls back to initials on image failure',async()=>fixture(async(root,document)=>{
 await React.act(async()=>root.render(React.createElement(Avatar,{name:'Alex River',photoUrl:photo})));
 const image=document.querySelector('img')!;assert.equal(image.getAttribute('src'),photo);assert.equal(image.getAttribute('alt'),'');
 assert.equal([...image.attributes].find(attribute=>attribute.name.toLowerCase()==='referrerpolicy')?.value,'no-referrer');
 await React.act(async()=>props(image).onError());
 assert.equal(document.querySelector('img'),null);assert.equal(document.querySelector('.avatar')?.textContent,'AR');
}));

test('an old image error cannot hide a different person or a newly supplied photo',async()=>fixture(async(root,document)=>{
 await React.act(async()=>root.render(React.createElement(Avatar,{name:'Alex River',photoUrl:photo})));
 const failedImage=document.querySelector('img')!,oldError=props(failedImage).onError;
 await React.act(async()=>oldError());assert.equal(document.querySelector('img'),null);
 const next=photo.replace('SYNTHETIC_PHOTO','NEW_SYNTHETIC_PHOTO');
 await React.act(async()=>root.render(React.createElement(Avatar,{name:'Taylor Lake',photoUrl:next})));
 await React.act(async()=>oldError());
 assert.equal(document.querySelector('img')?.getAttribute('src'),next);
 await React.act(async()=>root.render(React.createElement(Avatar,{name:'Taylor Lake',photoUrl:'https://untrusted.example.org/portrait'})));
 assert.equal(document.querySelector('img'),null);assert.equal(document.querySelector('.avatar')?.textContent,'TL');
}));

test('saved relationship list and board render the same preserved person photo, with initials for unavailable photos',async()=>fixture(async(root,document)=>{
 const people=[{id:'a',person:'Alex River',profile_url:'https://www.linkedin.com/in/alex-river/',photoUrl:photo,context:{},stage:'saved',created_at:'2026-09-13T12:00:00Z'},
  {id:'b',person:'Taylor Lake',profile_url:null,context:{},stage:'saved',created_at:'2026-09-13T12:00:00Z'}];
 const options={people,events:[],strategy:'',busy:false,onView:()=>{},onOpen:()=>{},onAdd:()=>{},onExplore:()=>{},onStage:async()=>{}};
 for(const view of ['List','Board']){
  await React.act(async()=>root.render(React.createElement(RelationshipViews,{...options,view})));
  assert.equal(document.querySelectorAll('.avatar img').length,1);
  assert.equal(document.querySelector('.avatar img')?.getAttribute('src'),photo);
  assert.ok([...document.querySelectorAll('.avatar')].some(element=>element.textContent==='TL'));
 }
}));
