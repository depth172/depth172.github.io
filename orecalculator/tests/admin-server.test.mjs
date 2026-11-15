import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { get, createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start(path, env, expected) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(path, import.meta.url))], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動タイムアウト: ${output}`)), 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(expected)) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`起動失敗 ${code}: ${output}`)); });
  });
  return child;
}

test('ローカル管理APIはトークン、Origin、Hostを検証しCRUDできる', async (t) => {
  const mockPort = await unusedPort();
  const adminPort = await unusedPort();
  const tables = { ore_master_skills: [], ore_master_monsters: [], ore_master_evolutions: [] };
  const mock = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const table = tables[url.pathname.split('/').pop()];
    if (!table) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify(table));
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const record = JSON.parse(body);
      const index = table.findIndex((row) => row.id === record.id);
      if (index >= 0) table[index] = record; else table.push(record);
      res.writeHead(201); return res.end(JSON.stringify([record]));
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      const index = table.findIndex((row) => row.id === id);
      if (index >= 0) table.splice(index, 1);
      res.writeHead(204); return res.end();
    }
    res.writeHead(405); res.end();
  });
  mock.listen(mockPort, '127.0.0.1');
  await once(mock, 'listening');
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const admin = await start('../../orecalculator-admin/server.mjs', {
    ORE_ADMIN_PORT: String(adminPort), ORE_ADMIN_SUPABASE_URL: `http://127.0.0.1:${mockPort}`, ORE_ADMIN_SUPABASE_SERVICE_KEY: 'test-key',
  }, '管理画面:');
  t.after(() => admin.kill());
  const origin = `http://127.0.0.1:${adminPort}`;
  const html = await (await fetch(origin)).text();
  const token = /name="admin-token" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(token);
  assert.equal((await fetch(`${origin}/api/skills`)).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    get(`${origin}/api/skills`, { headers: { 'X-Admin-Token': token, Host: `localhost:${adminPort}` } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHost, 403);
  const skill = { id: '60a4d6e5-b854-4354-b2a2-502e08f156ab', name: 'test', kind: 'normal', is_miss: false, default_cost: -1.5, default_from_level: 1, default_cost_by_level: [-2, null, null, null] };
  const write = (requestOrigin) => fetch(`${origin}/api/skills`, { method: 'PUT', headers: { 'X-Admin-Token': token, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(skill) });
  assert.equal((await write('https://example.com')).status, 403);
  assert.equal((await write(origin)).status, 200);
  const rows = await (await fetch(`${origin}/api/skills`, { headers: { 'X-Admin-Token': token } })).json();
  assert.equal(rows[0].name, 'test');
  assert.equal(rows[0].default_cost, -1.5);
  assert.deepEqual(rows[0].default_cost_by_level, [-2, null, null, null]);
  assert.equal(rows[0].default_from_level, 1);
  const deleted = await fetch(`${origin}/api/skills`, { method: 'DELETE', headers: { 'X-Admin-Token': token, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: skill.id }) });
  assert.equal(deleted.status, 200);
});
