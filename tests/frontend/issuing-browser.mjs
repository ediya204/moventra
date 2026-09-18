// Opt-in browser acceptance against the isolated Go + Blnk harness.
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const unified=process.env.ISSUING_BROWSER_UNIFIED==='1';
const evidence=JSON.parse(readFileSync(process.env.ISSUING_BROWSER_OUTPUT,'utf8'));
const output=process.env.ISSUING_SCREENSHOT_DIR || '/tmp/moventra-issuing-browser-evidence';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const failures=[];page.on('pageerror',e=>failures.push(e.message));
try {
 await page.goto('http://127.0.0.1:8897/portal/cards/new');
 await page.getByRole('button',{name:'选择此 BIN',exact:true}).click();
 await page.getByRole('textbox',{name:'首充金额 · USD',exact:true}).fill('20');
 await page.getByRole('button',{name:'获取最新费用',exact:true}).click();
 const pay=page.getByRole('button',{name:'确认支付 USD 25.00 并开卡',exact:true});await pay.waitFor();assert.equal(await pay.isDisabled(),true);
 await page.getByRole('checkbox').nth(0).check();assert.equal(await pay.isDisabled(),true);
 await page.getByRole('checkbox').nth(1).check();assert.equal(await pay.isEnabled(),true);
 await page.screenshot({path:output+'/checkout-desktop.png',fullPage:true});
 await pay.click();await page.waitForURL('**/portal/card-orders/*');const orderURL=page.url(),id=orderURL.split('/').at(-1);
 await page.reload();await page.getByRole('heading',{name:'开卡成功',exact:true}).waitFor({timeout:90000});
 await page.screenshot({path:output+'/order-complete.png',fullPage:true});
 await page.getByRole('link',{name:'查看卡片',exact:true}).click();
 if(unified){
  await page.waitForURL('**/portal/cards/*?*');
  await page.getByRole('heading',{name:'资金情况',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'资金情况',exact:true}).waitFor();
  await page.getByText('975.00 USD',{exact:true}).waitFor();
  assert.equal(await page.getByText('资金响应不一致',{exact:true}).count(),0);
  await page.getByRole('tab',{name:'资金记录',exact:true}).click();
  await page.getByRole('link',{name:'查看开卡费、首充及退款记录',exact:true}).waitFor();
  await page.screenshot({path:output+'/unified-card-desktop.png',fullPage:true});
 }else{
  await page.getByText('内部卡分户余额 · USD 20.00',{exact:true}).waitFor();
  await page.reload();await page.getByText('内部卡分户余额 · USD 20.00',{exact:true}).waitFor();
 }
 const admin=await browser.newPage({viewport:{width:1440,height:1100}});admin.on('pageerror',e=>failures.push(e.message));
 await admin.goto(`http://127.0.0.1:8897/card-bins/customers?customer=${evidence.customerId}&order=${id}`);
 await admin.getByRole('heading',{name:'开卡成功',exact:true}).waitFor({timeout:15000});
 await admin.getByText('USD 可用余额：975.00',{exact:true}).waitFor();
 await admin.screenshot({path:output+'/admin-order.png',fullPage:true});
 const client=await page.request.get(evidence.api+`/client-api/v1/customers/${evidence.customerId}/card-issuing/orders/${id}`,{headers:{Authorization:'Bearer alice'}});
 const ops=await page.request.get(evidence.api+`/admin-api/v1/customers/${evidence.customerId}/card-issuing/orders/${id}`,{headers:{Authorization:'Bearer staff'}});
 assert.deepEqual((await client.json()).data,(await ops.json()).data);
 if(unified){
  const detail=await page.request.get(evidence.api+`/client-api/v1/customers/${evidence.customerId}/card-issuing/cards/${id}`,{headers:{Authorization:'Bearer alice'}});
  const d=(await detail.json()).data;assert.equal(d.balanceMinor,'2000');assert.ok(d.projection);
  const wallet=await page.request.get(evidence.api+`/client-api/v1/customers/${evidence.customerId}/card-issuing/wallet`,{headers:{Authorization:'Bearer alice'}});
  const w=(await wallet.json()).data;assert.equal(w.availableMinor,'97500');assert.equal(w.fundingSource,'funds_wallet');
 }

 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:8897/portal/cards/new');
 await page.getByRole('button',{name:'选择此 BIN',exact:true}).click();await page.getByRole('textbox',{name:'首充金额 · USD',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile overflow');
 await page.screenshot({path:output+'/checkout-mobile.png',fullPage:true});
 assert.deepEqual(failures,[]);
 const result={unifiedWallet:unified,orderId:id,status:'passed',checks:['both declarations','USD quote and amount','actual HTTP API',process.env.ISSUING_BROWSER_FAKE_BLNK==='1'?'stateful simulated Blnk':'real local Blnk','separate worker restart','order refresh','new card deep link','cross-surface equality','975 wallet / 20 card / 5 fee','390px mobile'],screenshots:output};
 writeFileSync(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
