import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GET as getEredivisie } from '../api/eredivisie.ts';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolsDirectory, '..');

const angularCli = resolve(projectRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

const apiServer = createServer(async (request, response) => {
  const pathname = request.url?.split('?')[0];

  if (request.method !== 'GET' || pathname !== '/api/eredivisie') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const apiResponse = await getEredivisie();
    const body = Buffer.from(await apiResponse.arrayBuffer());

    response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));

    response.end(body);
  } catch (error) {
    console.error('Local football API failed:', error);

    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Football data could not be loaded' }));
  }
});

apiServer.listen(4300, '127.0.0.1', () => {
  console.log('Local football API running at http://127.0.0.1:4300');

  const angularProcess = spawn(
    process.execPath,
    [angularCli, 'serve', '--proxy-config', 'proxy.conf.json'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );

  angularProcess.on('exit', (code) => {
    apiServer.close();
    process.exit(code ?? 0);
  });
});
