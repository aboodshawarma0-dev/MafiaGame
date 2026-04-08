const TOKEN = window.ROOM_TOKEN || '';
const ROOM_NAME = window.ROOM_NAME || '';
const USERNAME = localStorage.getItem('omerta_user') || 'ضيف';
const CUSTOM_IMG = localStorage.getItem('omerta_custom') || '';
const PLACEHOLDER = '/static/img/placeholder.png';
const socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, timeout: 20000 });

const state = {
  mySid: null,
  isHost: false,
  players: [],
  phase: 'waiting',
  round: 0,
  myRole: null,
  micOn: false,
  chatOpen: false,
  listOpen: false,
  stream: null,
  audioCtx: null,
  analyser: null,
  speakingLocal: false,
  voiceScope: 'all',
  selectedNightTarget: null,
  selectedVoteTarget: null,
};

const peers = {};
const remoteAudios = {};
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const avatarOf = (player) => (player && player.customImg) || PLACEHOLDER;

function showToast(msg) {
  const stack = $('toastStack');
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = msg;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 250);
  }, 3200);
}

function openBackdrop() {
  $('panelBackdrop').classList.remove('hidden');
}

function closeBackdropIfNeeded() {
  if (state.chatOpen || state.listOpen) $('panelBackdrop').classList.remove('hidden');
  else $('panelBackdrop').classList.add('hidden');
}

function togglePanel(which, force) {
  const open = typeof force === 'boolean' ? force : !(which === 'chat' ? state.chatOpen : state.listOpen);
  if (which === 'chat') {
    state.chatOpen = open;
    $('chatPanel').classList.toggle('hidden', !open);
  }
  if (which === 'players') {
    state.listOpen = open;
    $('playersPanel').classList.toggle('hidden', !open);
  }
  closeBackdropIfNeeded();
}

function patchTop() {
  $('roomCodeText').textContent = TOKEN;
  $('playerCount').textContent = `${state.players.length} / 12`;
  $('phaseHint').textContent = ({ waiting: 'اللوبي · تجهيز اللاعبين', night: 'الليل · المافيا تتحرك', day: 'النهار · النقاش مفتوح', voting: 'التصويت · اختَر المتهم', results: 'انتهت الجولة' })[state.phase] || 'اللوبي';
  $('voiceScopeLabel').textContent = ({ all: 'الجميع يسمعون الجميع', mafia: 'الآن المافيا فقط تسمع بعضها', silent: 'الصوت العام متوقف مؤقتاً' })[state.voiceScope] || 'الجميع يسمعون الجميع';
  const start = $('startGameBtn');
  start.disabled = !state.isHost || state.phase !== 'waiting' || state.players.length < 4;
  start.style.opacity = start.disabled ? '0.55' : '1';
}

function renderPlayers() {
  const grid = $('voiceGrid');
  const empty = $('emptyState');
  grid.innerHTML = '';
  if (!state.players.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  state.players.forEach((player) => {
    const card = document.createElement('article');
    card.className = `player-card ornament ${player.speaking ? 'speaking' : ''} ${!player.alive ? 'dead' : ''} ${player.sid === state.mySid ? 'me' : ''}`;
    const speakingBadge = player.speaking ? '<span class="badge speaking">يتكلم الآن</span>' : '<span class="badge">هادئ</span>';
    const micBadge = player.mic ? '' : '<span class="badge muted">صامت</span>';
    const hostBadge = player.is_host ? '<span class="badge host">هوست</span>' : '';
    const deadBadge = !player.alive ? '<span class="badge dead">ميت</span>' : '';
    card.innerHTML = `
      <div class="player-avatar-wrap">
        <img class="player-avatar" src="${avatarOf(player)}" alt="${esc(player.username)}" />
        <div class="player-name">${esc(player.username)}</div>
      </div>
      <div class="player-status">${speakingBadge}${micBadge}${hostBadge}${deadBadge}</div>
    `;
    grid.appendChild(card);
  });
  renderPlayersPanel();
  patchTop();
}

function renderPlayersPanel() {
  const body = $('playersPanelBody');
  body.innerHTML = '';
  state.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'panel-player';
    row.innerHTML = `
      <img src="${avatarOf(player)}" alt="${esc(player.username)}" />
      <div>
        <strong>${esc(player.username)}</strong>
        <div>${player.speaking ? 'يتكلم الآن' : 'هادئ'}${player.is_host ? ' · هوست' : ''}</div>
      </div>
    `;
    body.appendChild(row);
  });
}

