import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, '.data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(dataDir, 'app.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-change-me';
const PORT = Number(process.env.PORT || 3001);

const defaultConfig = {
  group_count: 10,
  initial_funds: 1000000,
  invest_step: 10000,
  min_invest_per_tx: 0,
  max_invest_per_tx: null,
  max_invest_per_target: null,
  allow_self_invest: false,
  allow_hold: true,
  allow_overdraft: false,
  secrecy: true,
  invest_window_seconds: 180,
  allow_edit_in_window: true,
  bonus_top_n: 3,
  multiplier_min: 1,
  multiplier_max: 10,
  base_multiplier: 1,
  directions: ['生产力硬件', '运动健康硬件', 'AI+新型硬件'],
  force_direction: true,
  awards: { funding: true, multiplier: true, investment: true },
  leaderboard_top_n: 3
};

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      config_json TEXT NOT NULL,
      current_target_id INTEGER,
      window_open INTEGER NOT NULL DEFAULT 0,
      window_ends_at TEXT,
      current_round INTEGER NOT NULL DEFAULT 0,
      revealed INTEGER NOT NULL DEFAULT 0,
      special_award_id INTEGER,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES admins(id),
      FOREIGN KEY(current_target_id) REFERENCES memberships(id),
      FOREIGN KEY(special_award_id) REFERENCES memberships(id)
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      group_account_id INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      team_code TEXT,
      product TEXT,
      direction TEXT,
      seat_no INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, group_account_id),
      UNIQUE(session_id, seat_no),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(group_account_id) REFERENCES group_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS membership_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      membership_id INTEGER NOT NULL,
      group_account_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, group_account_id),
      UNIQUE(membership_id, group_account_id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(membership_id) REFERENCES memberships(id) ON DELETE CASCADE,
      FOREIGN KEY(group_account_id) REFERENCES group_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      investor_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      round_no INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, investor_id, target_id),
      CHECK(investor_id <> target_id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(investor_id) REFERENCES memberships(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES memberships(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS multipliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      value REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, target_id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES memberships(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settlement_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      membership_id INTEGER NOT NULL,
      funding_total INTEGER NOT NULL,
      funding_rank INTEGER NOT NULL,
      effective_multiplier REAL NOT NULL,
      valuation INTEGER NOT NULL,
      invest_total INTEGER NOT NULL,
      invest_return INTEGER NOT NULL,
      invest_net INTEGER NOT NULL,
      invest_roi REAL,
      UNIQUE(session_id, membership_id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(membership_id) REFERENCES memberships(id) ON DELETE CASCADE
    );
  `);

  const adminCount = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
  if (adminCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const displayName = process.env.ADMIN_DISPLAY_NAME || '主办方';
    db.prepare('INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)').run(
      username,
      bcrypt.hashSync(password, 10),
      displayName
    );
    console.log(`Seeded admin account: ${username} / ${password}`);
  }

  db.exec(`
    INSERT OR IGNORE INTO membership_users (session_id, membership_id, group_account_id, role)
    SELECT session_id, id, group_account_id, 'leader'
    FROM memberships
  `);

  const membershipColumns = db.prepare("PRAGMA table_info(memberships)").all().map((column) => column.name);
  if (!membershipColumns.includes('team_code')) {
    db.exec('ALTER TABLE memberships ADD COLUMN team_code TEXT');
  }
  for (const row of db.prepare('SELECT id, session_id FROM memberships WHERE team_code IS NULL OR team_code = ?').all('')) {
    db.prepare('UPDATE memberships SET team_code = ? WHERE id = ?').run(generateTeamCode(row.session_id), row.id);
  }
}

function tokenFor(role, id) {
  return jwt.sign({ role, sub: id }, JWT_SECRET, { expiresIn: '12h' });
}

function mergeConfig(config = {}) {
  return {
    ...defaultConfig,
    ...config,
    awards: { ...defaultConfig.awards, ...(config.awards || {}) }
  };
}

function parseConfig(session) {
  return mergeConfig(JSON.parse(session.config_json || '{}'));
}

function normalizeConfig(input = {}) {
  const config = mergeConfig(input);
  if (config.bonus_top_n > config.group_count) throw httpError(400, 'INVALID_CONFIG', 'bonus_top_n must be <= group_count');
  if (config.multiplier_min > config.multiplier_max) throw httpError(400, 'INVALID_CONFIG', 'multiplier_min must be <= multiplier_max');
  if (config.initial_funds % config.invest_step !== 0) throw httpError(400, 'INVALID_CONFIG', 'initial_funds must be divisible by invest_step');
  return config;
}

function httpError(status, error, reason = error) {
  const err = new Error(reason);
  err.status = status;
  err.error = error;
  err.reason = reason;
  return err;
}

function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

function requireAuth(role) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(httpError(401, 'UNAUTHORIZED', 'Missing token'));
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      return next(httpError(401, 'UNAUTHORIZED', 'Invalid token'));
    }
    if (role && req.user.role !== role) return next(httpError(403, 'FORBIDDEN', 'Wrong role'));
    next();
  };
}

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    const exists = db.prepare('SELECT id FROM sessions WHERE join_code = ?').get(code);
    if (!exists) return code;
  }
  throw httpError(500, 'JOIN_CODE_FAILED', 'Could not generate join code');
}

function generateTeamCode(sessionId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    const exists = db.prepare('SELECT id FROM memberships WHERE session_id = ? AND team_code = ?').get(sessionId, code);
    if (!exists) return code;
  }
  throw httpError(500, 'TEAM_CODE_FAILED', 'Could not generate team code');
}

function getSession(id) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) throw httpError(404, 'SESSION_NOT_FOUND', 'Session not found');
  return session;
}

function getMembership(sessionId, groupAccountId) {
  return db.prepare(`
    SELECT m.*, mu.role AS member_role
    FROM membership_users mu
    JOIN memberships m ON m.id = mu.membership_id
    WHERE mu.session_id = ? AND mu.group_account_id = ?
  `).get(sessionId, groupAccountId);
}

function getMembershipLink(sessionId, groupAccountId) {
  return db.prepare('SELECT * FROM membership_users WHERE session_id = ? AND group_account_id = ?').get(sessionId, groupAccountId);
}

function computeBalance(sessionId, membershipId, config) {
  const total = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM investments WHERE session_id = ? AND investor_id = ?').get(sessionId, membershipId).total;
  return config.initial_funds - total;
}

function refreshBalance(sessionId, membershipId, config) {
  const balance = computeBalance(sessionId, membershipId, config);
  db.prepare('UPDATE memberships SET balance = ? WHERE id = ?').run(balance, membershipId);
  return balance;
}

function publicTarget(targetId) {
  if (!targetId) return null;
  const row = db.prepare('SELECT id AS membership_id, seat_no, team_name, team_code, product, direction FROM memberships WHERE id = ?').get(targetId);
  return row || null;
}

function publicTeams(sessionId) {
  return db.prepare(`
    SELECT
      m.id AS membership_id,
      m.seat_no,
      m.team_name,
      m.team_code,
      m.product,
      m.direction,
      ga.username AS leader_username,
      (
        SELECT COUNT(*)
        FROM membership_users mu
        WHERE mu.membership_id = m.id
      ) AS member_count,
      (
        SELECT GROUP_CONCAT(member_accounts.username, '、')
        FROM membership_users mu
        JOIN group_accounts member_accounts ON member_accounts.id = mu.group_account_id
        WHERE mu.membership_id = m.id
      ) AS member_names
    FROM memberships m
    LEFT JOIN group_accounts ga ON ga.id = m.group_account_id
    WHERE m.session_id = ?
    ORDER BY m.seat_no
  `).all(sessionId);
}

function statePayload(session, user = null) {
  const config = parseConfig(session);
  const payload = {
    id: session.id,
    name: session.name,
    config: {
      initial_funds: config.initial_funds,
      invest_step: config.invest_step,
      invest_window_seconds: config.invest_window_seconds,
      bonus_top_n: config.bonus_top_n,
      awards: config.awards,
      leaderboard_top_n: config.leaderboard_top_n
    },
    status: session.status,
    current_round: session.current_round,
    window_open: Boolean(session.window_open),
    window_ends_at: session.window_ends_at,
    current_target: publicTarget(session.current_target_id),
    teams: publicTeams(session.id),
    revealed: Boolean(session.revealed)
  };
  if (user?.role === 'group') {
    const membership = getMembership(session.id, user.sub);
    if (membership) {
      payload.my_membership_id = membership.id;
      payload.my_member_role = membership.member_role;
      payload.my_balance = refreshBalance(session.id, membership.id, config);
    }
  }
  return payload;
}

function aggregateMemberships(sessionId) {
  return db.prepare(`
    SELECT
      m.*,
      COALESCE(funding.total, 0) AS funding_total,
      COALESCE(spent.total, 0) AS invest_total,
      mu.value AS multiplier,
      sr.funding_rank,
      sr.effective_multiplier,
      sr.valuation,
      sr.invest_return,
      sr.invest_net,
      sr.invest_roi
    FROM memberships m
    LEFT JOIN (
      SELECT target_id, SUM(amount) AS total FROM investments WHERE session_id = ? GROUP BY target_id
    ) funding ON funding.target_id = m.id
    LEFT JOIN (
      SELECT investor_id, SUM(amount) AS total FROM investments WHERE session_id = ? GROUP BY investor_id
    ) spent ON spent.investor_id = m.id
    LEFT JOIN multipliers mu ON mu.target_id = m.id AND mu.session_id = m.session_id
    LEFT JOIN settlement_results sr ON sr.membership_id = m.id AND sr.session_id = m.session_id
    WHERE m.session_id = ?
    ORDER BY m.seat_no
  `).all(sessionId, sessionId, sessionId);
}

function buildLeaderboard(session) {
  if (!session.revealed) throw httpError(403, 'NOT_REVEALED', 'Leaderboard is not revealed');
  const rows = db.prepare(`
    SELECT
      sr.*,
      m.seat_no,
      m.team_name,
      m.product,
      m.direction
    FROM settlement_results sr
    JOIN memberships m ON m.id = sr.membership_id
    WHERE sr.session_id = ?
  `).all(session.id);

  const funding = [...rows].sort((a, b) => a.funding_rank - b.funding_rank || b.funding_total - a.funding_total || a.seat_no - b.seat_no);
  const investment = [...rows].sort((a, b) => {
    if (a.invest_roi == null && b.invest_roi == null) return b.invest_net - a.invest_net || a.seat_no - b.seat_no;
    if (a.invest_roi == null) return 1;
    if (b.invest_roi == null) return -1;
    return b.invest_roi - a.invest_roi || b.invest_net - a.invest_net || a.seat_no - b.seat_no;
  });
  const multiplier = [...rows].sort((a, b) => b.effective_multiplier - a.effective_multiplier || b.funding_total - a.funding_total || a.seat_no - b.seat_no);
  return { funding, investment, multiplier };
}

function settleSession(sessionId) {
  const session = getSession(sessionId);
  const config = parseConfig(session);
  const members = db.prepare('SELECT * FROM memberships WHERE session_id = ? ORDER BY seat_no').all(sessionId);
  const fundingTotals = new Map();
  const multipliers = new Map();

  for (const member of members) {
    fundingTotals.set(member.id, db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM investments WHERE session_id = ? AND target_id = ?').get(sessionId, member.id).total);
  }
  for (const row of db.prepare('SELECT target_id, value FROM multipliers WHERE session_id = ?').all(sessionId)) {
    multipliers.set(row.target_id, row.value);
  }

  const ranked = [...members].sort((a, b) => fundingTotals.get(b.id) - fundingTotals.get(a.id) || a.seat_no - b.seat_no);
  const ranks = new Map();
  let lastTotal = null;
  let currentRank = 0;
  ranked.forEach((member, index) => {
    const total = fundingTotals.get(member.id);
    if (total !== lastTotal) currentRank = index + 1;
    ranks.set(member.id, currentRank);
    lastTotal = total;
  });

  const thresholdIndex = Math.min(config.bonus_top_n, ranked.length) - 1;
  const bonusThreshold = thresholdIndex >= 0 ? fundingTotals.get(ranked[thresholdIndex].id) : Infinity;
  const effectiveMultipliers = new Map();
  for (const member of members) {
    const qualifies = config.bonus_top_n > 0 && fundingTotals.get(member.id) >= bonusThreshold;
    const raw = qualifies ? (multipliers.get(member.id) ?? config.base_multiplier) : config.base_multiplier;
    effectiveMultipliers.set(member.id, Math.min(config.multiplier_max, Math.max(config.multiplier_min, Number(raw))));
  }

  const tx = transaction(() => {
    db.prepare('DELETE FROM settlement_results WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(`
      INSERT INTO settlement_results (
        session_id, membership_id, funding_total, funding_rank, effective_multiplier,
        valuation, invest_total, invest_return, invest_net, invest_roi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const member of members) {
      const investments = db.prepare('SELECT target_id, amount FROM investments WHERE session_id = ? AND investor_id = ?').all(sessionId, member.id);
      const investTotal = investments.reduce((sum, row) => sum + row.amount, 0);
      const investReturn = investments.reduce((sum, row) => sum + Math.round(row.amount * effectiveMultipliers.get(row.target_id)), 0);
      const investNet = investReturn - investTotal;
      const investRoi = investTotal > 0 ? investNet / investTotal : null;
      const fundingTotal = fundingTotals.get(member.id);
      const effectiveMultiplier = effectiveMultipliers.get(member.id);

      insert.run(
        sessionId,
        member.id,
        fundingTotal,
        ranks.get(member.id),
        effectiveMultiplier,
        Math.round(fundingTotal * effectiveMultiplier),
        investTotal,
        investReturn,
        investNet,
        investRoi
      );
    }
    db.prepare("UPDATE sessions SET status = 'settled', window_open = 0, revealed = 0 WHERE id = ?").run(sessionId);
  });

  tx();
  return getSession(sessionId);
}

initDb();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/auth/register', (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 4) throw httpError(400, 'INVALID_INPUT', 'Username and password are required');
    const info = db.prepare('INSERT INTO group_accounts (username, password_hash) VALUES (?, ?)').run(username.trim(), bcrypt.hashSync(password, 10));
    res.json({ token: tokenFor('group', info.lastInsertRowid), role: 'group' });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return next(httpError(400, 'USERNAME_TAKEN', 'Username already exists'));
    next(err);
  }
});

