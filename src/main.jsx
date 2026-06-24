import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Crown,
  DoorOpen,
  Gauge,
  LogOut,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Rocket,
  Save,
  Shield,
  Trash2,
  Trophy
} from 'lucide-react';
import './styles.css';

const colors = ['#2DD4D9', '#A78BFA', '#60A5FA', '#FBBF24', '#F472B6', '#39E08C', '#FB7185', '#34D399', '#F97316', '#22C55E'];

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

function tokenKey(scope = detectScope()) {
  return scope === 'admin' ? 'viw_admin_token' : 'viw_group_token';
}

function detectScope() {
  return window.location.pathname.startsWith('/admin') ? 'admin' : 'group';
}

function api(path, options = {}) {
  const token = localStorage.getItem(tokenKey(options.scope));
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorMessage(data));
    return data;
  });
}

function errorMessage(data) {
  const messages = {
    USERNAME_TAKEN: '这个用户名已经被注册',
    BAD_JOIN_CODE: '场次码不正确',
    SESSION_NOT_OPEN: '这个场次还没有开放加入',
    TEAM_NAME_REQUIRED: '请填写队伍名称',
    TEAM_NAME_TAKEN: '这个队伍已经加入过本场次，请登录原来的小组账号',
    PRODUCT_TAKEN: '这个项目已经加入过本场次，请登录原来的小组账号',
    TEAM_CODE_REQUIRED: '请输入小组号',
    TEAM_NOT_FOUND: '没有找到这个小组号',
    SESSION_FULL: '这个场次的小组名额已满',
    NOT_JOINED: '当前账号还没有加入这个场次',
    WINDOW_CLOSED: '投资窗口尚未开启或已经关闭',
    NOT_CURRENT_TARGET: '只能投资当前正在路演的小组',
    SELF_INVEST_FORBIDDEN: '不能投资自己的小组',
    INSUFFICIENT_BALANCE: '可用资金不足',
    STEP_MISMATCH: '投资金额必须符合投资步长',
    LEADER_REQUIRED: '只有组长可以调整投资'
  };
  return messages[data.error] || data.reason || data.error || '请求失败';
}

function money(value) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value || 0);
}

function wan(value) {
  return `${Math.round((value || 0) / 10000)}万`;
}

