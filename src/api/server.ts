import { resolve } from 'node:path';
import { createApp } from './app.js';

const {app}=await createApp({
  directory:resolve(process.env.HUB_DATA_DIR ?? 'data/runtime'),
  demo:process.env.HUB_ENABLE_DEMO!=='0',
  logger:true,
});
const port=Number(process.env.HUB_PORT ?? 4173);
await app.listen({port,host:'127.0.0.1'});
for (const signal of ['SIGINT','SIGTERM'] as const)
  process.once(signal,()=>{ void app.close().catch((err)=>{app.log.error(err);process.exitCode=1;}); });
