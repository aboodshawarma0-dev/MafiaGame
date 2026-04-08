const state = {
  customImg: localStorage.getItem('omerta_custom') || '',
};

const $ = (id) => document.getElementById(id);

function showFeedback(msg, ok = false) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? '#d4af37' : '#ffd3d3';
}

function syncPreview() {
  $('avatarPreview').src = state.customImg || '/static/img/placeholder.png';
}

function saveProfile(name) {
  localStorage.setItem('omerta_user', name);
  if (state.customImg) localStorage.setItem('omerta_custom', state.customImg);
  else localStorage.removeItem('omerta_custom');
}

function createEmbers() {
  const holder = $('embers');
  if (!holder) return;
  for (let i = 0; i < 22; i += 1) {
    const ember = document.createElement('span');
    ember.className = 'ember';
    const size = 8 + Math.random() * 26;
    ember.style.width = `${size}px`;
    ember.style.height = `${size}px`;
    ember.style.left = `${Math.random() * 100}%`;
    ember.style.bottom = `${-10 - Math.random() * 50}px`;
    ember.style.animationDuration = `${9 + Math.random() * 12}s`;
    ember.style.animationDelay = `${Math.random() * 7}s`;
    holder.appendChild(ember);
  }
}

async function updateStats() {
  try {
    const [statsRes, roomsRes] = await Promise.all([fetch('/api/stats'), fetch('/api/recent_rooms')]);
    const stats = await statsRes.json();
    const rooms = await roomsRes.json();
    $('statPlayers').textContent = stats.players || 0;
    $('statRooms').textContent = stats.rooms || 0;
    renderRecentRooms(rooms.rooms || []);
  } catch (err) {
    renderRecentRooms([]);
  }
}

function renderRecentRooms(rooms) {
  const list = $('recentRooms');
  if (!list) return;
  list.innerHTML = '';
  if (!rooms.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-room';
    empty.innerHTML = '<div><strong>لا توجد غرف حديثة</strong><span>أنشئ غرفة جديدة وابدأ الجولة</span></div>';
    list.appendChild(empty);
    return;
  }
  rooms.forEach((room) => {
    const item = document.createElement('article');
    item.className = 'recent-room';
    item.innerHTML = `
      <div>
        <strong>${room.room_name}</strong>
        <span>${room.players} لاعب · ${room.started ? 'داخل اللعبة' : 'بانتظار اللاعبين'}</span>
      </div>
      <button class="room-join-btn" data-token="${room.token}" type="button">دخول</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      $('roomCode').value = room.token;
      joinRoom();
    });
    list.appendChild(item);
  });
}

async function ensureValidName() {
  const username = ($('username').value || '').trim();
  if (!username) {
    showFeedback('اكتب اسم اللاعب أولاً');
    return null;
  }
  return username;
}

async function createRoom() {
  const username = await ensureValidName();
  if (!username) return;
  const roomName = ($('roomNameInput').value || '').trim();
  showFeedback('جارٍ إنشاء الغرفة...', true);
  try {
    const res = await fetch('/create_room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_name: roomName }),
    });
    const data = await res.json();
    saveProfile(username);
    location.href = `/room/${data.room_id}`;
  } catch (err) {
    showFeedback('تعذر إنشاء الغرفة');
  }
}

async function joinRoom() {
  const username = await ensureValidName();
  if (!username) return;
  const code = ($('roomCode').value || '').trim().toUpperCase();
  if (!code) {
    showFeedback('اكتب كود الغرفة');
    return;
  }
  showFeedback('جارٍ التحقق من الغرفة...', true);
  try {
    const roomRes = await fetch(`/room_exists/${code}`);
    const roomData = await roomRes.json();
    if (!roomData.exists) {
      showFeedback('الغرفة غير موجودة');
      return;
    }
    const nameCheck = await fetch('/check_name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: code, username }),
    });
    const nameData = await nameCheck.json();
    if (nameData.taken) {
      showFeedback(`الاسم مستخدم، جرّب: ${nameData.suggested}`);
      return;
    }
    saveProfile(username);
    location.href = `/room/${code}`;
  } catch (err) {
    showFeedback('تعذر الانضمام للغرفة');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  createEmbers();
  syncPreview();
  const savedName = localStorage.getItem('omerta_user');
  if (savedName) $('username').value = savedName;
  $('avatarInput').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showFeedback('الصورة أكبر من 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      state.customImg = e.target.result;
      syncPreview();
      showFeedback('تم حفظ الصورة', true);
    };
    reader.readAsDataURL(file);
  });
  $('clearAvatarBtn').addEventListener('click', () => {
    state.customImg = '';
    syncPreview();
    showFeedback('تمت إزالة الصورة', true);
  });
  $('refreshRoomsBtn').addEventListener('click', updateStats);
  $('createRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', joinRoom);
  $('roomCode').addEventListener('input', (ev) => {
    ev.target.value = ev.target.value.toUpperCase();
  });
  updateStats();
  setInterval(updateStats, 15000);
});