function pct(value) {
  if (value == null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function teamColor(seatNo) {
  return colors[((seatNo || 1) - 1) % colors.length];
}

function formatSeconds(seconds) {
  if (seconds == null) return '--:--';
  const safe = Math.max(0, seconds);
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function statusLabel(status) {
  const labels = {
    draft: '草稿',
    open: '开放加入中',
    running: '活动进行中',
    settled: '已结算',
    ended: '已结束'
  };
  return labels[status] || status || '未知状态';
}

function normalizeInvestmentAmount(value, config, max) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  const step = config.invest_step || 1;
  const clamped = Math.min(Math.max(0, raw), max || 0);
  return Math.floor(clamped / step) * step;
}

function existingInvestmentAmount(investments, targetId) {
  return investments.find((item) => item.target_id === targetId)?.amount || 0;
}

function useCountdown(endsAt, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  if (!active || !endsAt) return null;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}

function usePoll(fn, deps, interval = 2000) {
  useEffect(() => {
    let alive = true;
    const run = () => fn().catch(() => undefined);
    run();
    const timer = setInterval(() => {
      if (alive) run();
    }, interval);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, deps);
}

function AuthPanel({ mode, onDone, initialRegister = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [register, setRegister] = useState(initialRegister);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (mode !== 'admin' && register && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    try {
      const endpoint = mode === 'admin' ? '/api/auth/admin/login' : register ? '/api/auth/register' : '/api/auth/login';
      const data = await api(endpoint, { method: 'POST', scope: mode, body: JSON.stringify({ username, password }) });
      localStorage.setItem(tokenKey(mode), data.token);
      onDone(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark"><Rocket size={28} /> 想法开张日</div>
        <h1>{mode === 'admin' ? '主办方控制台' : register ? '小组注册' : '小组登录'}</h1>
        <input placeholder="用户名" value={username} onChange={(event) => setUsername(event.target.value)} />
        <input placeholder="密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        {mode !== 'admin' && register && (
          <input placeholder="再次确认密码" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">{mode === 'admin' ? '进入控制台' : register ? '注册并进入' : '登录'}</button>
        {mode !== 'admin' && (
          <button className="ghost" type="button" onClick={() => setRegister(!register)}>
            {register ? '已有账号，去登录' : '没有账号，注册小组'}
          </button>
        )}
        {mode === 'admin' && <p className="hint">开发默认账号：admin / admin123，可用环境变量覆盖。</p>}
      </form>
    </main>
  );
}

function StatusPill({ status, open, seconds }) {
  return (
    <span className={`pill ${open ? 'live' : ''}`}>
      {open ? '投资窗口开启' : statusLabel(status)}
      {open && seconds != null && <b>{formatSeconds(seconds)}</b>}
    </span>
  );
}

function ControlButton({ icon, title, desc, onClick, className = '', disabled = false }) {
  return (
    <button className={`control-button ${className}`} onClick={onClick} disabled={disabled}>
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
    </button>
  );
}

function Header({ title, subtitle, right }) {
  return (
    <header className="topbar">
      <div>
        <div className="brand-mark"><Rocket size={22} /> 想法开张日</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="top-actions">{right}</div>
    </header>
  );
}

function NumericField({ label, value, onChange, step = 1, nullable = false }) {
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder={nullable ? '不限制' : ''}
        onChange={(event) => onChange(event.target.value === '' && nullable ? null : Number(event.target.value))}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-line">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ConfigForm({ onCreated }) {
  const [name, setName] = useState('7月正式场');
  const [config, setConfig] = useState(defaultConfig);
  const [directionsText, setDirectionsText] = useState(defaultConfig.directions.join('\n'));
  const [error, setError] = useState('');

  function update(key, value) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function updateAward(key, value) {
    setConfig((prev) => ({ ...prev, awards: { ...prev.awards, [key]: value } }));
  }

  async function createSession(event) {
    event.preventDefault();
    setError('');
    try {
      const payload = {
        ...config,
        directions: directionsText.split('\n').map((item) => item.trim()).filter(Boolean)
      };
      const data = await api('/api/admin/sessions', { method: 'POST', scope: 'admin', body: JSON.stringify({ name, config: payload }) });
      onCreated(data.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <div className="section-title"><Plus size={18} /> 新建场次</div>
      <form className="grid-form" onSubmit={createSession}>
        <label className="span-2">场次名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>

        <div className="form-group span-2">基础</div>
        <NumericField label="小组数量上限" value={config.group_count} onChange={(value) => update('group_count', value)} />
        <NumericField label="初始资金" step={10000} value={config.initial_funds} onChange={(value) => update('initial_funds', value)} />
        <NumericField label="投资步长" step={10000} value={config.invest_step} onChange={(value) => update('invest_step', value)} />

        <div className="form-group span-2">投资规则</div>
        <NumericField label="单笔最小" step={10000} value={config.min_invest_per_tx} onChange={(value) => update('min_invest_per_tx', value)} />
        <NumericField label="单笔最大" step={10000} nullable value={config.max_invest_per_tx} onChange={(value) => update('max_invest_per_tx', value)} />
        <NumericField label="单目标上限" step={10000} nullable value={config.max_invest_per_target} onChange={(value) => update('max_invest_per_target', value)} />
        <Toggle label="允许投自己" checked={config.allow_self_invest} onChange={(value) => update('allow_self_invest', value)} />
        <Toggle label="允许保留资金" checked={config.allow_hold} onChange={(value) => update('allow_hold', value)} />
        <Toggle label="允许超额投资" checked={config.allow_overdraft} onChange={(value) => update('allow_overdraft', value)} />
        <Toggle label="窗口内可修改" checked={config.allow_edit_in_window} onChange={(value) => update('allow_edit_in_window', value)} />

        <div className="form-group span-2">评审倍率</div>
        <NumericField label="加成名次" value={config.bonus_top_n} onChange={(value) => update('bonus_top_n', value)} />
        <NumericField label="倍率下限" step={0.1} value={config.multiplier_min} onChange={(value) => update('multiplier_min', value)} />
        <NumericField label="倍率上限" step={0.1} value={config.multiplier_max} onChange={(value) => update('multiplier_max', value)} />
        <NumericField label="基础倍率" step={0.1} value={config.base_multiplier} onChange={(value) => update('base_multiplier', value)} />

        <div className="form-group span-2">命题与揭榜</div>
        <label className="span-2">命题方向<textarea value={directionsText} onChange={(event) => setDirectionsText(event.target.value)} /></label>
        <Toggle label="强制选择命题方向" checked={config.force_direction} onChange={(value) => update('force_direction', value)} />
        <Toggle label="融资冠军横条" checked={config.awards.funding} onChange={(value) => updateAward('funding', value)} />
        <Toggle label="倍率冠军横条" checked={config.awards.multiplier} onChange={(value) => updateAward('multiplier', value)} />
        <Toggle label="投资冠军横条" checked={config.awards.investment} onChange={(value) => updateAward('investment', value)} />
        <NumericField label="榜单高亮前 N" value={config.leaderboard_top_n} onChange={(value) => update('leaderboard_top_n', value)} />

        <div className="rule-preview">
          融资前 {config.bonus_top_n} 名：评审给 {config.multiplier_min}x-{config.multiplier_max}x 加成 · 第 {config.bonus_top_n + 1} 名起：按 {config.base_multiplier}x 结算
        </div>
        {error && <p className="error span-2">{error}</p>}
        <button className="primary span-2" type="submit"><Save size={18} /> 创建场次</button>
      </form>
    </section>
  );
}

function AdminApp() {
  const [ready, setReady] = useState(Boolean(localStorage.getItem(tokenKey('admin'))));
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const hasTeams = Boolean(detail?.memberships?.length);

  async function loadSessions() {
    const rows = await api('/api/admin/sessions', { scope: 'admin' });
    setSessions(rows);
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
  }

  async function loadDetail(id = selectedId) {
    if (!id) return;
    const data = await api(`/api/admin/sessions/${id}`, { scope: 'admin' });
    setDetail(data);
  }

  useEffect(() => {
    if (ready) loadSessions().catch((err) => setError(err.message));
  }, [ready]);
  usePoll(() => loadDetail(), [ready, selectedId], 2000);

  async function action(path, body) {
    setError('');
    try {
      await api(path, { method: 'POST', scope: 'admin', body: body ? JSON.stringify(body) : undefined });
      await loadSessions();
      await loadDetail();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteSession(session) {
    const ok = window.confirm(`确定删除场次「${session.name}」吗？该场次的小组、投资和榜单数据都会删除。`);
    if (!ok) return;
    setError('');
    try {
      await api(`/api/admin/sessions/${session.id}`, { method: 'DELETE', scope: 'admin' });
      const rows = await api('/api/admin/sessions', { scope: 'admin' });
      setSessions(rows);
      const next = rows.find((item) => item.id !== session.id) || rows[0] || null;
      setSelectedId(next?.id || null);
      setDetail(null);
      if (next) await loadDetail(next.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveMultiplier(member, value) {
    await api(`/api/admin/sessions/${selectedId}/multipliers`, {
      method: 'PUT',
      scope: 'admin',
      body: JSON.stringify({ target_id: member.id, value: Number(value) })
    });
    loadDetail();
  }

  async function setPresentationMember(member) {
    setError('');
    try {
      const sameTarget = detail?.state?.current_target?.membership_id === member.id;
      const roundNo = sameTarget && detail.current_round ? detail.current_round : (detail.current_round || 0) + 1;
      await api(`/api/admin/sessions/${selectedId}/round`, {
        method: 'POST',
        scope: 'admin',
        body: JSON.stringify({ target_id: member.id, round_no: roundNo })
      });
      await loadDetail();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!ready) return <AuthPanel mode="admin" onDone={() => setReady(true)} />;

  return (
    <main className="app-shell">
      <Header
        title="主办方控制台"
        subtitle="创建场次、控制回合、录倍率、结算揭榜"
        right={<button className="ghost" onClick={() => { localStorage.removeItem(tokenKey('admin')); setReady(false); }}><LogOut size={17} /> 退出</button>}
      />
      <div className="admin-layout">
        <aside className="session-list">
          <ConfigForm onCreated={(id) => { setSelectedId(id); loadSessions(); }} />
          <section className="panel">
            <div className="section-title"><Shield size={18} /> 场次</div>
          {sessions.map((session) => (
              <div key={session.id} className={`session-row ${selectedId === session.id ? 'active' : ''}`}>
                <button className="session-button" onClick={() => setSelectedId(session.id)}>
                  <strong>{session.name}</strong>
                  <span>{statusLabel(session.status)} · {session.join_code}</span>
                </button>
                <button className="icon-button danger" title="删除场次" onClick={() => deleteSession(session)}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </section>
        </aside>

        <section className="panel workbench">
          {error && <p className="error">{error}</p>}
          {!detail ? <p className="muted">选择或创建一个场次。</p> : (
            <>
              <div className="control-head">
                <div>
                  <div className="section-title"><Gauge size={18} /> 现场操盘</div>
                  <h2>{detail.name}</h2>
                  <p>场次码 <b className="code">{detail.join_code}</b></p>
                </div>
                <StatusPill status={detail.status} />
              </div>

              <div className="current-strip">
                <Radio size={18} />
                <span>第 {detail.current_round || 0} 轮</span>
                <strong>{detail.state.current_target ? `当前路演：${detail.state.current_target.team_name}` : '尚未设置当前路演组'}</strong>
                <b>投资可随时调整</b>
              </div>

              <div className="control-grid">
                <ControlButton icon={<DoorOpen size={18} />} title="开放加入" desc="小组可看到场次并用场次码加入" onClick={() => action(`/api/admin/sessions/${selectedId}/open`)} />
                <ControlButton icon={<Play size={18} />} title="开始活动" desc="进入正式路演/投资阶段" onClick={() => action(`/api/admin/sessions/${selectedId}/start`)} disabled={!hasTeams} />
                <ControlButton icon={<BarChart3 size={18} />} title="一键结算" desc="计算融资榜和投资收益榜" onClick={() => action(`/api/admin/sessions/${selectedId}/settle`)} disabled={!hasTeams} />
                <ControlButton icon={<Trophy size={18} />} title="揭榜" desc="允许大屏显示榜单" className="accent" onClick={() => action(`/api/admin/sessions/${selectedId}/reveal`)} />
              </div>

              {!hasTeams && (
                <p className="empty-tip">还没有小组加入本场次。先点击“开放加入”，让参与方在小组端选择这个场次并输入场次码加入。</p>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>队伍/项目</th>
                      <th>余额</th>
                      <th>融资</th>
                      <th>投出</th>
                      <th>评审倍率</th>
                      <th>结算</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.memberships.map((member) => {
                      const isCurrent = detail.state.current_target?.membership_id === member.id;
                      return (
                      <tr key={member.id} className={isCurrent ? 'current-row' : ''}>
                        <td>
                          <span className="dot" style={{ background: teamColor(member.seat_no) }} />
                          {member.team_name}
                          <small>{member.product || '未填项目'}{isCurrent ? ' · 当前路演' : ''}</small>
                        </td>
                        <td>{wan(member.balance)}</td>
                        <td>{wan(member.funding_total)}</td>
                        <td>{wan(member.invest_total)}</td>
                        <td>
                          <input
                            className="tiny-input"
                            type="number"
                            min={detail.config.multiplier_min}
                            max={detail.config.multiplier_max}
                            step="0.1"
                            defaultValue={member.multiplier || detail.config.base_multiplier}
                            onBlur={(event) => saveMultiplier(member, event.target.value)}
                          />
                        </td>
                        <td>{member.effective_multiplier ? `${member.effective_multiplier}x · ${wan(member.valuation)}` : '-'}</td>
                        <td>
                          <button className="row-action row-action-open" disabled={detail.status !== 'running' || isCurrent} onClick={() => setPresentationMember(member)}>
                            {isCurrent ? '当前路演' : '设为路演'}
                          </button>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function MoneyBlocks({ count, color, className = '', burstKey = 0 }) {
  return Array.from({ length: count }, (_, index) => (
    <span
      key={`${burstKey}-${index}`}
      className={`money-block ${className}`}
      style={color ? { '--chip': color } : undefined}
    />
  ));
}

function TeamMap({ teams = [], investments = [], selectedTargetId, presentationTargetId, myMembershipId, onSelect, config, balance = 0, chipBurst }) {
  const freeBlocks = Math.min(240, Math.round(balance / config.invest_step));
  return (
    <section className="chip-table-card">
      <div className="map-head">
        <div className="section-title"><Radio size={18} /> 资金桌</div>
        <div className="map-balance">
          <span>可用资金</span>
          <strong>{money(balance)}</strong>
        </div>
      </div>
      <div className="chip-table">
        <div className="chip-bank">
          <div>
            <b>我的资金</b>
            <span>每格 {wan(config.invest_step)}</span>
          </div>
          <div className="chip-bank-tray">
            <MoneyBlocks count={freeBlocks} />
          </div>
        </div>

        <div className="project-zones">
          {teams.map((team) => {
            const invested = existingInvestmentAmount(investments, team.membership_id);
            const investedBlocks = Math.min(80, Math.round(invested / config.invest_step));
            const isSelected = selectedTargetId === team.membership_id;
            const isSelf = myMembershipId === team.membership_id;
            const isPresenting = presentationTargetId === team.membership_id;
            const members = team.member_names || team.leader_username || '暂无成员';
            return (
              <button
                key={team.membership_id}
                className={`team-tile ${isSelected ? 'current' : ''} ${isPresenting ? 'presenting' : ''} ${isSelf ? 'self' : ''}`}
                style={{ '--team': teamColor(team.seat_no) }}
                disabled={isSelf}
                onClick={() => onSelect(team)}
              >
                <div className="team-tile-head">
                  {isPresenting && <b className="presenting-badge">路演中</b>}
                  {isSelf && <b>我的组</b>}
                  {isSelected && <b>已选择</b>}
                </div>
                <strong>{team.team_name}</strong>
                <p>{team.product || '未填写项目'} · {team.direction || '未选择方向'}</p>
                <p>组员：{members}</p>
                <div className="chip-zone">
                  {investedBlocks > 0 ? (
                    <MoneyBlocks
                      count={investedBlocks}
                      color={teamColor(team.seat_no)}
                      className="invested"
                      burstKey={chipBurst?.targetId === team.membership_id ? chipBurst.key : 0}
                    />
                  ) : <span>未下注</span>}
                </div>
                <em>{invested > 0 ? `已投 ${wan(invested)}` : '未投资'}</em>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PlayApp() {
  const [ready, setReady] = useState(Boolean(localStorage.getItem(tokenKey('group'))));
  const [forceAuth, setForceAuth] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const [account, setAccount] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [state, setState] = useState(null);
  const [me, setMe] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinMode, setJoinMode] = useState('create');
  const [joinTeamCode, setJoinTeamCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [product, setProduct] = useState('');
  const [direction, setDirection] = useState('生产力硬件');
  const [amount, setAmount] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [chipBurst, setChipBurst] = useState(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  async function loadSessions() {
    const currentAccount = await api('/api/me', { scope: 'group' });
    setAccount(currentAccount);
    const rows = await api('/api/sessions', { scope: 'group' });
    setSessions(rows);
    const joined = rows.find((row) => row.joined);
    if (!sessionId && joined) setSessionId(joined.id);
  }

  async function loadPlayState(id = sessionId) {
    if (!id) return;
    const [stateData, meData] = await Promise.all([
      api(`/api/sessions/${id}/state`, { scope: 'group' }),
      api(`/api/sessions/${id}/me`, { scope: 'group' }).catch(() => null)
    ]);
    setState(stateData);
    setMe(meData);
    if (!selectedTargetId && stateData.teams?.length) {
      const firstTarget = stateData.teams.find((team) => team.membership_id !== stateData.my_membership_id);
      if (firstTarget) setSelectedTargetId(firstTarget.membership_id);
    }
  }

  useEffect(() => {
    if (ready) loadSessions().catch((err) => setError(err.message));
  }, [ready, authVersion]);
  usePoll(() => loadPlayState(), [ready, sessionId], 2000);

  async function joinSession(event) {
    event.preventDefault();
    setError('');
    try {
      await api(`/api/sessions/${sessionId}/join`, {
        method: 'POST',
        scope: 'group',
        body: JSON.stringify({
          join_code: joinCode,
          mode: joinMode,
          team_code: joinTeamCode,
          team_name: teamName,
          product,
          direction
        })
      });
      await loadSessions();
      await loadPlayState();
    } catch (err) {
      setError(err.message);
    }
  }

  async function leaveSession() {
    if (!sessionId || !me?.membership) return;
    const message = me.membership.member_role === 'leader'
      ? `你是「${me.membership.team_name}」的组长，退出会删除这个小组及其投资数据。确定继续吗？`
      : `确定退出「${me.membership.team_name}」吗？`;
    if (!window.confirm(message)) return;
    setError('');
    try {
      await api(`/api/sessions/${sessionId}/join`, { method: 'DELETE', scope: 'group' });
      setMe(null);
      setSelectedTargetId(null);
      setAmount(0);
      await loadSessions();
      await loadPlayState();
    } catch (err) {
      setError(err.message);
    }
  }

  function selectInvestmentTarget(team) {
    setSelectedTargetId(team.membership_id);
    setAmount(existingInvestmentAmount(me?.investments || [], team.membership_id));
  }

  async function invest(value = amount) {
    if (!selectedTargetId) return;
    setError('');
    try {
      const normalizedAmount = normalizeInvestmentAmount(value, config, maxInvest);
      await api(`/api/sessions/${sessionId}/investment`, {
        method: 'PUT',
        scope: 'group',
        body: JSON.stringify({ target_id: selectedTargetId, amount: normalizedAmount })
      });
      setToast('投资已确认');
      setAmount(normalizedAmount);
      setChipBurst({ targetId: selectedTargetId, key: Date.now() });
      await loadPlayState();
      setTimeout(() => setToast(''), 1800);
    } catch (err) {
      setError(err.message);
    }
  }

  const config = state?.config || defaultConfig;
  const selectedTeam = state?.teams?.find((team) => team.membership_id === selectedTargetId);
  const isLeader = state?.my_member_role === 'leader';
  const canInvest = isLeader && state?.status === 'running' && selectedTargetId && selectedTargetId !== state.my_membership_id;
  const currentColor = teamColor(selectedTeam?.seat_no || 1);
  const currentTargetInvested = existingInvestmentAmount(me?.investments || [], selectedTargetId);
  const maxInvest = (me?.membership?.balance || 0) + currentTargetInvested;

  if (!ready || forceAuth) {
    return (
      <AuthPanel
        mode="group"
        initialRegister={forceAuth}
        onDone={() => {
          setAccount(null);
          setSessions([]);
          setSessionId(null);
          setState(null);
          setMe(null);
          setSelectedTargetId(null);
          setForceAuth(false);
          setReady(true);
          setAuthVersion((value) => value + 1);
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <Header
        title="小组投资端"
        subtitle={
          <span className="identity-line">
            <b>账号：{account?.username || '读取中'}</b>
            <span>{state ? state.name : '未选择场次'}</span>
            <span>{me?.membership ? `${me.membership.team_name} · 小组号 ${me.membership.team_code} · ${me.membership.member_role === 'leader' ? '组长' : '成员'}` : '尚未加入队伍'}</span>
          </span>
        }
        right={
          <>
            <button className="ghost" onClick={() => { localStorage.removeItem(tokenKey('group')); setAccount(null); setSessions([]); setSessionId(null); setMe(null); setState(null); setSelectedTargetId(null); setForceAuth(true); }}>
              <Plus size={17} /> 注册/切换小组
            </button>
            <button className="ghost" onClick={() => { localStorage.removeItem(tokenKey('group')); setAccount(null); setSessions([]); setSessionId(null); setMe(null); setState(null); setSelectedTargetId(null); setReady(false); }}>
              <LogOut size={17} /> 退出
            </button>
          </>
        }
      />
      {toast && <div className="toast">{toast}</div>}
      {error && <p className="error">{error}</p>}

      {state?.teams?.length > 0 && (
        <TeamMap
          teams={state.teams}
          investments={me?.investments || []}
          selectedTargetId={selectedTargetId}
          presentationTargetId={state.current_target?.membership_id}
          myMembershipId={state.my_membership_id}
          onSelect={selectInvestmentTarget}
          config={config}
          balance={me?.membership?.balance || 0}
          chipBurst={chipBurst}
        />
      )}

      <div className="play-layout">
        <section className="panel">
          <div className="section-title"><Radio size={18} /> 投资设置</div>
          {selectedTeam ? (
            <div className="selected-investment-card" style={{ '--team': teamColor(selectedTeam.seat_no) }}>
              <span>当前投资对象</span>
              <strong>{selectedTeam.team_name}</strong>
              <p>{selectedTeam.product || '未填写项目'} · {selectedTeam.direction || '未选择方向'}</p>
              {!isLeader && <p>成员账号仅可观看，投资由组长操作。</p>}
            </div>
          ) : <p className="muted">先在上方小组地图里选择一个小组。</p>}

          <div className="invest-box">
            <input
              type="range"
              min="0"
              max={maxInvest}
              step={config.invest_step}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
              disabled={!canInvest}
            />
            <div className="amount-line">{wan(amount)}</div>
            <div className="quick-row">
              {[0.1, 0.25, 0.5, 1].map((ratio) => (
                <button key={ratio} disabled={!canInvest} onClick={() => setAmount(Math.floor((maxInvest * ratio) / config.invest_step) * config.invest_step)}>
                  {ratio === 1 ? 'ALL IN' : `${ratio * 100}%`}
                </button>
              ))}
              <button disabled={!selectedTargetId} onClick={() => invest(0)}>清空</button>
            </div>
            <button className="primary invest-button" style={{ '--team': currentColor }} disabled={!canInvest || amount < 0} onClick={() => invest()}>
              {isLeader ? '确认投资' : '成员只读'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="section-title"><DoorOpen size={18} /> 加入场次</div>
          <div className="account-card">
            <span>当前账号</span>
            <strong>{account?.username || '读取中'}</strong>
            <p>{me?.membership ? `已作为「${me.membership.team_name}」加入 · 小组号 ${me.membership.team_code} · ${me.membership.member_role === 'leader' ? '组长' : '成员'}` : '当前账号还没有加入所选场次'}</p>
            {me?.membership && <button className="ghost leave-button" onClick={leaveSession}>退出小组</button>}
          </div>
          <select
            value={sessionId || ''}
            onChange={(event) => {
              setSessionId(Number(event.target.value));
              setState(null);
              setMe(null);
              setAmount(0);
              setSelectedTargetId(null);
            }}
          >
            <option value="" disabled>选择场次</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {statusLabel(session.status)}{session.joined ? ' · 已加入' : ''}</option>)}
          </select>
          {!me && sessionId && (
            <form className="join-form" onSubmit={joinSession}>
              <div className="mode-switch">
                <button type="button" className={joinMode === 'create' ? 'active' : ''} onClick={() => setJoinMode('create')}>创建小组</button>
                <button type="button" className={joinMode === 'join' ? 'active' : ''} onClick={() => setJoinMode('join')}>加入小组</button>
              </div>
              <input placeholder="场次码" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
              {joinMode === 'create' ? (
                <>
                  <input placeholder="队伍名称" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
                  <input placeholder="产品/项目名" value={product} onChange={(event) => setProduct(event.target.value)} />
                  <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                    <option>生产力硬件</option>
                    <option>运动健康硬件</option>
                    <option>AI+新型硬件</option>
                  </select>
                </>
              ) : (
                <input placeholder="输入小组号" value={joinTeamCode} onChange={(event) => setJoinTeamCode(event.target.value.toUpperCase())} />
              )}
              <button className="primary" type="submit">加入</button>
            </form>
          )}
          <div className="section-title portfolio-title"><BarChart3 size={18} /> 我的投资组合</div>
          {(me?.investments || []).map((investment) => (
            <div className="holding" key={investment.target_id}>
              <span className="dot" style={{ background: teamColor(investment.target_seat) }} />
              <strong>{investment.target_team}</strong>
              <span>{wan(investment.amount)}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function LeaderboardBars({ title, rows, metric, formatter, highlightTop = 3 }) {
  const normalized = rows.map((row) => ({ ...row, metric_value: row[metric] ?? 0 }));
  const max = Math.max(1, ...normalized.map((row) => Math.abs(row.metric_value)));
  return (
    <section className="screen-board">
      <div className="board-title">
        <h2>{title}</h2>
        <span>TOP {highlightTop} 高亮</span>
      </div>
      <div className="bars">
        {normalized.map((row, index) => (
          <div
            className={`bar-card ${index < highlightTop ? 'podium' : ''}`}
            key={row.membership_id || row.id}
            style={{ '--team': teamColor(row.seat_no), '--delay': `${index * 140}ms` }}
          >
            <div className="rank">{index === 0 ? <Crown size={30} /> : `#${index + 1}`}</div>
            <div className="bar-track">
              <div className="bar-fill" style={{ height: `${Math.max(8, (Math.abs(row.metric_value) / max) * 100)}%` }} />
            </div>
            <strong>{row.team_name}</strong>
            <span>{row.product || row.direction || ''}</span>
            <b>{formatter(row[metric])}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScreenApp() {
  const params = new URLSearchParams(window.location.search);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(params.get('session') || '');
  const [screen, setScreen] = useState(null);
  const [replayKey, setReplayKey] = useState(0);
  const seconds = useCountdown(screen?.window_ends_at, screen?.window_open);
  const highlightTop = screen?.config?.leaderboard_top_n || 3;
  const champion = screen?.leaderboard?.funding?.[0];
  const multiplierChampion = screen?.leaderboard?.multiplier?.[0];
  const investmentChampion = screen?.leaderboard?.investment?.[0];

  useEffect(() => {
    api('/api/public/sessions', { scope: 'group' }).then((rows) => {
      setSessions(rows);
      if (!sessionId && rows[0]) setSessionId(String(rows[0].id));
    }).catch(() => undefined);
  }, []);
  usePoll(async () => {
    if (sessionId) setScreen(await api(`/api/sessions/${sessionId}/screen`, { scope: 'group' }));
  }, [sessionId], 2000);

  return (
    <main className="screen-shell">
      <div className="screen-top">
        <div>
          <div className="brand-mark"><Rocket size={24} /> 想法开张日</div>
          <h1>{screen?.name || '大屏'}</h1>
        </div>
        <div className="screen-controls">
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
            <option value="">选择场次</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
          </select>
          <button onClick={() => setReplayKey((key) => key + 1)}><RefreshCcw size={18} /> 重播</button>
        </div>
      </div>

      {!screen?.revealed ? (
        <section className="waiting-screen">
          <StatusPill status={screen?.status || '等待中'} open={screen?.window_open} seconds={seconds} />
          <h2>{screen?.current_target ? `${screen.current_target.team_name} 正在路演` : '等待主办方揭榜'}</h2>
          <p>{screen?.current_target?.team_name || '榜单将在揭榜后显示'}</p>
          {screen?.window_open && <div className="screen-timer">{seconds == null ? '不限时' : formatSeconds(seconds)}</div>}
        </section>
      ) : (
        <div className="screen-stack" key={replayKey}>
          {screen.config?.awards?.funding && (
            <section className="reveal-hero">
              <div className="hero-award">
                <span>融资冠军</span>
                <h2>{champion ? champion.team_name : '榜单揭晓'}</h2>
                <p>{champion ? `${wan(champion.funding_total)} × ${champion.effective_multiplier}x = ${wan(champion.valuation)} 估值` : ''}</p>
              </div>
            </section>
          )}
          {screen.config?.awards?.multiplier && (
            <section className="reveal-hero reveal-hero-secondary">
              <div className="hero-award">
                <span>倍率冠军</span>
                <h2>{multiplierChampion ? `${multiplierChampion.effective_multiplier}x` : '-'}</h2>
                <p>{multiplierChampion ? `${multiplierChampion.team_name} · ${wan(multiplierChampion.funding_total)} 融资` : ''}</p>
              </div>
            </section>
          )}
          {screen.config?.awards?.investment && (
            <section className="reveal-hero reveal-hero-tertiary">
              <div className="hero-award">
                <span>投资冠军</span>
                <h2>{investmentChampion ? wan(investmentChampion.invest_net) : '-'}</h2>
                <p>{investmentChampion ? `${investmentChampion.team_name} · 收益率 ${pct(investmentChampion.invest_roi)}` : ''}</p>
              </div>
            </section>
          )}
          <LeaderboardBars title="融资榜" rows={screen.leaderboard.funding} metric="funding_total" formatter={wan} highlightTop={highlightTop} />
          <LeaderboardBars title="评审倍率榜" rows={screen.leaderboard.multiplier || []} metric="effective_multiplier" formatter={(value) => `${value}x`} highlightTop={highlightTop} />
          <LeaderboardBars title="投资收益榜" rows={screen.leaderboard.investment} metric="invest_roi" formatter={pct} highlightTop={highlightTop} />
        </div>
      )}
    </main>
  );
}

function Home() {
  return (
    <main className="login-shell">
      <div className="login-panel">
        <div className="brand-mark"><Rocket size={28} /> 想法开张日</div>
        <h1>虚拟投资工作坊</h1>
        <a className="primary link-button" href="/admin">主办方控制台</a>
        <a className="ghost link-button" href="/play">小组投资端</a>
        <a className="ghost link-button" href="/screen">大屏</a>
      </div>
    </main>
  );
}

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return <AdminApp />;
  if (path.startsWith('/play')) return <PlayApp />;
  if (path.startsWith('/screen')) return <ScreenApp />;
  return <Home />;
}

createRoot(document.getElementById('root')).render(<App />);
