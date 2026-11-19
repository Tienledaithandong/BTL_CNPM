import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function launch(directory: string) {
  const child=spawn(process.execPath,['dist/api/server.js'],{
    env:{...process.env,HUB_PORT:'0',HUB_DATA_DIR:directory,HUB_ENABLE_DEMO:'1'},
    windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  const stop=async () => {
    if (child.exitCode!==null || child.signalCode!==null || !child.pid) return;
    const exited=once(child,'exit');
    child.kill();
    await exited;
  };
  try {
    const address=await new Promise<string>((resolve,reject)=>{
      let logs='';
      const timer=setTimeout(()=>reject(new Error('Server did not start: '+logs)),10_000);
      const handle=(data:Buffer)=>{
        logs=(logs+data.toString()).slice(-8000);
        const match=/Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(logs);
        if(match) { clearTimeout(timer); resolve(match[1]); }
      };
      child.stdout.on('data',handle);
      child.stderr.on('data',handle);
      child.once('error',(error)=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code)=>{clearTimeout(timer);reject(new Error('Process exited '+code+': '+logs));});
    });
    return {address,stop};
  } catch(error) {
    await stop();
    throw error;
  }
}

async function post(request:APIRequestContext,address:string,route:string,data:object) {
  const result=await request.post(address+'/api'+route,{data});
  expect(result.ok(),await result.text()).toBeTruthy();
  return (await result.json()).data;
}

test('E2E-6: a completed simulated trip and invoice survive an actual server restart', async ({browser}) => {
  const directory=await mkdtemp(join(tmpdir(),'mobility-restart-e2e-'));
  const active=await browser.newContext();
  let server:Awaited<ReturnType<typeof launch>>|undefined;
  try {
    server=await launch(directory);
    const request=active.request;
    const base=server.address;
    await post(request,base,'/auth/login',{userId:'STUDENT_A',password:'demo'});
    const reserved=await post(request,base,'/reservations',{vehicleId:'EV-02',destinationHubId:'H_KTX'});
    await post(request,base,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,expectedVersion:reserved.version});
    let trip:{id:string;version:number}|undefined;
    await expect.poll(async () => {
      const r=await request.get(base+'/api/me/trips');
      [trip]=(await r.json()).data;
      return Boolean(trip);
    }).toBe(true);
    const ended=await post(request,base,'/trips/'+trip!.id+'/return',{hubId:'H_KTX',expectedVersion:trip!.version});
    expect(ended.invoice.amountVnd).toBeGreaterThan(0);
    const invoiceId=ended.invoice.id;
    await server.stop();
    server=await launch(directory);
    const page=await active.newPage();
    await page.goto(server.address);
    await page.getByRole('button',{name:/Sinh viên A/}).click();
    await page.getByRole('button',{name:'Vào hệ thống'}).click();
    await expect(page.getByText('Đang kết nối',{exact:true})).toBeVisible();
    const after=await request.get(server.address+'/api/me/invoices');
    const invoices=(await after.json()).data;
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(invoiceId);
    expect(invoices[0].amountVnd).toBe(ended.invoice.amountVnd);
    await page.getByRole('navigation').getByRole('button',{name:'Chuyến đi',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Hóa đơn gần nhất'})).toBeVisible();
    await mkdir('test-results/evidence',{recursive:true});
    await page.screenshot({path:'test-results/evidence/14-restart-invoice.png',fullPage:true,animations:'disabled'});
  } finally {
    await active.close();
    await server?.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
