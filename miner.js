// Miner Mania: 2 to 4 miners race down through a side-view mine. Dirt breaks in one hit, stone in three, and bedrock
// not at all. Open space below you means you fall. First to reach the ruby at the bottom wins.
(() => {
  // ── The mine ─────────────────────────────────────────────────────────────
  const W = 21, H = 46, CX = (W - 1) / 2;
  const AIR = 0, DIRT = 1, STONE = 2, BEDROCK = 3, RUBY = 4;
  const HITS = { [DIRT]: 1, [STONE]: 3, [RUBY]: 1 };
  const SURFACE = 2;               // first row of ground; miners start standing on it
  const RUBY_Y = H - 3;
  const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
  const COLOR_NAMES = ['Red', 'Blue', 'Yellow', 'Green'];
  const MAX_PLAYERS = COLORS.length;

  // A seeded random number generator, so every device builds the same mine from the room's seed.
  function rng(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // Where each miner starts. Miners farther from the middle start deeper, in a shaft that's already dug,
  // so everyone is the same number of digs from the ruby.
  function spawns(n) {
    const xs = n === 1 ? [CX] : n === 2 ? [CX - 4, CX + 4] : n === 3 ? [CX - 6, CX, CX + 6] : [CX - 8, CX - 3, CX + 3, CX + 8];
    const near = Math.min(...xs.map(x => Math.abs(x - CX)));
    return xs.map(x => ({ x, y: SURFACE - 1 + (Math.abs(x - CX) - near) }));
  }

  // Build the mine: the left half at random, mirrored onto the right so it's fair.
  function buildMine(seed, n) {
    const r = rng(seed), g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill(y < SURFACE ? AIR : DIRT));
    const set = (x, y, t) => { if (x > 0 && x < W - 1 && y >= SURFACE && y < H - 1) { g[y][x] = t; g[y][W - 1 - x] = t; } };
    // Stone blobs, more of them deeper down.
    for (let y = SURFACE + 2; y < H - 4; y++) for (let x = 1; x <= CX; x++) {
      if (r() < 0.05 + 0.18 * (y / H)) { set(x, y, STONE); if (r() < 0.6) set(x + (r() < 0.5 ? 1 : -1), y, STONE); if (r() < 0.4) set(x, y + 1, STONE); }
    }
    // Bedrock bars to dig around: short and spaced out, so there's always a way past. About 3 in 10 reach the middle
    // column, where they join their mirror image into one wide bar right over the ruby's column.
    for (let y = SURFACE + 4; y < H - 6; y += 3 + Math.floor(r() * 3)) {
      const len = 2 + Math.floor(r() * 3), x0 = r() < 0.3 ? CX - len + 1 : 2 + Math.floor(r() * (CX - len - 1));
      for (let x = x0; x < x0 + len; x++) set(x, y, BEDROCK);
    }
    // A stone shell around the ruby.
    for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) set(CX + dx, RUBY_Y + dy, STONE);
    // Walls and floor.
    for (let y = 0; y < H; y++) { if (y >= SURFACE) { g[y][0] = BEDROCK; g[y][W - 1] = BEDROCK; } }
    g[H - 1].fill(BEDROCK);
    g[RUBY_Y][CX] = RUBY;
    // Starting shafts, with no bedrock right under anyone's start.
    for (const s of spawns(n)) {
      for (let y = SURFACE; y <= s.y; y++) g[y][s.x] = AIR;
      for (let y = s.y + 1; y < s.y + 5; y++) if (g[y][s.x] === BEDROCK) g[y][s.x] = DIRT;
    }
    return g;
  }

  // ── Online rooms ─────────────────────────────────────────────────────────
  // Bump with the ?v= on the script in index.html whenever what goes in the room changes.
  const VERSION = 1;
  const OUTDATED = 'That room is using a different version of Miner Mania. Everyone needs to refresh the page.';
  const ROOMS = 'minermania/rooms';

  const db = window.firebase ? (firebase.initializeApp({
    apiKey:            'AIzaSyAsJboNGVuESMhkivllUD0o8MUB5LUCMRQ',
    authDomain:        'kvgames.firebaseapp.com',
    databaseURL:       'https://kvgames-default-rtdb.firebaseio.com',
    projectId:         'kvgames',
    storageBucket:     'kvgames.firebasestorage.app',
    messagingSenderId: '463308384695',
    appId:             '1:463308384695:web:5d57623ebd52101ad26032',
  }), firebase.database()) : null;
  let clockOffset = 0;  // server clock minus ours, so every device starts the countdown together
  if (db) db.ref('.info/serverTimeOffset').on('value', s => { clockOffset = s.val() || 0; });
  const now = () => Date.now() + clockOffset;

  const $ = id => document.getElementById(id);
  const show = id => {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    if (id !== 'game') { $('over').hidden = true; $('count').hidden = true; }
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  // The room is split in two: meta (players, phase, seed: changes rarely) and live (positions and dug cells:
  // changes all the time), so fast-changing positions don't resend everything.
  let room = null;  // { code, ref, meta, pos, joining, listeners }

  const playerList = meta => Object.entries((meta && meta.players) || {}).filter(([, p]) => p && p.name)
    .map(([id, p]) => ({ id, ...p })).sort((a, b) => a.slot - b.slot);

  function genCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function busy(on) { for (const b of document.querySelectorAll('#menu button')) b.disabled = on; }
  function myName() {
    const name = $('name').value.trim().slice(0, 14);
    if (!name) { $('menu-error').textContent = 'Type your name first.'; $('name').focus(); return null; }
    store.set('minermania-name', name);
    return name;
  }
  const NO_SERVER = "Can't reach the game server. Check the internet connection.";

  async function createRoom(name) {
    if (!db) { $('menu-error').textContent = NO_SERVER; return; }
    busy(true);
    $('menu-error').textContent = '';
    try {
      let code, ref;
      for (let i = 0; i < 10; i++) {
        code = genCode();
        ref = db.ref(`${ROOMS}/${code}`);
        if (!(await ref.child('meta').get()).exists()) break;
      }
      await ref.set({ meta: { host: myId, v: VERSION, created: firebase.database.ServerValue.TIMESTAMP, phase: 'lobby',
        players: { [myId]: { name, slot: 0 } } } });
      ref.onDisconnect().remove();
      await enterRoom(code, ref);
    } catch (e) {
      $('menu-error').textContent = "Couldn't create a room. Check the internet connection.";
    }
    busy(false);
  }

  async function joinRoom(code, name) {
    if (!db) { $('menu-error').textContent = NO_SERVER; return; }
    busy(true);
    $('menu-error').textContent = '';
    const ref = db.ref(`${ROOMS}/${code}`);
    try {
      const meta = await enterRoom(code, ref, true);
      const problem = !meta || !meta.host ? `There's no room ${code}.` : meta.v !== VERSION ? OUTDATED
        : meta.phase !== 'lobby' ? 'That race has already started. Wait for it to finish, then join.'
        : playerList(meta).length >= MAX_PLAYERS ? `That room is full (${MAX_PLAYERS} players).` : null;
      if (problem) throw new Error(problem);
      // A transaction, so two people joining at once can't take the same color.
      const res = await ref.child('meta/players').transaction(cur => {
        if (!cur) return;
        const taken = new Set(Object.values(cur).filter(p => p && p.name).map(p => p.slot));
        const slot = COLORS.findIndex((_, i) => !taken.has(i));
        if (slot < 0) return;
        cur[myId] = { name, slot };
        return cur;
      });
      if (!res.committed) throw new Error(`That room is full (${MAX_PLAYERS} players).`);
      ref.child(`meta/players/${myId}`).onDisconnect().remove();
      ref.child(`live/pos/${myId}`).onDisconnect().remove();
      room.joining = false;
      render();
    } catch (e) {
      leaveRoom();
      show('menu');
      $('menu-error').textContent = e.message && !/^FIREBASE|permission/i.test(e.message) ? e.message
        : "Couldn't join. Check the code and the internet connection.";
    }
    busy(false);
  }

  // Start listening to the room. Resolves with its first meta, so a join can check it before taking a seat.
  function enterRoom(code, ref, joining = false) {
    leaveRoom();
    room = { code, ref, meta: null, pos: {}, joining, listeners: [] };
    const r = room;
    const listen = (path, ev, fn) => { const q = ref.child(path); q.on(ev, fn); r.listeners.push([q, ev, fn]); };
    listen('live/pos', 'value', snap => { if (room === r) r.pos = snap.val() || {}; });
    listen('live/dug', 'child_added', snap => { if (room === r && game) breakCell(Number(snap.key), false); });
    return new Promise(resolve => {
      listen('meta', 'value', snap => {
        if (room !== r) return;
        r.meta = snap.val();
        if (resolve) { const f = resolve; resolve = null; f(r.meta); if (joining) return; }
        if (!r.joining) render();
      });
    });
  }
  function leaveRoom() {
    const r = room;
    if (!r) return;
    room = null;
    game = null;
    for (const [q, ev, fn] of r.listeners) q.off(ev, fn);
    if (r.meta && r.meta.host === myId) { r.ref.onDisconnect().cancel(); r.ref.remove(); }
    else if (!r.joining) {
      for (const path of [`meta/players/${myId}`, `live/pos/${myId}`]) { const c = r.ref.child(path); c.onDisconnect().cancel(); c.remove(); }
    }
  }

  function startRace() {
    const meta = room && room.meta;
    if (!meta || meta.host !== myId) return;
    room.ref.child('live').remove();
    room.ref.child('meta').update({ phase: 'play', seed: Math.floor(Math.random() * 2 ** 31), order: playerList(meta).map(p => p.id),
      startAt: now() + 3600, winner: null, winTime: null });
  }
  function playAgain() {
    if (!room || !room.meta || room.meta.host !== myId) return;
    room.ref.child('live').remove();
    room.ref.child('meta').update({ phase: 'lobby', seed: null, order: null, startAt: null, winner: null, winTime: null });
  }

  // ── The race ─────────────────────────────────────────────────────────────
  // game: { seed, grid, hits, me: {x, y}, ... } — rebuilt for each race.
  let game = null;
  const held = new Set();     // directions being held: 'left', 'right', 'down'
  const DIG_EVERY = 115, FALL_EVERY = 60, WALK_EVERY = 95;

  function newGame(meta) {
    const order = (meta.order ? Object.values(meta.order) : []).filter(Boolean);
    const n = Math.max(1, order.length), at = spawns(n)[Math.max(0, order.indexOf(myId))];
    game = { seed: meta.seed, order, grid: buildMine(meta.seed, n), hits: {}, me: { x: at.x, y: at.y }, next: 0,
      cam: at.y, sent: '', sendAt: 0, shown: {}, shake: 0, won: false };
    sendPos(true);
  }
  const cellAt = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? BEDROCK : game.grid[y][x];

  // A cell broke, here or on someone else's device.
  function breakCell(i, mine) {
    const x = i % W, y = Math.floor(i / W);
    if (!game || cellAt(x, y) === AIR || cellAt(x, y) === BEDROCK) return;
    const was = game.grid[y][x];
    game.grid[y][x] = AIR;
    delete game.hits[i];
    if (mine) { room.ref.child(`live/dug/${i}`).set(1); sfx.crunch(was === STONE); }
    for (let k = 0; k < (was === STONE ? 7 : 4); k++) particles.push({ x: x + 0.5, y: y + 0.5, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5, life: 0.6, c: was === STONE ? '#9aa0a6' : '#8a5a32' });
  }

  function sendPos(force) {
    if (!room || !game) return;
    const key = game.me.x + ',' + game.me.y;
    if (!force && (key === game.sent || performance.now() < game.sendAt)) return;
    game.sent = key; game.sendAt = performance.now() + 60;
    room.ref.child(`live/pos/${myId}`).set({ x: game.me.x, y: game.me.y });
  }

  function claimRuby() {
    if (game.won) return;
    game.won = true;
    sfx.win();
    const time = now() - room.meta.startAt;
    // Whoever's claim lands first is the winner, and their time is the winning time.
    room.ref.child('meta/winner').transaction(cur => cur || myId).then(res => {
      if (res.committed && res.snapshot.val() === myId) room.ref.child('meta/winTime').set(time);
    });
    room.ref.child('meta/phase').set('over');
  }

  // One step of my miner: fall if there's nothing under me, otherwise walk or dig the way I'm pushing.
  function step(t) {
    const m = room && room.meta;
    if (!game || !m || m.phase !== 'play' || now() < m.startAt || t < game.next) return;
    const { me } = game;
    if (cellAt(me.x, me.y + 1) === AIR) { me.y++; game.next = t + FALL_EVERY; sendPos(); return; }
    const dir = held.has('down') ? [0, 1] : held.has('left') ? [-1, 0] : held.has('right') ? [1, 0] : null;
    if (!dir) return;
    const tx = me.x + dir[0], ty = me.y + dir[1], c = cellAt(tx, ty), i = ty * W + tx;
    if (c === AIR) { me.x = tx; me.y = ty; game.next = t + WALK_EVERY; sendPos(); return; }
    if (c === BEDROCK) { game.shake = 0.15; sfx.clank(); game.next = t + 250; return; }
    game.hits[i] = (game.hits[i] || 0) + 1;
    game.next = t + DIG_EVERY;
    if (game.hits[i] >= HITS[c]) {
      if (c === RUBY) { me.x = tx; me.y = ty; sendPos(true); claimRuby(); return; }
      breakCell(i, true);
    } else sfx.tink();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  const canvas = $('canvas'), g2 = canvas.getContext('2d');
  let particles = [], lastFrame = performance.now(), T = 24;

  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    T = r.width / W;
  }
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));

  // Little specks so dirt and stone don't look flat; the same specks every frame for each cell.
  const speck = (x, y, k) => ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0;

  function drawCell(x, y, sx, sy) {
    const c = game.grid[y][x];
    if (c === AIR) {
      g2.fillStyle = y < SURFACE ? 'transparent' : '#1a120c';
      if (y >= SURFACE) g2.fillRect(sx, sy, T + 0.5, T + 0.5);
      return;
    }
    if (c === RUBY) {
      g2.fillStyle = '#1a120c'; g2.fillRect(sx, sy, T + 0.5, T + 0.5);
      const pulse = 1 + 0.08 * Math.sin(performance.now() / 200);
      g2.save(); g2.translate(sx + T / 2, sy + T / 2); g2.scale(pulse, pulse);
      g2.fillStyle = '#e0115f'; g2.beginPath();
      g2.moveTo(0, -T * 0.4); g2.lineTo(T * 0.38, -T * 0.08); g2.lineTo(0, T * 0.42); g2.lineTo(-T * 0.38, -T * 0.08); g2.closePath(); g2.fill();
      g2.fillStyle = 'rgba(255,255,255,.55)'; g2.beginPath(); g2.moveTo(-T * 0.12, -T * 0.25); g2.lineTo(T * 0.05, -T * 0.25); g2.lineTo(-T * 0.05, -T * 0.05); g2.closePath(); g2.fill();
      g2.restore();
      return;
    }
    g2.fillStyle = c === DIRT ? '#7a4f2a' : c === STONE ? '#6f747a' : '#26262e';
    g2.fillRect(sx, sy, T + 0.5, T + 0.5);
    g2.fillStyle = c === DIRT ? '#93633a' : c === STONE ? '#8d939a' : '#3a3a46';
    for (let k = 0; k < 3; k++) { const h = speck(x, y, k); g2.fillRect(sx + (h % 100) / 100 * (T - 4), sy + ((h >> 8) % 100) / 100 * (T - 4), Math.max(2, T / 8), Math.max(2, T / 8)); }
    if (y === SURFACE && c === DIRT) { g2.fillStyle = '#5fbf4a'; g2.fillRect(sx, sy, T + 0.5, Math.max(3, T / 5)); }
    // Cracks on stone that's been hit.
    const hits = game.hits[y * W + x];
    if (hits) {
      g2.strokeStyle = 'rgba(0,0,0,.6)'; g2.lineWidth = Math.max(1.5, T / 14); g2.beginPath();
      g2.moveTo(sx + T * 0.2, sy + T * 0.3); g2.lineTo(sx + T * 0.5, sy + T * 0.5); g2.lineTo(sx + T * 0.4, sy + T * 0.8);
      if (hits > 1) { g2.moveTo(sx + T * 0.5, sy + T * 0.5); g2.lineTo(sx + T * 0.85, sy + T * 0.35); }
      g2.stroke();
    }
  }

  function drawMiner(px, py, color, name, me) {
    const x = px * T, y = py * T;
    // Body, head, helmet with lamp, pickaxe.
    g2.fillStyle = '#3b3f58'; g2.fillRect(x + T * 0.28, y + T * 0.5, T * 0.44, T * 0.5);
    g2.fillStyle = '#f2c9a0'; g2.beginPath(); g2.arc(x + T / 2, y + T * 0.42, T * 0.2, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = color; g2.beginPath(); g2.arc(x + T / 2, y + T * 0.34, T * 0.24, Math.PI, 0); g2.fill();
    g2.fillRect(x + T * 0.22, y + T * 0.32, T * 0.56, T * 0.06);
    g2.fillStyle = '#fff6a8'; g2.beginPath(); g2.arc(x + T / 2, y + T * 0.22, T * 0.07, 0, Math.PI * 2); g2.fill();
    g2.strokeStyle = '#c9a26b'; g2.lineWidth = Math.max(2, T / 10); g2.beginPath(); g2.moveTo(x + T * 0.75, y + T * 0.95); g2.lineTo(x + T * 0.9, y + T * 0.45); g2.stroke();
    g2.strokeStyle = '#b8c0c8'; g2.beginPath(); g2.moveTo(x + T * 0.72, y + T * 0.45); g2.quadraticCurveTo(x + T * 0.92, y + T * 0.32, x + T * 1.05, y + T * 0.5); g2.stroke();
    // Name tag.
    g2.font = `600 ${Math.max(11, T * 0.42)}px Fredoka, system-ui, sans-serif`; g2.textAlign = 'center';
    g2.lineWidth = 3; g2.strokeStyle = 'rgba(0,0,0,.7)'; g2.strokeText(me ? 'You' : name, x + T / 2, y - T * 0.08);
    g2.fillStyle = color; g2.fillText(me ? 'You' : name, x + T / 2, y - T * 0.08);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastFrame) / 1000); lastFrame = t;
    if (!game || $('game').hidden) return;
    step(t);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, m = room.meta || {};
    // The camera follows my miner, a bit above the middle so you can see what's below.
    const want = Math.max(0, Math.min(H - ch / T, game.me.y - ch / T * 0.38));
    game.cam += (want - game.cam) * Math.min(1, dt * 8);
    let ox = 0, oy = 0;
    if (game.shake > 0) { game.shake -= dt; ox = (Math.random() - 0.5) * 6; oy = (Math.random() - 0.5) * 6; }
    g2.clearRect(0, 0, cw, ch);
    // Sky.
    const skyY = (SURFACE - game.cam) * T;
    if (skyY > 0) { const sky = g2.createLinearGradient(0, 0, 0, skyY); sky.addColorStop(0, '#5ec8ff'); sky.addColorStop(1, '#bfe9ff'); g2.fillStyle = sky; g2.fillRect(0, 0, cw, skyY); }
    g2.save(); g2.translate(ox, oy - game.cam * T);
    const y0 = Math.max(0, Math.floor(game.cam)), y1 = Math.min(H - 1, Math.ceil(game.cam + ch / T));
    for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) drawCell(x, y, x * T, y * T);
    // Everyone else, sliding smoothly to where their device says they are.
    const order = game.order;
    for (const [id, p] of Object.entries(room.pos || {})) {
      if (id === myId || !p || !m.players || !m.players[id]) continue;
      const s = game.shown[id] || (game.shown[id] = { x: p.x, y: p.y });
      s.x += (p.x - s.x) * Math.min(1, dt * 14); s.y += (p.y - s.y) * Math.min(1, dt * 14);
      drawMiner(s.x, s.y, COLORS[m.players[id].slot], m.players[id].name, false);
    }
    const mySlot = m.players && m.players[myId] ? m.players[myId].slot : 0;
    const ms = game.shown[myId] || (game.shown[myId] = { x: game.me.x, y: game.me.y });
    ms.x += (game.me.x - ms.x) * Math.min(1, dt * 20); ms.y += (game.me.y - ms.y) * Math.min(1, dt * 20);
    drawMiner(ms.x, ms.y, COLORS[mySlot], '', true);
    // Bits of dirt and stone.
    particles = particles.filter(q => (q.life -= dt) > 0);
    for (const q of particles) { q.vy += 18 * dt; q.x += q.vx * dt; q.y += q.vy * dt; g2.fillStyle = q.c; g2.fillRect(q.x * T - 2, q.y * T - 2, 4, 4); }
    g2.restore();

    // Depth meter: everyone's depth, with the ruby at the bottom.
    const mx = cw - 16, top = 14, bot = ch - 14;
    g2.fillStyle = 'rgba(0,0,0,.45)'; g2.fillRect(mx - 5, top, 10, bot - top);
    g2.fillStyle = '#e0115f'; g2.beginPath(); g2.arc(mx, bot, 7, 0, Math.PI * 2); g2.fill();
    const dot = (y, color, big) => { g2.fillStyle = color; g2.strokeStyle = '#000'; g2.lineWidth = 2; g2.beginPath(); g2.arc(mx, top + (bot - top) * Math.min(1, y / RUBY_Y), big ? 7 : 5.5, 0, Math.PI * 2); g2.fill(); g2.stroke(); };
    for (const [id, p] of Object.entries(room.pos || {})) if (id !== myId && p && m.players && m.players[id]) dot(p.y, COLORS[m.players[id].slot], false);
    dot(game.me.y, COLORS[mySlot], true);

    // The race clock: counts up from DIG!, and stops at the winning time.
    const clock = m.phase === 'over' ? (m.winTime ?? Math.max(0, now() - m.startAt)) : Math.max(0, now() - (m.startAt || now()));
    const clockText = fmtTime(clock);
    if ($('timer').textContent !== clockText) $('timer').textContent = clockText;

    // Countdown.
    const left = (m.startAt || 0) - now();
    $('count').hidden = !(m.phase === 'play' && left > -700);
    if (!$('count').hidden) {
      const txt = left > 0 ? String(Math.ceil(left / 1000)) : 'DIG!';
      if ($('count').textContent !== txt) { $('count').textContent = txt; if (left > 0) sfx.beep(false); else sfx.beep(true); }
    }
  }
  requestAnimationFrame(frame);

  // 0:42.3
  const fmtTime = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;

  // ── Sounds ───────────────────────────────────────────────────────────────
  // Made on the fly with Web Audio, so there are no sound files. Phones only allow sound after a tap.
  const sfx = (() => {
    let ac = null, muted = store.get('minermania-mute') === '1';
    function ctx() {
      if (muted) return null;
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(f, dur, type = 'square', vol = 0.08, slide = 1) {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
      o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
    }
    function noise(dur, vol, freq) {
      const a = ctx(); if (!a) return;
      const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      s.connect(f).connect(g).connect(a.destination); s.start();
    }
    return {
      tink() { tone(900, 0.06, 'square', 0.05, 0.8); },
      crunch(stone) { noise(stone ? 0.18 : 0.1, stone ? 0.35 : 0.25, stone ? 2500 : 900); },
      clank() { tone(220, 0.12, 'square', 0.07, 0.7); },
      beep(go) { tone(go ? 880 : 440, go ? 0.35 : 0.15, 'square', 0.08); },
      win() { [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => tone(f, 0.25, 'square', 0.09), k * 120)); },
      // Phones only let sound start during a tap, so wake it up on the first touch anywhere.
      unlock() { ctx(); },
      get muted() { return muted; },
      toggle() { muted = !muted; store.set('minermania-mute', muted ? '1' : '0'); },
    };
  })();

  // ── Screens ──────────────────────────────────────────────────────────────
  function render() {
    const meta = room && room.meta;
    if (!room) { show('menu'); return; }
    if (!meta || !meta.host) { leaveRoom(); show('menu'); $('menu-error').textContent = 'The host left, so the room closed.'; return; }
    if (!meta.players || !meta.players[myId]) { leaveRoom(); show('menu'); $('menu-error').textContent = 'You left the room.'; return; }
    const players = playerList(meta), host = meta.host === myId;
    const swatch = slot => `<span class="sw" style="background:${COLORS[slot]}"></span>`;

    if (meta.phase === 'lobby') {
      game = null;
      show('lobby');
      $('code').textContent = room.code;
      $('lobby-players').innerHTML = players.map(p => `<li>${swatch(p.slot)}<span class="pname">${esc(p.name)}</span>
        <span class="muted">${COLOR_NAMES[p.slot]}${p.id === meta.host ? ' · host' : ''}${p.id === myId ? ' · you' : ''}</span></li>`).join('');
      $('start').hidden = !host;
      $('start').textContent = players.length > 1 ? `Start (${players.length} miners)` : 'Start (just you)';
      $('lobby-wait').hidden = host;
      return;
    }

    if (!game || game.seed !== meta.seed) newGame(meta);
    show('game');
    fit();
    $('over').hidden = meta.phase !== 'over';
    if (meta.phase === 'over') {
      held.clear();
      const w = meta.winner && meta.players[meta.winner] ? meta.players[meta.winner] : null;
      const wName = meta.winner === myId ? 'You' : w ? w.name : 'Someone';
      $('winner').innerHTML = `${w ? swatch(w.slot) : ''} ${esc(wName)} found the ruby! 💎`;
      $('win-time').textContent = meta.winTime != null ? `in ${fmtTime(meta.winTime)}` : '';
      $('again').hidden = !host;
      $('again-wait').hidden = host;
    }
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  const KEYS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowDown: 'down', s: 'down', S: 'down' };
  document.addEventListener('keydown', e => { const d = KEYS[e.key]; if (d && !$('game').hidden) { e.preventDefault(); held.add(d); } });
  document.addEventListener('keyup', e => { const d = KEYS[e.key]; if (d) held.delete(d); });
  window.addEventListener('blur', () => held.clear());
  for (const b of document.querySelectorAll('.pad button')) {
    const d = b.dataset.dir;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      held.add(d); b.classList.add('on');
      // Keep getting this finger's events even if it slides off the button. Not every browser allows it, and that's fine.
      try { b.setPointerCapture(e.pointerId); } catch {}
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { held.delete(d); b.classList.remove('on'); });
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  $('name').value = store.get('minermania-name') || '';
  $('create').onclick = () => { const n = myName(); if (n) createRoom(n); };
  $('join').onclick = () => {
    const n = myName(); if (!n) return;
    const code = $('join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('menu-error').textContent = 'Room codes are 4 letters.'; return; }
    joinRoom(code, n);
  };
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
  $('start').onclick = startRace;
  $('again').onclick = playAgain;
  for (const id of ['lobby-leave', 'game-leave', 'over-leave']) $(id).onclick = () => { leaveRoom(); show('menu'); };
  const drawMute = () => { $('mute').textContent = sfx.muted ? '🔇' : '🔊'; };
  $('mute').onclick = () => { sfx.toggle(); drawMute(); };
  drawMute();
  window.addEventListener('pagehide', leaveRoom);
  for (const ev of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });

  if (!db) $('menu-error').textContent = NO_SERVER;
  show('menu');
})();
