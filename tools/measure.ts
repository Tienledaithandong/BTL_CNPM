import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, totalmem, platform, release, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createApp } from '../src/api/app.js';

const directory=await mkdtemp(join(tmpdir(),'mobility-measure-'));
const {app}=await createApp({directory,background:true});
try {
  const address=await app.listen({host:'127.0.0.1',port:0});
  const login=await fetch(address+'/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'OPERATOR_A',password:'demo'}),
  });
  if (!login.ok) throw new Error('Demo login failed');
  const cookie=login.headers.getSetCookie()[0].split(';')[0];
  const headers={Cookie:cookie};
  const mutate=await fetch(address+'/api/operator/scenarios',{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({
      name:'Đo 3 Hub trong 6 giờ', hubIds:['H_METRO','H_KTX','H_BK'], durationMinutes:360,
      tripDemandPct:10, chargingDemandPct:10, blockedSlots:1, disabledPortsPct:0, concentrationPct:0, seed:24,
    }),
  });
  const scenario=await mutate.json();
  if (!mutate.ok) throw new Error(JSON.stringify(scenario));
  const routes=['/api/hubs','/api/vehicles','/api/operator/overview','/api/operator/alerts'];
  for (const path of routes) {
    const response=await fetch(address+path,{headers});await response.text();
    if (!response.ok) throw new Error(path+' HTTP '+response.status);
  }
  const durations:number[]=[];
  for (let i=0;i<120;i++) {
    const started=performance.now();
    const response=await fetch(address+routes[i%routes.length],{headers});
    await response.text();
    if (!response.ok) throw new Error('Read failed '+response.status);
    durations.push(performance.now()-started);
  }
  durations.sort((a,b)=>a-b);
  const runTime=performance.now();
  const queued=await fetch(address+'/api/operator/scenarios/'+scenario.data.id+'/runs',{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({}),
  });
  if (!queued.ok) throw new Error(await queued.text());
  const runId=(await queued.json()).data.id;
  let result;
  for (let i=0;i<90;++i) {
    const response=await fetch(address+'/api/operator/runs/'+runId,{headers});
    if (!response.ok) throw new Error(await response.text());
    result=(await response.json()).data;
    if (result.status!=='Running') break;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  if (result?.status!=='Completed') throw new Error(JSON.stringify(result));
  const round=(n:number)=>Math.round(n*10)/10;
  const output={
    node:process.version,os:platform()+' '+release(),cpu:cpus()[0].model,memoryGiB:round(totalmem()/2**30),
    Q03:{sample:120,pattern:'sequential HTTP reads after one warmup per route',routes,p95Ms:round(durations[Math.ceil(durations.length*0.95)-1]),maxMs:round(durations.at(-1)!)},
    Q04:{hubCount:3,horizonMinutes:360,elapsedMs:round(performance.now()-runTime),pattern:'HTTP enqueue to first Completed status observed'},
  };
  await mkdir('deliverables',{recursive:true});
  await writeFile('deliverables/measurements.json',JSON.stringify(output,null,2)+'\n','utf8');
  console.log(JSON.stringify(output,null,2));
} finally {
  await app.close();
  await rm(directory,{recursive:true,force:true});
}
