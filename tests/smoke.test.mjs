import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');

async function waitForServer(baseUrl, child) {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    if (child.exitCode != null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/public/sessions`);
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Server did not become ready');
}

async function request(baseUrl, pathName, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.reason || data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
}

test('core workshop flow: create, join, invest, settle, reveal', async () => {
  const port = 3199;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(rootDir, '.data', `test-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: dbPath,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin123'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(baseUrl, child);

    const admin = await request(baseUrl, '/api/auth/admin/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' }
    });
    assert.equal(admin.role, 'admin');

    const session = await request(baseUrl, '/api/admin/sessions', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '自动化测试场',
        config: { group_count: 2, initial_funds: 100000, invest_step: 10000, bonus_top_n: 1 }
      }
    });
    assert.match(session.join_code, /^[A-Z0-9]{6}$/);

    const disposable = await request(baseUrl, '/api/admin/sessions', {
      method: 'POST',
      token: admin.token,
      body: {
        name: '待删除场次',
        config: { group_count: 2, initial_funds: 100000, invest_step: 10000, bonus_top_n: 1 }
      }
    });
    await request(baseUrl, `/api/admin/sessions/${disposable.id}`, { method: 'DELETE', token: admin.token });
    await assert.rejects(
      () => request(baseUrl, `/api/admin/sessions/${disposable.id}`, { token: admin.token }),
      (err) => err.status === 404
    );

    await request(baseUrl, `/api/admin/sessions/${session.id}/open`, { method: 'POST', token: admin.token });

    const stamp = Date.now();
    const groupA = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: `group_a_${stamp}`, password: 'pass1234' }
    });
    const groupB = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: `group_b_${stamp}`, password: 'pass1234' }
    });

    const alphaJoin = await request(baseUrl, `/api/sessions/${session.id}/join`, {
      method: 'POST',
      token: groupA.token,
      body: { join_code: session.join_code, team_name: 'Alpha', product: 'P1', direction: 'AI+新型硬件' }
    });
    assert.equal(alphaJoin.membership.member_role, 'leader');
    assert.match(alphaJoin.membership.team_code, /^[A-Z0-9]{4}$/);
    const repeatJoin = await request(baseUrl, `/api/sessions/${session.id}/join`, {
      method: 'POST',
      token: groupA.token,
      body: { join_code: session.join_code, team_name: 'Alpha Changed', product: 'P1 Changed', direction: 'AI+新型硬件' }
    });
    assert.equal(repeatJoin.membership.team_name, 'Alpha');

    await request(baseUrl, `/api/sessions/${session.id}/join`, {
      method: 'POST',
      token: groupB.token,
      body: { join_code: session.join_code, team_name: 'Beta', product: 'P2', direction: '运动健康硬件' }
    });

    const groupC = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: `group_c_${stamp}`, password: 'pass1234' }
    });
    await assert.rejects(
      () => request(baseUrl, `/api/sessions/${session.id}/join`, {
        method: 'POST',
        token: groupC.token,
        body: { join_code: session.join_code, team_name: 'Alpha', product: 'P3', direction: 'AI+新型硬件' }
      }),
      (err) => err.status === 400 && err.data.error === 'TEAM_NAME_TAKEN'
    );
    await assert.rejects(
      () => request(baseUrl, `/api/sessions/${session.id}/join`, {
        method: 'POST',
        token: groupC.token,
        body: { join_code: session.join_code, team_name: 'Gamma', product: 'P2', direction: 'AI+新型硬件' }
      }),
      (err) => err.status === 400 && err.data.error === 'PRODUCT_TAKEN'
    );

    const groupD = await request(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: `group_d_${stamp}`, password: 'pass1234' }
    });
    const memberJoin = await request(baseUrl, `/api/sessions/${session.id}/join`, {
      method: 'POST',
      token: groupD.token,
      body: { join_code: session.join_code, mode: 'join', team_code: alphaJoin.membership.team_code }
    });
    assert.equal(memberJoin.membership.team_name, 'Alpha');
    assert.equal(memberJoin.membership.member_role, 'member');

    const detail = await request(baseUrl, `/api/admin/sessions/${session.id}`, { token: admin.token });
    assert.equal(detail.memberships.length, 2);
    const target = detail.memberships.find((member) => member.team_name === 'Beta');
    assert.ok(target);

    await request(baseUrl, `/api/admin/sessions/${session.id}/start`, { method: 'POST', token: admin.token });

    await assert.rejects(
      () => request(baseUrl, `/api/sessions/${session.id}/investment`, {
        method: 'PUT',
        token: groupD.token,
        body: { target_id: target.id, amount: 10000 }
      }),
      (err) => err.status === 403 && err.data.error === 'LEADER_REQUIRED'
    );

    await request(baseUrl, `/api/sessions/${session.id}/join`, { method: 'DELETE', token: groupD.token });
    await assert.rejects(
      () => request(baseUrl, `/api/sessions/${session.id}/me`, { token: groupD.token }),
      (err) => err.status === 403 && err.data.error === 'NOT_JOINED'
    );

    const invest = await request(baseUrl, `/api/sessions/${session.id}/investment`, {
      method: 'PUT',
      token: groupA.token,
      body: { target_id: target.id, amount: 20000 }
    });
    assert.equal(invest.balance, 80000);

    const resetInvest = await request(baseUrl, `/api/sessions/${session.id}/investment`, {
      method: 'PUT',
      token: groupA.token,
      body: { target_id: target.id, amount: 10000 }
    });
    assert.equal(resetInvest.balance, 90000);

    const privateState = await request(baseUrl, `/api/sessions/${session.id}/state`, { token: groupA.token });
    assert.equal(privateState.my_balance, 90000);
    assert.equal(privateState.teams.some((team) => Object.hasOwn(team, 'funding_total')), false);

    await assert.rejects(
      () => request(baseUrl, `/api/sessions/${session.id}/leaderboard`),
      (err) => err.status === 403
    );

    await request(baseUrl, `/api/admin/sessions/${session.id}/settle`, { method: 'POST', token: admin.token });
    await request(baseUrl, `/api/admin/sessions/${session.id}/reveal`, { method: 'POST', token: admin.token });

    const board = await request(baseUrl, `/api/sessions/${session.id}/leaderboard`);
    assert.equal(board.funding[0].team_name, 'Beta');
    assert.equal(board.funding[0].funding_total, 10000);
    assert.equal(board.investment[0].team_name, 'Alpha');
  } finally {
    await stopServer(child);
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
