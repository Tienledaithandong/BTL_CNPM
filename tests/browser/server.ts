import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function launch(directory: string, port = 0) {
  const child = spawn(process.execPath,['dist/api/server.js'],{
    env:{...process.env,HUB_PORT:String(port),HUB_DATA_DIR:directory,HUB_ENABLE_DEMO:'1'},
    windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  const stop = async () => {
    if (child.exitCode!==null || child.signalCode!==null || !child.pid) return;
    const exited = once(child,'exit');
    child.kill();
    await exited;
  };
  try {
    const address = await new Promise<string>((resolve,reject) => {
      let logs = '';
      const timer = setTimeout(() => reject(new Error('Server did not start: '+logs)),10_000);
      const handle = (data:Buffer) => {
        logs = (logs+data.toString()).slice(-8000);
        const match = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(logs);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      };
      child.stdout.on('data',handle);
      child.stderr.on('data',handle);
      child.once('error',error => {clearTimeout(timer);reject(error);});
      child.once('exit',code => {clearTimeout(timer);reject(new Error('Process exited '+code+': '+logs));});
    });
    return {address,stop};
  } catch (error) {
    await stop();
    throw error;
  }
}
