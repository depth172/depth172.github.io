import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecord } from './validate.mjs';

const require = createRequire(resolve(fileURLToPath(new URL('../orecalculator/package.json', import.meta.url))));
const { createClient } = require('@supabase/supabase-js');
const url = process.env.ORE_ADMIN_SUPABASE_URL;
const key = process.env.ORE_ADMIN_SUPABASE_SERVICE_KEY;
const port = Number(process.env.ORE_ADMIN_PORT || '4174');
if (!url || !key || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('ORE_ADMIN_SUPABASE_URL、ORE_ADMIN_SUPABASE_SERVICE_KEYと有効なORE_ADMIN_PORTを設定してください。');
  process.exit(1);
}
const endpoint = new URL(url);
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) {
  console.error('Supabase URLにはHTTPSまたはローカル接続を指定してください。');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const token = randomBytes(32).toString('hex');
const origin = `http://127.0.0.1:${port}`;
const tables = { skills: 'ore_master_skills', monsters: 'ore_master_monsters', evolutions: 'ore_master_evolutions' };
const assets = { '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('データが大きすぎます。');
  }
  return JSON.parse(data);
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` || req.socket.remoteAddress !== '127.0.0.1') {
      return reply(res, 403, { error: 'ローカルからのみ利用できます。' });
    }
    const path = new URL(req.url, origin).pathname;
    if (req.method === 'GET' && path === '/') {
      const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replace('ADMIN_TOKEN_PLACEHOLDER', token);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      });
      return res.end(html);
    }
    if (req.method === 'GET' && Object.hasOwn(assets, path)) {
      const [file, contentType] = assets[path];
      const data = await readFile(new URL(`./${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(data);
    }
    if (req.headers['x-admin-token'] !== token || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      return reply(res, 403, { error: '管理画面からのリクエストではありません。' });
    }
    const match = /^\/api\/(skills|monsters|evolutions)$/.exec(path);
    if (!match) return reply(res, 404, { error: '見つかりません。' });
    const table = tables[match[1]];
    if (req.method === 'GET') {
      const { data, error } = await db.from(table).select('*').order('id');
      if (error) return reply(res, 502, { error: error.message });
      return reply(res, 200, data);
    }
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) {
      return reply(res, 403, { error: '不正なリクエストです。' });
    }
    if (req.method === 'PUT') {
      const record = await readJson(req);
      const issue = validateRecord(match[1], record);
      if (issue) return reply(res, 400, { error: issue });
      if (match[1] === 'skills' && !['up', 'charge'].includes(record.kind)) {
        const { data: evolutions, error } = await db.from(tables.evolutions).select('replacement');
        if (error) return reply(res, 502, { error: error.message });
        if (evolutions.some((item) => item.replacement.skillIds.includes(record.id))) {
          return reply(res, 409, { error: '進化の置換候補に使用中の技は、移動・ためる以外に変更できません。' });
        }
      }
      if (match[1] !== 'skills') {
        const [skills, monsters] = await Promise.all([
          db.from(tables.skills).select('id,kind'), db.from(tables.monsters).select('id,skills,class_level'),
        ]);
        if (skills.error || monsters.error) return reply(res, 502, { error: skills.error?.message || monsters.error?.message });
        const bySkill = new Map(skills.data.map((item) => [item.id, item]));
        if (match[1] === 'monsters' && record.skills.some((item) => !bySkill.has(item.skillId))) {
          return reply(res, 400, { error: '存在しない技が指定されています。' });
        }
        if (match[1] === 'monsters') {
          const { data: evolutions, error } = await db.from(tables.evolutions).select('source_id,target_id,mappings,replacement');
          if (error) return reply(res, 502, { error: error.message });
          const available = new Set(record.skills.map((item) => item.skillId));
          if (evolutions.some((e) =>
            (e.source_id === record.id && e.mappings.some((item) => !available.has(item.from))) ||
            (e.target_id === record.id && (e.mappings.some((item) => !available.has(item.to)) || e.replacement.skillIds.some((id) => !available.has(id))))
          )) return reply(res, 409, { error: '進化ルールで使用中の技は削除できません。先に進化ルールを変更してください。' });
        }
        if (match[1] === 'evolutions') {
          const source = monsters.data.find((item) => item.id === record.source_id);
          const target = monsters.data.find((item) => item.id === record.target_id);
          if (!source || !target) return reply(res, 400, { error: '進化元または進化先が存在しません。' });
          const from = new Set(source.skills.map((item) => item.skillId));
          const to = new Set(target.skills.map((item) => item.skillId));
          if (record.mappings.some((item) => !from.has(item.from) || !to.has(item.to)) ||
              record.replacement.skillIds.some((id) => !to.has(id) || !['up', 'charge'].includes(bySkill.get(id)?.kind))) {
            return reply(res, 400, { error: '技の対応と置換候補は進化元・進化先に登録された技から選択してください。' });
          }
        }
      }
      const { error } = await db.from(table).upsert(record);
      if (error) return reply(res, 502, { error: error.message });
      return reply(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const { id } = await readJson(req);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return reply(res, 400, { error: 'IDが不正です。' });
      if (match[1] === 'skills') {
        const [monsters, evolutions] = await Promise.all([
          db.from(tables.monsters).select('skills,reels'), db.from(tables.evolutions).select('mappings,replacement'),
        ]);
        if (monsters.error || evolutions.error) return reply(res, 502, { error: monsters.error?.message || evolutions.error?.message });
        if (JSON.stringify([monsters.data, evolutions.data]).includes(id)) return reply(res, 409, { error: 'この技はモンスターまたは進化ルールで使用中です。' });
      }
      const { error } = await db.from(table).delete().eq('id', id);
      if (error) return reply(res, 502, { error: error.message });
      return reply(res, 200, { ok: true });
    }
    return reply(res, 405, { error: '未対応の操作です。' });
  } catch (error) {
    console.error('管理リクエストに失敗しました:', error);
    return reply(res, 500, { error: error instanceof Error ? error.message : '処理に失敗しました。' });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`管理画面: ${origin}`));
