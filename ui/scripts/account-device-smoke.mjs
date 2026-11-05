import assert from 'node:assert/strict';
import {createWorkbench} from './workbench-fixture.mjs';
let fixture;
const calls=[];
let cancelBiometric=false;
fixture=await createWorkbench({nativeRequest:async(body)=>{
 if(body.action!=='accountDevice')return null;
 const {operation,kind}=body;calls.push({operation,kind});
 if(operation==='status')return {supported:true,biometric_available:true};
 const a=fixture.state.account;a.devices ||= {};
 if(operation==='enable')a.devices[kind]='fixture-'+kind;
 if(operation==='disable')delete a.devices[kind];
 if(operation==='unlock'){
   if(kind==='biometric'&&cancelBiometric)throw Error('已取消指纹验证，可继续使用密码');
   if(kind==='automatic'&&a.require_authentication)throw Error('手动锁定');
   a.unlocked=true;a.require_authentication=false;
 }
 return {ok:true};
}});
const {page,state,browser,errors}=fixture;
const menu=()=>page.getByRole('button',{name:/^账户菜单，/});
try {
 Object.assign(state.account,{exists:false,unlocked:false,username:'',devices:{}});
 await page.reload();
 const defaultRemember=page.getByRole('checkbox',{name:/记住登录/});
 await defaultRemember.waitFor();assert.equal(await defaultRemember.isChecked(),true);
 await page.getByLabel('用户名',{exact:true}).fill('林间工作室');
 await page.getByLabel('设置密码',{exact:true}).fill('fixture-password');
 await page.getByLabel('确认密码',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'创建本地账户',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
 const automatic=page.getByRole('checkbox',{name:/记住登录/});
 const biometric=page.getByRole('checkbox',{name:/使用 Touch ID 解锁/});
 await page.waitForFunction(()=>document.querySelector('.account-device-settings input')?.checked);
 assert.equal(await automatic.isChecked(),true);
 await biometric.click();await page.getByRole('status').filter({hasText:'已开启'}).waitFor();
 assert.ok(state.account.devices.automatic&&state.account.devices.biometric);
 await page.screenshot({path:'.oil-ui/local-account/shots/device-settings.png'});
 // A genuine reopen keeps enrollment but starts with a locked server.
 state.account.unlocked=false;await page.reload();await menu().waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock'&&x.kind==='automatic').length,1);
 await menu().click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
 await automatic.click();await page.getByRole('status').filter({hasText:'已关闭'}).waitFor();
 await page.reload();await menu().click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
 assert.equal(await automatic.isChecked(),false,'explicit opt-out was overridden');
 await automatic.click();await page.getByRole('status').filter({hasText:'已开启'}).waitFor();
 await page.getByRole('button',{name:'返回工作台',exact:true}).click();
 await menu().click();await page.getByRole('menuitem',{name:/锁定 Cage/}).click();
 await page.getByRole('region',{name:'解锁 Cage',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'使用 Touch ID 解锁',exact:true}).waitFor();
 assert.equal(calls.filter(x=>x.operation==='unlock'&&x.kind==='automatic').length,1);
 cancelBiometric=true;await page.getByRole('button',{name:'使用 Touch ID 解锁',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'已取消指纹验证'}).waitFor();
 assert.equal(state.account.unlocked,false);
 await page.screenshot({path:'.oil-ui/local-account/shots/touch-id-fallback.png'});
 cancelBiometric=false;await page.getByRole('button',{name:'使用 Touch ID 解锁',exact:true}).click();await menu().waitFor();
 await menu().click();await page.getByRole('menuitem',{name:'退出账户',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'停止环境并退出账户',exact:true}).click();
 await page.getByRole('region',{name:'解锁 Cage',exact:true}).waitFor();await page.reload();
 await page.getByLabel('账户密码',{exact:true}).waitFor();assert.deepEqual(state.account.devices,{});
 assert.equal(await page.getByRole('button',{name:'使用 Touch ID 解锁',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: enrollment, automatic reopen, persistent manual lock, biometric cancellation/fallback, biometric unlock and logout revocation');
}finally{await browser.close();}
