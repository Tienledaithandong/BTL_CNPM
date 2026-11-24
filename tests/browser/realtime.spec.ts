import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

test('Q02: committed telemetry is displayed by the Student browser', async ({page,browser,baseURL}) => {
  const context=await browser.newContext({baseURL});
  try {
    const signedIn=await context.request.post('/api/auth/login',{data:{userId:'OPERATOR_A',password:'demo'}});
    expect(signedIn.ok()).toBeTruthy();
    const seed=await context.request.post('/api/operator/demo/events',{data:{kind:'reset',confirm:true}});
    expect(seed.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByRole('button',{name:/Sinh viên A/}).click();
    await page.getByRole('button',{name:'Vào hệ thống'}).click();
    await expect(page.getByText('Đang kết nối',{exact:true})).toBeVisible();
    const row=page.getByRole('table',{name:'Các xe ở hub'}).getByRole('row').filter({hasText:'EV-02'});
    await expect(row).toContainText('65%');
    const samplesMs:number[]=[];
    for (const batteryPercent of [71,72,73,74,75]) {
      const timestamp=performance.now();
      const response=await context.request.post('/api/operator/demo/events',{data:{kind:'battery',vehicleId:'EV-02',batteryPercent}});
      expect(response.ok()).toBeTruthy();
      await expect(row).toContainText(batteryPercent+'%',{timeout:2000});
      samplesMs.push(Math.round((performance.now()-timestamp)*10)/10);
    }
    expect(Math.max(...samplesMs)).toBeLessThanOrEqual(2000);
    await mkdir('test-results/evidence',{recursive:true});
    await writeFile('test-results/evidence/realtime.json',JSON.stringify({
      samplesMs,maxMs:Math.max(...samplesMs),metric:'HTTP request start to displayed text (conservative upper bound of commit to render)',
    },null,2)+'\n','utf8');
  } finally {await context.close();}
});

test('Q07: a disconnected Student browser catches up over WebSocket',async ({page,browser,baseURL})=>{
  const operator=await browser.newContext({baseURL});
  let allowConnection=true;
  let closeSocket: (() => void) | undefined;
  try {
    await page.routeWebSocket('**/ws',route=>{
      if (!allowConnection) { void route.close(); return; }
      route.connectToServer();
      closeSocket=()=>{void route.close();};
    });
    const login=await operator.request.post('/api/auth/login',{data:{userId:'OPERATOR_A',password:'demo'}});
    expect(login.ok()).toBeTruthy();
    const reset=await operator.request.post('/api/operator/demo/events',{data:{kind:'reset',confirm:true}});
    expect(reset.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByRole('button',{name:/Sinh viên A/}).click();
    await page.getByRole('button',{name:'Vào hệ thống'}).click();
    await expect(page.getByText('Đang kết nối',{exact:true})).toBeVisible();
    const row=page.getByRole('table',{name:'Các xe ở hub'}).getByRole('row').filter({hasText:'EV-02'});
    await expect(row).toContainText('65%');
    allowConnection=false;
    closeSocket!();
    await expect(page.getByText('Đang đồng bộ lại',{exact:true})).toBeVisible();
    const changed=await operator.request.post('/api/operator/demo/events',{data:{kind:'battery',vehicleId:'EV-02',batteryPercent:12}});
    expect(changed.ok()).toBeTruthy();
    await expect(row).toContainText('65%');
    allowConnection=true;
    await expect(page.getByText('Đang kết nối',{exact:true})).toBeVisible();
    await expect(row).toContainText('12%');
    await expect(row).toContainText('Xe cần sạc trước khi đặt.');
  } finally { await operator.close(); }
});
