import { defineConfig } from '@playwright/test';

const port=4183;
// Nếu muốn Playwright chạy trên Microsoft Edge, đặt E2E_CHANNEL=msedge trước khi chạy.
const channel=process.env.E2E_CHANNEL;
export default defineConfig({
  testDir:'tests/browser', workers:1, globalSetup:'./tests/browser/setup.ts',
  use:{baseURL:'http://127.0.0.1:'+port,channel,viewport:{width:1440,height:900},trace:'retain-on-failure'},
});