app.post('/api/auth/login', (req, res, next) => {
  try {
    const { username, password } = req.body;
    const account = db.prepare('SELECT * FROM group_accounts WHERE username = ?').get(username);
    if (!account || !bcrypt.compareSync(password || '', account.password_hash)) throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    res.json({ token: tokenFor('group', account.id), role: 'group' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/admin/login', (req, res, next) => {
  try {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    res.json({ token: tokenFor('admin', admin.id), role: 'admin', display_name: admin.display_name });
  } catch (err) {
    next(err);
  }
});

app.get('/api/me', requireAuth(), (req, res) => {
  const table = req.user.role === 'admin' ? 'admins' : 'group_accounts';
  const account = db.prepare(`SELECT id, username ${req.user.role === 'admin' ? ', display_name' : ''} FROM ${table} WHERE id = ?`).get(req.user.sub);
  res.json({ role: req.user.role, ...account });
});

app.get('/api/public/sessions', (_req, res) => {
  res.json(db.prepare("SELECT id, name, status, revealed FROM sessions WHERE status IN ('open', 'running', 'settled') ORDER BY created_at DESC").all());
});

app.get('/api/sessions', requireAuth('group'), (req, res) => {
  const sessions = db.prepare("SELECT id, name, status FROM sessions WHERE status IN ('open', 'running') ORDER BY created_at DESC").all();
  const rows = sessions.map((session) => ({
    ...session,
    joined: Boolean(getMembershipLink(session.id, req.user.sub))
  }));
  res.json(rows);
});

app.post('/api/sessions/:id/join', requireAuth('group'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    if (!['open', 'running'].includes(session.status)) throw httpError(400, 'SESSION_NOT_OPEN', 'Session is not open');
    const config = parseConfig(session);
    const { join_code, team_name, product = '', direction = '', mode = 'create', membership_id, team_code } = req.body;
    const teamName = team_name?.trim();
    const productName = product?.trim();
    if (join_code !== session.join_code) throw httpError(400, 'BAD_JOIN_CODE', 'Join code is invalid');
    const existing = getMembership(session.id, req.user.sub);
    if (existing) return res.json({ membership: existing });

    if (mode === 'join') {
      const targetCode = String(team_code || '').trim().toUpperCase();
      if (!targetCode) throw httpError(400, 'TEAM_CODE_REQUIRED', 'Team code is required');
      const target = db.prepare('SELECT * FROM memberships WHERE session_id = ? AND team_code = ?').get(session.id, targetCode);
      if (!target) throw httpError(404, 'TEAM_NOT_FOUND', 'Team not found');
      db.prepare(`
        INSERT INTO membership_users (session_id, membership_id, group_account_id, role)
        VALUES (?, ?, ?, 'member')
      `).run(session.id, target.id, req.user.sub);
      return res.json({ membership: { ...target, member_role: 'member' } });
    }

    if (!teamName) throw httpError(400, 'TEAM_NAME_REQUIRED', 'Team name is required');

    const duplicateTeam = db.prepare(`
      SELECT id FROM memberships
      WHERE session_id = ? AND lower(team_name) = lower(?)
    `).get(session.id, teamName);
    if (duplicateTeam) throw httpError(400, 'TEAM_NAME_TAKEN', 'This team name is already joined in this session');

    if (productName) {
      const duplicateProduct = db.prepare(`
        SELECT id FROM memberships
        WHERE session_id = ? AND product IS NOT NULL AND product <> '' AND lower(product) = lower(?)
      `).get(session.id, productName);
      if (duplicateProduct) throw httpError(400, 'PRODUCT_TAKEN', 'This project is already joined in this session');
    }

    const taken = new Set(db.prepare('SELECT seat_no FROM memberships WHERE session_id = ?').all(session.id).map((row) => row.seat_no));
    let seatNo = 1;
    while (taken.has(seatNo) && seatNo <= config.group_count) seatNo += 1;
    if (seatNo > config.group_count) throw httpError(400, 'SESSION_FULL', 'Session is full');

    const tx = transaction(() => {
      const info = db.prepare(`
      INSERT INTO memberships (session_id, group_account_id, team_name, team_code, product, direction, seat_no, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, req.user.sub, teamName, generateTeamCode(session.id), productName, direction.trim(), seatNo, config.initial_funds);
      db.prepare(`
        INSERT INTO membership_users (session_id, membership_id, group_account_id, role)
        VALUES (?, ?, ?, 'leader')
      `).run(session.id, info.lastInsertRowid, req.user.sub);
      return db.prepare('SELECT *, ? AS member_role FROM memberships WHERE id = ?').get('leader', info.lastInsertRowid);
    });
    res.json({ membership: tx() });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/sessions/:id/join', requireAuth('group'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const link = getMembershipLink(session.id, req.user.sub);
    if (!link) throw httpError(403, 'NOT_JOINED', 'You have not joined this session');
    const tx = transaction(() => {
      if (link.role === 'leader') {
        db.prepare('UPDATE sessions SET current_target_id = NULL, special_award_id = NULL WHERE current_target_id = ? OR special_award_id = ?').run(link.membership_id, link.membership_id);
        db.prepare('DELETE FROM memberships WHERE id = ?').run(link.membership_id);
      } else {
        db.prepare('DELETE FROM membership_users WHERE id = ?').run(link.id);
      }
    });
    tx();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions/:id/me', requireAuth('group'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const config = parseConfig(session);
    const membership = getMembership(session.id, req.user.sub);
    if (!membership) throw httpError(403, 'NOT_JOINED', 'You have not joined this session');
    const balance = refreshBalance(session.id, membership.id, config);
    const investments = db.prepare(`
      SELECT i.target_id, i.amount, m.seat_no AS target_seat, m.team_name AS target_team, m.product, m.direction
      FROM investments i
      JOIN memberships m ON m.id = i.target_id
      WHERE i.session_id = ? AND i.investor_id = ? AND i.amount > 0
      ORDER BY m.seat_no
    `).all(session.id, membership.id);
    res.json({ membership: { ...membership, balance }, investments });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions/:id/state', requireAuth(), (req, res, next) => {
  try {
    res.json(statePayload(getSession(req.params.id), req.user));
  } catch (err) {
    next(err);
  }
});

app.put('/api/sessions/:id/investment', requireAuth('group'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const config = parseConfig(session);
    const investor = getMembership(session.id, req.user.sub);
    if (!investor) throw httpError(403, 'NOT_JOINED', 'You have not joined this session');
    if (investor.member_role !== 'leader') throw httpError(403, 'LEADER_REQUIRED', 'Only team leader can change investments');
    const targetId = Number(req.body.target_id);
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < 0) throw httpError(400, 'INVALID_AMOUNT', 'Amount must be a non-negative integer');
    if (session.status !== 'running') throw httpError(400, 'NOT_RUNNING', 'Session is not running');
    if (!config.allow_self_invest && investor.id === targetId) throw httpError(400, 'SELF_INVEST_FORBIDDEN', 'Self investment is forbidden');
    if (amount % config.invest_step !== 0) throw httpError(400, 'STEP_MISMATCH', 'Amount must match invest_step');
    if (amount < config.min_invest_per_tx) throw httpError(400, 'BELOW_MIN', 'Amount is below min_invest_per_tx');
    if (config.max_invest_per_tx != null && amount > config.max_invest_per_tx) throw httpError(400, 'ABOVE_MAX', 'Amount is above max_invest_per_tx');
    if (config.max_invest_per_target != null && amount > config.max_invest_per_target) throw httpError(400, 'ABOVE_TARGET_MAX', 'Amount is above max_invest_per_target');

    const target = db.prepare('SELECT id FROM memberships WHERE id = ? AND session_id = ?').get(targetId, session.id);
    if (!target) throw httpError(404, 'TARGET_NOT_FOUND', 'Target not found');

    const otherSpent = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM investments
      WHERE session_id = ? AND investor_id = ? AND target_id <> ?
    `).get(session.id, investor.id, targetId).total;
    if (!config.allow_overdraft && otherSpent + amount > config.initial_funds) throw httpError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');

    const tx = transaction(() => {
      if (amount === 0) {
        db.prepare('DELETE FROM investments WHERE session_id = ? AND investor_id = ? AND target_id = ?').run(session.id, investor.id, targetId);
      } else {
        db.prepare(`
          INSERT INTO investments (session_id, investor_id, target_id, amount, round_no, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(session_id, investor_id, target_id)
          DO UPDATE SET amount = excluded.amount, round_no = excluded.round_no, updated_at = CURRENT_TIMESTAMP
        `).run(session.id, investor.id, targetId, amount, session.current_round);
      }
      return refreshBalance(session.id, investor.id, config);
    });
    res.json({ ok: true, balance: tx() });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions/:id/screen', (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const payload = statePayload(session);
    if (session.revealed) payload.leaderboard = buildLeaderboard(session);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions/:id/leaderboard', (req, res, next) => {
  try {
    res.json(buildLeaderboard(getSession(req.params.id)));
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions', requireAuth('admin'), (req, res, next) => {
  try {
    const config = normalizeConfig(req.body.config || {});
    const name = req.body.name?.trim();
    if (!name) throw httpError(400, 'NAME_REQUIRED', 'Session name is required');
    const joinCode = generateJoinCode();
    const info = db.prepare('INSERT INTO sessions (name, join_code, config_json, created_by) VALUES (?, ?, ?, ?)').run(
      name,
      joinCode,
      JSON.stringify(config),
      req.user.sub
    );
    res.json({ id: info.lastInsertRowid, join_code: joinCode });
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/sessions', requireAuth('admin'), (_req, res) => {
  res.json(db.prepare('SELECT id, name, join_code, status, revealed, created_at FROM sessions ORDER BY created_at DESC').all());
});

app.get('/api/admin/sessions/:id', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    res.json({
      ...session,
      config: parseConfig(session),
      memberships: aggregateMemberships(session.id),
      state: statePayload(session),
      leaderboard: session.revealed ? buildLeaderboard(session) : null
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/admin/sessions/:id', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const tx = transaction(() => {
      db.prepare('UPDATE sessions SET current_target_id = NULL, special_award_id = NULL WHERE id = ?').run(session.id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    });
    tx();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/admin/sessions/:id', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    if (!['draft', 'open'].includes(session.status)) throw httpError(400, 'SESSION_LOCKED', 'Can only edit draft/open sessions');
    const name = req.body.name?.trim() || session.name;
    const config = req.body.config ? normalizeConfig(req.body.config) : parseConfig(session);
    db.prepare('UPDATE sessions SET name = ?, config_json = ? WHERE id = ?').run(name, JSON.stringify(config), session.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/open', requireAuth('admin'), (req, res, next) => {
  try {
    db.prepare("UPDATE sessions SET status = 'open' WHERE id = ?").run(getSession(req.params.id).id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/start', requireAuth('admin'), (req, res, next) => {
  try {
    db.prepare("UPDATE sessions SET status = 'running', revealed = 0 WHERE id = ?").run(getSession(req.params.id).id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/round', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const targetId = Number(req.body.target_id);
    const target = db.prepare('SELECT id FROM memberships WHERE id = ? AND session_id = ?').get(targetId, session.id);
    if (!target) throw httpError(404, 'TARGET_NOT_FOUND', 'Target not found');
    const roundNo = Number(req.body.round_no || session.current_round + 1);
    db.prepare('UPDATE sessions SET current_target_id = ?, current_round = ?, window_open = 0, window_ends_at = NULL WHERE id = ?').run(targetId, roundNo, session.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/window', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const config = parseConfig(session);
    if (session.status !== 'running') throw httpError(400, 'NOT_RUNNING', 'Session is not running');
    const open = Boolean(req.body.open);
    let endsAt = null;
    if (open && req.body.duration_seconds !== null) {
      const duration = Number(req.body.duration_seconds || config.invest_window_seconds);
      endsAt = new Date(Date.now() + duration * 1000).toISOString();
    }
    db.prepare('UPDATE sessions SET window_open = ?, window_ends_at = ? WHERE id = ?').run(open ? 1 : 0, endsAt, session.id);
    res.json({ ok: true, window_ends_at: endsAt });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/next', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const members = db.prepare('SELECT id FROM memberships WHERE session_id = ? ORDER BY seat_no').all(session.id);
    const currentIndex = members.findIndex((member) => member.id === session.current_target_id);
    const nextMember = members[currentIndex + 1] || members[0];
    if (!nextMember) throw httpError(400, 'NO_MEMBERS', 'No memberships in session');
    db.prepare('UPDATE sessions SET current_target_id = ?, current_round = ?, window_open = 0, window_ends_at = NULL WHERE id = ?').run(
      nextMember.id,
      session.current_round + 1,
      session.id
    );
    res.json({ ok: true, target_id: nextMember.id });
  } catch (err) {
    next(err);
  }
});

app.put('/api/admin/sessions/:id/multipliers', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const config = parseConfig(session);
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const upsert = db.prepare(`
      INSERT INTO multipliers (session_id, target_id, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, target_id)
      DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    const tx = transaction(() => {
      for (const item of items) {
        const value = Number(item.value);
        if (Number.isNaN(value) || value < config.multiplier_min || value > config.multiplier_max) throw httpError(400, 'BAD_MULTIPLIER', 'Multiplier out of range');
        upsert.run(session.id, Number(item.target_id), value);
      }
    });
    tx();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/settle', requireAuth('admin'), (req, res, next) => {
  try {
    const session = settleSession(req.params.id);
    res.json({ ok: true, session });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/reveal', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    if (session.status !== 'settled') throw httpError(400, 'NOT_SETTLED', 'Settle before reveal');
    db.prepare('UPDATE sessions SET revealed = 1 WHERE id = ?').run(session.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/sessions/:id/special-award', requireAuth('admin'), (req, res, next) => {
  try {
    const session = getSession(req.params.id);
    const membershipId = Number(req.body.membership_id);
    const member = db.prepare('SELECT id FROM memberships WHERE id = ? AND session_id = ?').get(membershipId, session.id);
    if (!member) throw httpError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found');
    db.prepare('UPDATE sessions SET special_award_id = ? WHERE id = ?').run(membershipId, session.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/sessions/:id/memberships', requireAuth('admin'), (req, res, next) => {
  try {
    res.json(aggregateMemberships(getSession(req.params.id).id));
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.error || 'INTERNAL_ERROR', reason: err.reason || err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
