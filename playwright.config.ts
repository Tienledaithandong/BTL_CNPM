import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const port=4183;
export default defineConfig({
  testDir:'tests/browser', workers:1,
  use:{baseURL:'http://127.0.0.1:'+port,channel:'msedge',viewport:{width:1440,height:900},trace:'retain-on-failure'},
  webServer:{
    command:'npm run start',url:'http://127.0.0.1:'+port+'/api/health',
    env:{HUB_PORT:String(port),HUB_DATA_DIR:join('data','test-e2e-'+randomUUID())},timeout:30_000,
  },
});
