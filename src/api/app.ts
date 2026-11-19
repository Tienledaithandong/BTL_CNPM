import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import files from '@fastify/static';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { registerM1, expireReservations, applyUnlockAck } from './m1.js';
import { registerM2, m2Tick, applyChargingAck, simulatePhysicalEvent } from './m2.js';
import { registerM3, computeSimulation } from './m3.js';
import { Store, type SaveStage } from './store.js';
import { createSeed } from './seed.js';
import { DomainError, entity, fail, number, refreshAvailability, requiredString,
  type Actor, type AddRoute, type Command, type Input, type Tx } from './types.js';

const permittedAccounts: Actor[] = [
  { id:'STUDENT_A',role:'STUDENT' }, { id:'STUDENT_B',role:'STUDENT' }, { id:'OPERATOR_A',role:'OPERATOR' },
];

type AppOptions = {
  directory: string; clock?: () => number; background?: boolean;
  demo?: boolean; logger?: boolean; slotsPerHub?: number; fault?: (stage: SaveStage) => void;
};

function object(value: unknown): Input {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Input : {};
}

function safeEquals(a: string,b: string): boolean {
  const aa=Buffer.from(a), bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

function applyAck(tx: Tx, command: Command, success: boolean) {
  if (command.dispatchedAt===null) fail(409,'DEVICE_PENDING','Lệnh chưa được gửi đến thiết bị.');
  if (command.type==='UNLOCK') applyUnlockAck(tx,command,success);
  else applyChargingAck(tx,command,success);
}

function demoEvent(tx: Tx,i: Input, slots?: number): unknown {
  const kind=requiredString(i,'kind');
  if (kind==='reset') {
    const state=createSeed(tx.now,slots);
    const version=tx.state.version;
    Object.assign(tx.state,state,{version});
    tx.log('RESET','seed','Đã khởi tạo lại dữ liệu demo.');
    return {reset:true};
  }
  if (kind==='autoAck') {
    if (typeof i.enabled!=='boolean') fail(400,'INVALID_INPUT','enabled cần là true hoặc false.');
    tx.state.demo.autoAck=i.enabled;
    return {autoAck:i.enabled};
  }
  if (kind==='heartbeat') {
    const hub=entity(tx.state.hubs,requiredString(i,'hubId'),'Hub');
    if (typeof i.paused!=='boolean') fail(400,'INVALID_INPUT','paused cần là true hoặc false.');
    tx.state.demo.pausedHubs=tx.state.demo.pausedHubs.filter((id) => id!==hub.id);
    if (i.paused) tx.state.demo.pausedHubs.push(hub.id);
    else hub.lastSeenAt=tx.now;
    return {hubId:hub.id,paused:i.paused};
  }
  if (kind==='battery') {
    const v=entity(tx.state.vehicles,requiredString(i,'vehicleId'),'xe');
    const battery=number(i,'batteryPercent');
    if (battery<0 || battery>100) fail(400,'INVALID_INPUT','Pin phải từ 0 đến 100%.');
    v.batteryPercent=battery;
    v.observedAt=tx.now;
    ++v.sequence; ++v.version;
    if (v.mobilityStatus!=='Charging') refreshAvailability(v,tx.now,v.mobilityStatus==='NeedsCharge'?60:20);
    return v;
  }
  if (kind==='ack') {
    const command=entity(tx.state.commands,requiredString(i,'commandId'),'lệnh');
    if (typeof i.success!=='boolean') fail(400,'INVALID_INPUT','success cần là true hoặc false.');
    applyAck(tx,command,i.success);
    return command;
  }
  if (kind==='returnEvidence') {
    const vehicle=entity(tx.state.vehicles,requiredString(i,'vehicleId'),'xe');
    const slot=entity(tx.state.slots,requiredString(i,'slotId'),'chỗ đỗ');
    const hubId=requiredString(i,'hubId');
    if (slot.hubId!==hubId || vehicle.mobilityStatus!=='InUse') fail(409,'WRONG_DESTINATION','Bằng chứng không khớp Hub hoặc chuyến đang chạy.');
    const evidence={hubId,slotId:slot.id,locked:i.locked!==false,observedAt:tx.now};
    tx.state.demo.physicalEvidence[vehicle.id]=evidence;
    return evidence;
  }
  if (['plug','private-arrive','private-depart','parking-fixture'].includes(kind)) return simulatePhysicalEvent(tx,i);
  fail(400,'INVALID_INPUT','Loại sự kiện giả lập không hợp lệ.');
}

export async function createApp(options: AppOptions): Promise<{
  app:FastifyInstance; store:Store; tick:() => Promise<void>;
}> {
  const store=await Store.open(options.directory,options.clock,options.fault,options.slotsPerHub);
  const demo=options.demo ?? true;
  const app=Fastify({logger:options.logger ?? false,bodyLimit:96*1024,requestIdHeader:false});
  await app.register(websocket);
  const sessions=new Map<string,{actor:Actor;exp:number}>();
  const sockets=new Map<string,Set<{send(data:string):void;close(code:number):void;readyState:number}>>();
  const cookie=(req:FastifyRequest) => req.headers.cookie?.split(';').map((kv) => kv.trim())
    .find((kv) => kv.startsWith('hub_session='))?.slice('hub_session='.length);
  const session=(req:FastifyRequest) => {
    const token=cookie(req);
    const current=token && sessions.get(token);
    if (!current || current.exp<=store.clock()) {
      if (token) sessions.delete(token);
      fail(401,'UNAUTHENTICATED','Vui lòng đăng nhập.');
    }
    return current.actor;
  };
  const requestId=(req:FastifyRequest) => {
    const candidate=req.headers['idempotency-key'] ?? object(req.body).requestId;
    if (candidate===undefined) return randomUUID();
    if (typeof candidate!=='string' || !/^[a-zA-Z0-9_.:-]{8,128}$/.test(candidate))
      fail(400,'INVALID_REQUEST_ID','Mã yêu cầu không hợp lệ.');
    return candidate;
  };
  const allowedOrigin=(req:FastifyRequest) => {
    const origin=req.headers.origin;
    if (!origin) return;
    try { if (new URL(origin).host===req.headers.host) return; } catch { /* invalid origin */ }
    fail(403,'INVALID_ORIGIN','Yêu cầu phải đến từ cùng trang demo.');
  };
  app.addHook('onRequest',async (req,reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
    if (req.method!=='GET' && req.url.startsWith('/api/')) allowedOrigin(req);
  });
  app.setErrorHandler((err,req,reply) => {
    const point = req.headers['idempotency-key'] ?? object(req.body).requestId;
    const id = typeof point==='string' ? point : req.id;
    if (err instanceof DomainError) return reply.code(err.status).send({error:{code:err.code,message:err.message,details:err.details},requestId:id});
    const status=(err as {statusCode?:number}).statusCode;
    if (status && status>=400 && status<500)
      return reply.code(status).send({error:{code:'INVALID_INPUT',message:'Dữ liệu yêu cầu không hợp lệ.'},requestId:id});
    req.log.error(err);
    return reply.code(500).send({error:{code:'INTERNAL_ERROR',message:'Không thực hiện được yêu cầu.'},requestId:id});
  });

  app.get('/api/health',async () => ({data:{status:'OK'},stateVersion:store.version,requestId:randomUUID()}));
  app.get('/api/ready',async (_req,reply) => {
    if (store.recoveryReason) return reply.code(503).send({error:{code:'RECOVERY',message:store.recoveryReason},requestId:randomUUID()});
    return {data:{status:'Ready'},stateVersion:store.version,requestId:randomUUID()};
  });
  app.post('/api/auth/login',async (req,reply) => {
    const i=object(req.body);
    const user=permittedAccounts.find((a) => a.id===i.userId);
    if (!user || typeof i.password!=='string' || !safeEquals(i.password,'demo'))
      fail(401,'INVALID_CREDENTIALS','Tên tài khoản hoặc mật khẩu không đúng.');
    const old=cookie(req);
    if (old) sessions.delete(old);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{actor:user,exp:store.clock()+8*60*60_000});
    reply.header('Set-Cookie','hub_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800');
    return {data:user,stateVersion:store.version,requestId:requestId(req)};
  });
  app.get('/api/auth/me',async (req) => ({data:session(req),stateVersion:store.version,requestId:requestId(req)}));
  app.post('/api/auth/logout',async (req,reply) => {
    const token=cookie(req);
    if (token) {
      sessions.delete(token);
      for (const socket of sockets.get(token) ?? []) socket.close(1008);
      sockets.delete(token);
    }
    reply.header('Set-Cookie','hub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return {data:{loggedOut:true},stateVersion:store.version,requestId:requestId(req)};
  });
  const add:AddRoute=(method,path,role,handler, routeOptions) => {
    const routeUrl='/api'+path;
    app.route({method,url:routeUrl,handler:async (req) => {
      const actor=session(req);
      if (role!=='ANY' && actor.role!==role) fail(403,'FORBIDDEN','Vai trò hiện tại không có quyền.');
      const params=object(req.params);
      const i={...object(req.query),...object(req.body),...params};
      const id=requestId(req);
      delete i.requestId;
      const read=method==='GET' || routeOptions?.readOnly;
      const response=read ? store.read(actor,(tx) => handler(tx,i)) :
        await store.write(actor,(tx) => handler(tx,i),{requestId:id,operation:method+' '+routeUrl,payload:i});
      return {...response,requestId:id};
    }});
  };
  registerM1(add);
  registerM2(add);
  registerM3(add);

  if (demo) {
    add('GET','/operator/demo/events','OPERATOR',(tx) => ({
      commands:tx.state.commands,hubs:tx.state.hubs,points:tx.state.points,vehicles:tx.state.vehicles,
      autoAck:tx.state.demo.autoAck,pausedHubs:tx.state.demo.pausedHubs,recoveryReason:store.recoveryReason,
    }));
    app.post('/api/operator/demo/events',async (req) => {
      const actor=session(req);
      if (actor.role!=='OPERATOR') fail(403,'FORBIDDEN','Chỉ Operator có thể giả lập thiết bị.');
      const i={...object(req.body)}, id=requestId(req);
      delete i.requestId;
      if (i.kind==='reset' && i.confirm!==true) fail(400,'CONFIRM_RESET','Cần xác nhận xóa trạng thái demo về seed.');
      if (i.kind==='recover') {
        if (i.confirm!==true) fail(400,'CONFIRM_RECOVERY','Cần xác nhận đã đối soát dữ liệu phục hồi.');
        await store.recover(actor);
        return {data:{recovered:true},stateVersion:store.version,requestId:id};
      }
      const result=await store.write(actor,(tx) => demoEvent(tx,i,options.slotsPerHub),{
        requestId:id,operation:'DEMO_EVENT',payload:i,recovery:i.kind==='ack',
      });
      return {...result,requestId:id};
    });
  }

  app.get('/ws',{websocket:true,preValidation:async (req) => {allowedOrigin(req); session(req);}},(socket,req) => {
    const token=cookie(req)!;
    const entries=sockets.get(token) ?? new Set();
    entries.add(socket);
    sockets.set(token,entries);
    socket.send(JSON.stringify({type:'state.changed',stateVersion:store.version}));
    socket.on('close',() => {entries.delete(socket);if (!entries.size) sockets.delete(token);});
  });
  const unsubscribe=store.subscribe((version) => {
    const data=JSON.stringify({type:'state.changed',stateVersion:version});
    for (const [token,entries] of sockets) for (const socket of entries) {
      const current=sessions.get(token);
      if (!current || current.exp<=store.clock()) socket.close(1008);
      else if(socket.readyState===1) socket.send(data);
    }
  });

  const assetRoot=resolve('dist/web');
  if (existsSync(assetRoot)) {
    await app.register(files,{root:assetRoot,index:false});
    app.get('/', (_req,reply) => reply.sendFile('index.html'));
    app.setNotFoundHandler((req,reply) => {
      if(req.method==='GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/') && req.url!=='/ws')
        return reply.sendFile('index.html');
      return reply.code(404).send({error:{code:'NOT_FOUND',message:'Không tìm thấy địa chỉ.'},requestId:req.id});
    });
  }

  if (!store.recoveryReason && store.snapshot().runs.some((run) => run.status==='Running')) {
    await store.system((tx) => {
      for (const run of tx.state.runs.filter((r) => r.status==='Running')) {
        run.status='Failed'; run.error='INTERRUPTED'; run.finishedAt=tx.now;
      }
    });
  }
  let running: Promise<void>|undefined;

  async function runTick(): Promise<void> {
    let snapshot=store.snapshot();
    // The boot recovery branch permits acknowledgement of persisted commands only.
    const recovering=store.recoveryReason!==null;
    const now=store.clock();
    if (!recovering) {
      await store.system((tx) => {
        expireReservations(tx);
        for (const hub of tx.state.hubs) {
          if (tx.state.demo.pausedHubs.includes(hub.id) || tx.now-(hub.lastSeenAt ?? 0)<2000) continue;
          hub.lastSeenAt=tx.now;
          for (const v of tx.state.vehicles.filter((v) => v.hubId===hub.id)) {
            v.observedAt=tx.now;
            ++v.sequence;
          }
        }
        m2Tick(tx);
      });
      snapshot=store.snapshot();
    }
    for (const pending of snapshot.commands.filter((c) => c.status==='Pending')) {
      if (pending.dispatchedAt===null) {
        await store.system((tx) => {
          const command=tx.state.commands.find((c) => c.id===pending.id);
          if (!command || command.status!=='Pending' || command.dispatchedAt!==null) return;
          command.dispatchedAt=tx.now;
          command.nextProbeAt=tx.now+5000;
          ++command.attempts;
          tx.log('COMMAND_DISPATCH',command.resourceId,command.id);
        },recovering);
      }
      await store.system((tx) => {
        const command=tx.state.commands.find((c) => c.id===pending.id);
        if (!command || command.status!=='Pending') return;
        if (tx.state.demo.autoAck && (!recovering || command.dispatchedAt!==null) &&
          command.dispatchedAt!==null && now>=command.createdAt) applyAck(tx,command,true);
        else if (command.nextProbeAt!==null && tx.now>=command.nextProbeAt && command.probeCount<2) {
          ++command.probeCount;
          command.nextProbeAt=command.probeCount<2 ? tx.now+5000 : null;
          tx.log('DEVICE_RECONCILIATION',command.resourceId,'Chưa có kết quả thiết bị. Giữ tài nguyên để đối soát.');
        }
      },recovering);
    }
    if (recovering) return;
    const nextRun=store.snapshot().runs.find((run) => run.status==='Running');
    if (!nextRun) return;
    let result: unknown, error: string|null=null;
    try { result=await computeSimulation(nextRun); }
    catch(err) { error=err instanceof Error ? err.message : 'SIMULATION_FAILED'; }
    await store.system((tx) => {
      const row=tx.state.runs.find((run) => run.id===nextRun.id && run.status==='Running');
      if (!row) return;
      row.status=error ? 'Failed' : 'Completed';
      row.error=error;
      row.finishedAt=tx.now;
      if (!error) row.result=result;
    });
  }

  const tick=():Promise<void> => {
    if (!running) running=runTick().finally(() => {running=undefined;});
    return running;
  };
  const timer=options.background===false ? undefined : setInterval(() => {
    void tick().catch((err) => app.log.error(err));
  },700);
  timer?.unref();
  app.addHook('preClose',async () => {
    if(timer) clearInterval(timer);
    for (const entries of sockets.values()) for (const socket of entries) socket.close(1001);
  });
  app.addHook('onClose',async () => {
    await running?.catch(() => undefined);
    await store.close();
    unsubscribe();
  });
  return {app,store,tick};
}
