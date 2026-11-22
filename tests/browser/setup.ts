import type { FullConfig } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './server.js';

export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  if (!baseURL) throw new Error('The Playwright project must specify its test server URL.');
  const directory = await mkdtemp(join(tmpdir(),'mobility-playwright-'));
  try {
    const server = await launch(directory,Number(new URL(baseURL).port));
    return async () => {
      try { await server.stop(); }
      finally { await rm(directory,{recursive:true,force:true}); }
    };
  } catch (error) {
    await rm(directory,{recursive:true,force:true});
    throw error;
  }
}
