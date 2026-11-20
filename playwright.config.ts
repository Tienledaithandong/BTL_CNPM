import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const port=4183;
// Nếu muốn Playwright chạy trên Microsoft Edge, đặt E2E_CHANNEL=msedge trước khi chạy.
const channel=process.env.E2E_CHANNEL;
export default defineConfig({
  testDir:'tests/browser', workers:1,
  use:{baseURL:'http://127.0.0.1:'+port,channel,viewport:{width:1440,height:900},trace:'retain-on-failure'},
  webServer:{
    command:'npm run start',url:'http://127.0.0.1:'+port+'/api/health',
    env:{HUB_PORT:String(port),HUB_DATA_DIR:join('data','test-e2e-'+randomUUID())},timeout:30_000,
  },
});