function appendChatMessage(data) {
  const box = $('chatMessages');
  if (data.type === 'system') {
    const row = document.createElement('div');
    row.className = 'chat-system';
    row.textContent = data.msg;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return;
  }
  const row = document.createElement('div');
  row.className = 'chat-row';
  row.innerHTML = `
    <img src="${data.customImg || PLACEHOLDER}" alt="${esc(data.user)}" />
    <div>
      <div class="chat-meta">${esc(data.user)} <small>${new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</small></div>
      <div class="chat-text">${esc(data.msg)}</div>
    </div>
  `;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function showRoleCard(data) {
  state.myRole = data.role;
  $('roleCardName').textContent = data.label;
  $('roleCardIcon').src = data.icon;
  const overlay = $('roleCardOverlay');
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 3000);
}

function setPhase(phase, data = {}) {
  state.phase = phase;
  patchTop();
  const overlay = $('phaseOverlay');
  const title = $('phaseTitle');
  const text = $('phaseText');
  $('nightTargetsWrap').classList.add('hidden');
  $('voteTargetsWrap').classList.add('hidden');
  $('resultsGrid').classList.add('hidden');
  $('startVoteBtn').classList.toggle('hidden', !(state.isHost && phase === 'day'));
  $('forceNightBtn').classList.toggle('hidden', !(state.isHost && phase === 'night'));
  $('forceVoteBtn').classList.toggle('hidden', !(state.isHost && phase === 'voting'));
  $('resetGameBtn').classList.toggle('hidden', !(state.isHost && phase === 'results'));

  if (phase === 'waiting') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  if (phase === 'night') {
    title.textContent = 'الليل';
    text.textContent = 'نفّذ دورك بهدوء ثم انتظر باقي اللاعبين.';
  }
  if (phase === 'day') {
    title.textContent = 'النهار';
    text.textContent = data.killed ? `تم إسقاط ${data.killed}` : 'لم يسقط أحد هذه الليلة.';
  }
  if (phase === 'voting') {
    title.textContent = 'التصويت';
    text.textContent = 'اختر اللاعب الذي تظنه من المافيا.';
    $('voteTargetsWrap').classList.remove('hidden');
    renderVoteTargets(data.candidates || []);
  }
  if (phase === 'results') {
    title.textContent = 'النتائج';
    text.textContent = data.label || 'انتهت اللعبة';
    $('resultsGrid').classList.remove('hidden');
    renderResults(data.players || []);
  }
}

function renderResults(players) {
  const grid = $('resultsGrid');
  grid.innerHTML = '';
  const labels = { mafia: 'مافيا', doctor: 'الطبيب', detective: 'الكاشف', citizen: 'مواطن' };
  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'result-card';
    row.innerHTML = `<img src="${avatarOf(player)}" alt="${esc(player.username)}" /><strong>${esc(player.username)}</strong><span>${labels[player.role] || player.role}</span>`;
    grid.appendChild(row);
  });
}

function renderNightTargets(role, targets) {
  $('nightTargetsWrap').classList.remove('hidden');
  const grid = $('nightTargets');
  grid.innerHTML = '';
  state.selectedNightTarget = null;
  const btn = $('nightConfirmBtn');
  btn.disabled = true;
  targets.forEach((target) => {
    const player = state.players.find((p) => p.sid === target.sid) || target;
    const item = document.createElement('button');
    item.className = 'target-card';
    item.type = 'button';
    item.innerHTML = `<img src="${avatarOf(player)}" alt="${esc(target.username)}" /><strong>${esc(target.username)}</strong>`;
    item.addEventListener('click', () => {
      grid.querySelectorAll('.target-card').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      state.selectedNightTarget = target.sid;
      btn.disabled = false;
    });
    grid.appendChild(item);
  });
  btn.onclick = () => {
    if (!state.selectedNightTarget) return;
    socket.emit('night_action', { room: TOKEN, target_sid: state.selectedNightTarget });
    btn.disabled = true;
    showToast('تم إرسال اختيارك');
  };
}

