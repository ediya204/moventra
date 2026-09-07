import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {merchantBrand,companyLogoUrl} from '../../packages/shared/src/components/merchantBrand.ts';

test('descriptor matching has token boundaries and sends only canonical brands',()=>{
 assert.equal(merchantBrand('FACEBK *PRIVATE-ORDER-123'),'Facebook');
 assert.equal(merchantBrand('Google *ADS123'),'Google');
 assert.equal(merchantBrand('FACEBOOKAD* ORDER123'),'Facebook');
 assert.equal(merchantBrand('Jina AI'),'Jina AI');
 assert.equal(merchantBrand('META ADS'),'Meta');
 for(const name of ['Googleton','REFUND FROM UNKNOWN','Unknown Store *123',null,''])assert.equal(merchantBrand(name),undefined);
 const url=new URL(companyLogoUrl(merchantBrand('FACEBK *PRIVATE-ORDER-123'),'pk_test'));
 assert.equal(url.pathname,'/name/Facebook');assert.equal(url.searchParams.get('fallback'),'404');assert.ok(!url.href.includes('PRIVATE'));
 assert.equal(companyLogoUrl('Acme','sk_test'),undefined);
 assert.equal(new URL(companyLogoUrl('A/B & C','pk_test')).pathname,'/name/A%2FB%20%26%20C');
});
const require=createRequire(import.meta.url),uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const reactURL=pathToFileURL(require.resolve('react')).href;
const mock=uri(`import React from ${JSON.stringify(reactURL)};export const Box=({component='div',children,sx,alignItems,direction,gap,variant,noWrap,...props})=>React.createElement(component,props,children),Stack=Box,Typography=Box,Link=Box,Icon=()=>React.createElement('span',{'data-fallback':true});`);
let {outputText}=ts.transpileModule(readFileSync(new URL('../../packages/shared/src/components/MerchantLogo.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replace('import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY','undefined').replace(/from ["']([^"']+)["']/g,(_,name)=>`from ${JSON.stringify(name.startsWith('react')?pathToFileURL(require.resolve(name)).href:name==='./merchantBrand'?new URL('../../packages/shared/src/components/merchantBrand.ts',import.meta.url).href:mock)}`);
const {MerchantLogo,MerchantCell}=await import(uri(outputText));
test('known brands render images; unknown descriptors stay local',()=>{
 const known=renderToStaticMarkup(React.createElement(MerchantLogo,{name:'Google'}));
 assert.match(known,/name\/Google/);assert.match(known,/referrerPolicy="no-referrer"/i);
 const unknown=renderToStaticMarkup(React.createElement(MerchantLogo,{name:'Unknown *123'}));
 assert.doesNotMatch(unknown,/<img|img.logo.dev/);
});
test('merchant cell preserves raw source description',()=>{
 const html=renderToStaticMarkup(React.createElement(MerchantCell,{name:'FACEBK *PRIVATE-123'}));
 assert.match(html,/FACEBK \*PRIVATE-123/);
 assert.match(html,/name\/Facebook/);
});

// A failed image must not leave a broken glyph or suppress a different row's brand.
test('image failure falls back locally and a changed merchant can load again',()=>{
 let tree;
 act(()=>{tree=TestRenderer.create(React.createElement(MerchantLogo,{name:'Facebook'}));});
 act(()=>{tree.root.findByType('img').props.onError();});
 assert.equal(tree.root.findAllByType('img').length,0);
 assert.equal(tree.root.findAll(node=>node.type==='span'&&node.props['aria-label']==='Facebook 图标暂不可用').length,1);
 act(()=>{tree.update(React.createElement(MerchantLogo,{name:'Google'}));});
 assert.match(tree.root.findByType('img').props.src,/name\/Google/);
 act(()=>tree.unmount());
});

test('Meta payment aliases and common descriptor separators resolve without broad substring matching',()=>{
 for(const description of ['METAPAY*1O4N','MetaPay * DEMO','META PAY*123','META ADS','META*TEST','Meta Platforms','ＭＥＴＡＰＡＹ＊１２３']) {
  assert.equal(merchantBrand(description),'Meta',description);
  assert.equal(new URL(companyLogoUrl(merchantBrand(description),'pk_test')).pathname,'/meta.com');
 }
 for(const description of ['GOOGLE/ADS','GOOGLE_ADS','FACEBOOKAD:TEST'])assert.ok(merchantBrand(description));
 for(const description of ['METAPHOR','METAPAYMENT','METAFOOD','METAL SHOP','Store METAPAY*123','GOOGLETON'])assert.equal(merchantBrand(description),undefined,description);
 const html=renderToStaticMarkup(React.createElement(MerchantCell,{name:'METAPAY*PRIVATE-123'}));
 assert.match(html,/METAPAY\*PRIVATE-123/);assert.match(html,/meta\.com/);assert.doesNotMatch(html,/name\/METAPAY/);
 const unknown=renderToStaticMarkup(React.createElement(MerchantLogo,{name:'Local Unknown'}));
 assert.match(unknown,/<svg/);assert.doesNotMatch(unknown,/https:|<img/);
});
