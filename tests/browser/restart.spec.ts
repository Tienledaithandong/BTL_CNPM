import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/api/app.js';
import { launch } from './server.js';

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

test('Q05: Operator reconciles a pending command explicitly after loading the backup', async ({page}) => {
  const directory=await mkdtemp(join(tmpdir(),'mobility-recovery-e2e-'));
  let server:Awaited<ReturnType<typeof launch>>|undefined;
  try {
    const {app,store}=await createApp({directory,background:false});
    try {
      const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{userId:'STUDENT_A',password:'demo'}});
      const headers={cookie:String(login.headers['set-cookie']).split(';')[0]};
      const reservation=(await app.inject({method:'POST',url:'/api/reservations',headers,payload:{vehicleId:'EV-02',destinationHubId:'H_KTX'}})).json().data;
      const pickup=await app.inject({method:'POST',url:`/api/reservations/${reservation.id}/pickup`,headers,payload:{token:reservation.token,version:reservation.version}});
      expect(pickup.statusCode).toBe(200);
      await store.system(tx=>tx.log('TEST_CHECKPOINT','snapshot','Rotate backup'));
    } finally { await app.close(); }
    await writeFile(join(directory,'snapshot.json'),'fixture corrupt snapshot');
    server=await launch(directory);
    await page.goto(server.address);
    await page.getByRole('button',{name:/Điều phối viên/}).click();
    await page.getByRole('button',{name:'Vào hệ thống'}).click();
    await page.getByRole('navigation').getByRole('button',{name:'Điều khiển demo',exact:true}).click();
    await expect(page.getByRole('paragraph').filter({hasText:/Đã nạp bản dự phòng \(phiên bản/})).toBeVisible();
    await expect(page.getByRole('button',{name:'Hoàn tất phục hồi'})).toBeDisabled();
    const pending=page.getByRole('table',{name:'Lệnh đợi thiết bị'}).getByRole('row').filter({hasText:'EV-02'});
    await expect(pending.getByRole('button',{name:'Xác nhận đã thực hiện'})).toBeDisabled();
    await mkdir('test-results/evidence',{recursive:true});
    await page.screenshot({path:'test-results/evidence/15-recovery-pending-command.png',fullPage:true});
    await pending.getByRole('checkbox',{name:'Đã kiểm tra thiết bị cho lệnh này'}).check();
    await pending.getByRole('button',{name:'Xác nhận đã thực hiện'}).click();
    await expect(pending).toHaveCount(0);
    await page.getByRole('checkbox',{name:/Tôi đã đối soát/}).check();
    await page.getByRole('button',{name:'Hoàn tất phục hồi'}).click();
    await expect(page.getByRole('heading',{name:'Phục hồi dữ liệu'})).toHaveCount(0);
    expect((await page.request.get(server.address+'/api/ready')).ok()).toBeTruthy();
  } finally {
    await server?.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