function renderVoteTargets(candidates) {
  const grid = $('voteTargets');
  grid.innerHTML = '';
  state.selectedVoteTarget = null;
  candidates.filter((p) => p.sid !== state.mySid).forEach((target) => {
    const player = state.players.find((p) => p.sid === target.sid) || target;
    const item = document.createElement('button');
    item.className = 'target-card';
    item.type = 'button';
    item.innerHTML = `<img src="${avatarOf(player)}" alt="${esc(target.username)}" /><strong>${esc(target.username)}</strong>`;
    item.addEventListener('click', () => {
      if (state.selectedVoteTarget) return;
      state.selectedVoteTarget = target.sid;
      socket.emit('cast_vote', { room: TOKEN, target_sid: target.sid });
      grid.querySelectorAll('.target-card').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
    });
    grid.appendChild(item);
  });
}

async function initMic() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const AC = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AC();
    const source = state.audioCtx.createMediaStreamSource(state.stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);
    if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
    detectSpeaking();
    state.players.forEach((p) => { if (p.sid !== state.mySid) createOffer(p.sid); });
  } catch (err) {
    state.micOn = false;
    updateMicButton();
    showToast('تعذر الوصول للمايكروفون');
  }
}

function stopMic() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.audioCtx) {
    try { state.audioCtx.close(); } catch (e) {}
  }
  state.audioCtx = null;
  state.analyser = null;
  Object.keys(peers).forEach(closePeer);
}

function updateMicButton() {
  $('micIcon').src = state.micOn ? '/static/svg/icon-mic.svg' : '/static/svg/icon-mic-off.svg';
}

function detectSpeaking() {
  const analyser = state.analyser;
  if (!analyser) return;
  const buf = new Uint8Array(analyser.fftSize);
  let holdUntil = 0;
  let lastSent = false;
  const tick = async () => {
    if (!state.analyser || !state.micOn || !state.stream) {
      if (lastSent) socket.emit('speaking', { room: TOKEN, active: false });
      state.speakingLocal = false;
      return;
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      try { await state.audioCtx.resume(); } catch (e) {}
    }
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = buf[i] - 128;
      sum += v * v;
    }
    const volume = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (volume > 7.4) holdUntil = now + 180;
    const active = now < holdUntil;
    if (active !== lastSent) {
      lastSent = active;
      state.speakingLocal = active;
      socket.emit('speaking', { room: TOKEN, active });
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function getOrCreatePeer(remoteSid) {
  if (peers[remoteSid]) return peers[remoteSid];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[remoteSid] = pc;
  if (state.stream) state.stream.getTracks().forEach((track) => pc.addTrack(track, state.stream));
  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit('webrtc_ice', { room: TOKEN, target: remoteSid, candidate: ev.candidate });
  };
  pc.ontrack = (ev) => {
    let audio = remoteAudios[remoteSid];
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      remoteAudios[remoteSid] = audio;
    }
    audio.srcObject = ev.streams[0];
    audio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) {
      closePeer(remoteSid);
    }
  };
  return pc;
}

async function createOffer(remoteSid) {
  const pc = getOrCreatePeer(remoteSid);
  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { room: TOKEN, target: remoteSid, sdp: pc.localDescription });
  } catch (err) {}
}

function closePeer(remoteSid) {
  if (peers[remoteSid]) {
    try { peers[remoteSid].close(); } catch (e) {}
    delete peers[remoteSid];
  }
  if (remoteAudios[remoteSid]) {
    try { remoteAudios[remoteSid].pause(); remoteAudios[remoteSid].srcObject = null; remoteAudios[remoteSid].remove(); } catch (e) {}
    delete remoteAudios[remoteSid];
  }
}

function toggleMic() {
  state.micOn = !state.micOn;
  updateMicButton();
  socket.emit('toggle_mic', { room: TOKEN, state: state.micOn });
  if (state.micOn && !state.stream) initMic();
  if (!state.micOn) {
    socket.emit('speaking', { room: TOKEN, active: false });
    stopMic();
  }
}

function copyCode() {
  navigator.clipboard.writeText(TOKEN).then(() => showToast('تم نسخ الكود')).catch(() => showToast(TOKEN));
}

function sendChat() {
  const input = $('chatInput');
  const msg = (input.value || '').trim();
  if (!msg) return;
  socket.emit('chat_msg', { room: TOKEN, msg });
  input.value = '';
}

function showMinPlayersModal() {
  $('minPlayersModal').classList.remove('hidden');
}

function startGame() {
  if (state.players.length < 4) {
    showMinPlayersModal();
    return;
  }
  socket.emit('start_game', { room: TOKEN });
}

function bindControls() {
  $('copyBtn').addEventListener('click', copyCode);
  $('chatBtn').addEventListener('click', () => togglePanel('chat'));
  $('listBtn').addEventListener('click', () => togglePanel('players'));
  $('micBtn').addEventListener('click', toggleMic);
  $('startGameBtn').addEventListener('click', startGame);
  $('sendChatBtn').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  $('panelBackdrop').addEventListener('click', () => {
    togglePanel('chat', false);
    togglePanel('players', false);
  });
  document.querySelectorAll('.close-btn').forEach((btn) => {
    btn.addEventListener('click', () => togglePanel(btn.dataset.close === 'chat' ? 'chat' : 'players', false));
  });
  $('closeMinPlayersModal').addEventListener('click', () => $('minPlayersModal').classList.add('hidden'));
  $('startVoteBtn').addEventListener('click', () => socket.emit('start_vote', { room: TOKEN }));
  $('forceNightBtn').addEventListener('click', () => socket.emit('force_night_end', { room: TOKEN }));
  $('forceVoteBtn').addEventListener('click', () => socket.emit('force_vote_end', { room: TOKEN }));
  $('resetGameBtn').addEventListener('click', () => socket.emit('reset_game', { room: TOKEN }));
}

socket.on('connect', () => {
  socket.emit('join', { room: TOKEN, username: USERNAME, customImg: CUSTOM_IMG });
});

socket.on('joined_ok', (data) => {
  state.mySid = data.my_sid;
  state.isHost = data.is_host;
  state.phase = data.phase || 'waiting';
  patchTop();
});

socket.on('update_players', (data) => {
  state.players = data.players || [];
  state.voiceScope = data.voice_scope || 'all';
  renderPlayers();
  if (state.micOn && state.stream) {
    state.players.forEach((p) => { if (p.sid !== state.mySid && !peers[p.sid]) createOffer(p.sid); });
  }
  Object.keys(peers).forEach((sid) => { if (!state.players.find((p) => p.sid === sid)) closePeer(sid); });
});

socket.on('new_message', appendChatMessage);
socket.on('name_taken', (data) => showToast(`الاسم مستخدم: ${data.suggested}`));
socket.on('error', (data) => {
  const msg = data && data.msg ? data.msg : 'حدث خطأ';
  if (msg.includes('4 لاعبين')) showMinPlayersModal();
  showToast(msg);
});

socket.on('game_started', (data) => {
  state.round = data.round || 1;
  setPhase('night', data);
  showToast('بدأت اللعبة');
});

socket.on('your_role', (data) => {
  showRoleCard(data);
  if (state.phase === 'night') renderNightTargets(data.role, []);
});

socket.on('night_info', (data) => {
  if (state.phase !== 'night') setPhase('night', data);
  renderNightTargets(data.role, data.targets || []);
});

socket.on('action_received', (data) => showToast(data.msg || 'تم الأمر'));
socket.on('detective_result', (data) => showToast(data.is_mafia ? `${data.username} من المافيا` : `${data.username} ليس من المافيا`));
socket.on('phase_change', (data) => {
  state.round = data.round || state.round;
  setPhase(data.phase, data);
});
socket.on('vote_update', () => showToast('تم تحديث التصويت'));
socket.on('vote_ack', (data) => showToast(data.msg || 'تم تسجيل الصوت'));
socket.on('game_over', (data) => setPhase('results', data));
socket.on('game_reset', () => {
  state.myRole = null;
  setPhase('waiting');
  showToast('تمت إعادة اللعبة');
});

socket.on('webrtc_offer', async (data) => {
  const pc = getOrCreatePeer(data.from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { room: TOKEN, target: data.from, sdp: pc.localDescription });
  } catch (err) {}
});

socket.on('webrtc_answer', async (data) => {
  const pc = peers[data.from];
  if (!pc) return;
  try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch (err) {}
});

socket.on('webrtc_ice', async (data) => {
  const pc = peers[data.from];
  if (!pc || !data.candidate) return;
  try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (err) {}
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.audioCtx && state.audioCtx.state === 'suspended') {
    try { await state.audioCtx.resume(); } catch (e) {}
  }
});

document.addEventListener('DOMContentLoaded', () => {
  bindControls();
  patchTop();
});
