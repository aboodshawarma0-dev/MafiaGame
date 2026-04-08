import os
import random
import string
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit, join_room

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(BASE_DIR, 'templates'), static_folder=os.path.join(BASE_DIR, 'static'), static_url_path='/static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'omerta_gold_2026')
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024

socketio = SocketIO(
    app,
    cors_allowed_origins='*',
    async_mode='gevent',
    logger=False,
    engineio_logger=False,
    ping_timeout=20,
    ping_interval=10,
    max_http_buffer_size=4 * 1024 * 1024,
    allow_upgrades=True,
)

ROOMS = {}
MIN_PLAYERS = 4
MAX_PLAYERS = 12
UTC = timezone.utc

ROLES = {
    'mafia': {'label': 'مافيا', 'icon': '/static/svg/role-mafia.svg', 'accent': '#B11226'},
    'doctor': {'label': 'الطبيب', 'icon': '/static/svg/role-doctor.svg', 'accent': '#2AA5A0'},
    'detective': {'label': 'الكاشف', 'icon': '/static/svg/role-detective.svg', 'accent': '#4667AA'},
    'citizen': {'label': 'مواطن', 'icon': '/static/svg/role-citizen.svg', 'accent': '#D4AF37'},
}


def now_utc():
    return datetime.now(UTC)


def cleanup_rooms():
    cutoff = now_utc() - timedelta(hours=24)
    for token in list(ROOMS.keys()):
        room = ROOMS[token]
        if not room['players'] and room['created_at'] < cutoff:
            del ROOMS[token]


def make_token():
    chars = string.ascii_uppercase + string.digits
    while True:
        token = ''.join(random.choices(chars, k=8))
        if token not in ROOMS:
            return token


def new_room(name=''):
    return {
        'room_name': name,
        'host': None,
        'players': {},
        'created_at': now_utc(),
        'started': False,
        'game_phase': 'waiting',
        'game_round': 0,
        'votes': {},
        'night_actions': {},
        'protected_sid': None,
    }


def used_names(token):
    room = ROOMS.get(token)
    if not room:
        return set()
    return {p['username'].strip().lower() for p in room['players'].values()}


def next_name(token, base):
    if base.lower() not in used_names(token):
        return base
    idx = 2
    while True:
        candidate = f'{base} {idx}'
        if candidate.lower() not in used_names(token):
            return candidate
        idx += 1


def voice_scope_for(token, sid):
    room = ROOMS.get(token)
    if not room:
        return 'all'
    phase = room.get('game_phase', 'waiting')
    player = room['players'].get(sid)
    if not player:
        return 'all'
    if phase in ('waiting', 'day', 'voting', 'results'):
        return 'all'
    if phase == 'night':
        if player.get('role') == 'mafia' and player.get('alive', True):
            return 'mafia'
        return 'silent'
    return 'all'


def player_visible_to(token, viewer_sid, player_sid):
    room = ROOMS.get(token)
    if not room:
        return True
    scope = voice_scope_for(token, viewer_sid)
    player = room['players'].get(player_sid)
    if not player:
        return False
    if scope == 'all':
        return True
    if scope == 'mafia':
        return player.get('role') == 'mafia' and player.get('alive', True)
    return player_sid == viewer_sid


def speaking_visible(token, viewer_sid, player_sid):
    room = ROOMS.get(token)
    if not room:
        return False
    player = room['players'].get(player_sid)
    if not player:
        return False
    if not player_visible_to(token, viewer_sid, player_sid):
        return False
    return player.get('speaking', False)


def player_payload_for(token, viewer_sid):
    room = ROOMS.get(token)
    if not room:
        return []
    items = []
    for sid, player in room['players'].items():
        items.append({
            'sid': sid,
            'username': player['username'],
            'customImg': player.get('customImg', ''),
            'mic': player.get('mic', False),
            'speaking': speaking_visible(token, viewer_sid, sid),
            'alive': player.get('alive', True),
            'is_host': sid == room['host'],
            'visible': player_visible_to(token, viewer_sid, sid),
            'role': player.get('role') if room.get('game_phase') == 'results' else None,
        })
    return items


def sync_players(token):
    room = ROOMS.get(token)
    if not room:
        return
    count = len(room['players'])
    for sid in list(room['players'].keys()):
        socketio.emit('update_players', {
            'players': player_payload_for(token, sid),
            'count': count,
            'voice_scope': voice_scope_for(token, sid),
        }, room=sid)


def system_message(token, message):
    socketio.emit('new_message', {'type': 'system', 'msg': message}, room=token)


def alive_players(token):
    room = ROOMS.get(token)
    if not room:
        return []
    return [(sid, p) for sid, p in room['players'].items() if p.get('alive', True)]


def assign_roles(token):
    room = ROOMS.get(token)
    if not room:
        return
    sids = list(room['players'].keys())
    n = len(sids)
    mafia = max(1, n // 4)
    doctor = 1 if n >= 5 else 0
    detective = 1 if n >= 6 else 0
    citizen = n - mafia - doctor - detective
    roles = ['mafia'] * mafia + ['doctor'] * doctor + ['detective'] * detective + ['citizen'] * citizen
    random.shuffle(sids)
    random.shuffle(roles)
    for sid, role in zip(sids, roles):
        room['players'][sid]['role'] = role
        room['players'][sid]['alive'] = True


def check_win(token):
    alive = alive_players(token)
    mafia_count = sum(1 for _, p in alive if p.get('role') == 'mafia')
    citizen_count = sum(1 for _, p in alive if p.get('role') != 'mafia')
    if mafia_count == 0:
        return 'citizens'
    if mafia_count >= citizen_count:
        return 'mafia'
    return None


def broadcast_role_cards(token):
    room = ROOMS.get(token)
    if not room:
        return
    for sid, player in room['players'].items():
        role = player.get('role')
        if role:
            meta = ROLES[role]
            socketio.emit('your_role', {
                'role': role,
                'label': meta['label'],
                'icon': meta['icon'],
                'accent': meta['accent'],
            }, room=sid)


def send_night_info(token):
    room = ROOMS.get(token)
    if not room:
        return
    alive = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p.get('alive', True)]
    non_mafia = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p.get('alive', True) and p.get('role') != 'mafia']
    for sid, player in room['players'].items():
        if not player.get('alive', True):
            continue
        role = player.get('role')
        if role == 'mafia':
            team = [{'sid': s, 'username': p['username']} for s, p in room['players'].items() if p.get('alive', True) and p.get('role') == 'mafia']
            socketio.emit('night_info', {'role': 'mafia', 'targets': non_mafia, 'team': team}, room=sid)
        elif role == 'doctor':
            socketio.emit('night_info', {'role': 'doctor', 'targets': alive}, room=sid)
        elif role == 'detective':
            options = [{'sid': s, 'username': p['username']} for s, p in room['players'].items() if p.get('alive', True) and s != sid]
            socketio.emit('night_info', {'role': 'detective', 'targets': options}, room=sid)


def end_game(token, winner):
    room = ROOMS.get(token)
    if not room:
        return
    payload = []
    for sid, p in room['players'].items():
        payload.append({
            'sid': sid,
            'username': p['username'],
            'customImg': p.get('customImg', ''),
            'alive': p.get('alive', True),
            'role': p.get('role', 'citizen'),
        })
    socketio.emit('game_over', {
        'winner': winner,
        'label': 'فاز أهل المدينة' if winner == 'citizens' else 'فازت المافيا',
        'players': payload,
    }, room=token)
    room['started'] = False
    room['game_phase'] = 'waiting'
    room['game_round'] = 0
    room['votes'] = {}
    room['night_actions'] = {}
    room['protected_sid'] = None
    for player in room['players'].values():
        player['alive'] = True
        player['role'] = None
        player['speaking'] = False
    sync_players(token)


def resolve_night(token):
    room = ROOMS.get(token)
    if not room:
        return
    votes = {}
    for actor_sid, target_sid in room['night_actions'].items():
        actor = room['players'].get(actor_sid)
        if actor and actor.get('role') == 'mafia' and target_sid:
            votes[target_sid] = votes.get(target_sid, 0) + 1
    target = max(votes, key=votes.get) if votes else None
    killed_name = None
    if target and target != room.get('protected_sid') and target in room['players']:
        room['players'][target]['alive'] = False
        room['players'][target]['speaking'] = False
        killed_name = room['players'][target]['username']
    room['night_actions'] = {}
    room['protected_sid'] = None
    room['game_phase'] = 'day'
    socketio.emit('phase_change', {'phase': 'day', 'round': room['game_round'], 'killed': killed_name}, room=token)
    system_message(token, f'تم إعلان الصباح. {killed_name or "لم يسقط أحد"}')
    winner = check_win(token)
    if winner:
        end_game(token, winner)
    else:
        sync_players(token)


def resolve_vote(token):
    room = ROOMS.get(token)
    if not room:
        return
    counts = {}
    for _, target_sid in room['votes'].items():
        counts[target_sid] = counts.get(target_sid, 0) + 1
    eliminated = None
    if counts:
        top = max(counts.values())
        candidates = [sid for sid, value in counts.items() if value == top]
        eliminated = random.choice(candidates)
        if eliminated in room['players']:
            room['players'][eliminated]['alive'] = False
            room['players'][eliminated]['speaking'] = False
    eliminated_name = room['players'][eliminated]['username'] if eliminated else None
    room['votes'] = {}
    room['game_phase'] = 'night'
    room['game_round'] += 1
    socketio.emit('phase_change', {'phase': 'night', 'round': room['game_round'], 'eliminated': eliminated_name}, room=token)
    send_night_info(token)
    system_message(token, f'بدأ الليل. {eliminated_name or "لم يتم إقصاء أحد"}')
    winner = check_win(token)
    if winner:
        end_game(token, winner)
    else:
        sync_players(token)


@app.route('/')
def index():
    cleanup_rooms()
    return render_template('index.html')


@app.route('/room/<token>')
def room_page(token):
    token = token.upper()
    if token not in ROOMS:
        ROOMS[token] = new_room(f'غرفة {token}')
    cleanup_rooms()
    return render_template('room.html', token=token, room_name=ROOMS[token]['room_name'])


@app.route('/create_room', methods=['POST'])
def create_room():
    cleanup_rooms()
    data = request.get_json(silent=True) or {}
    token = make_token()
    name = (data.get('room_name') or f'غرفة {token}').strip()[:40]
    ROOMS[token] = new_room(name)
    return jsonify({'success': True, 'room_id': token, 'room_name': name})


@app.route('/room_exists/<token>')
def room_exists(token):
    room = ROOMS.get(token.upper())
    if not room:
        return jsonify({'exists': False})
    return jsonify({'exists': True, 'room_name': room['room_name'], 'players': len(room['players']), 'started': room['started']})


@app.route('/check_name', methods=['POST'])
def check_name():
    data = request.get_json(silent=True) or {}
    token = (data.get('token') or '').upper()
    username = (data.get('username') or '').strip()
    if token not in ROOMS or not username:
        return jsonify({'taken': False, 'suggested': username})
    taken = username.lower() in used_names(token)
    return jsonify({'taken': taken, 'suggested': next_name(token, username) if taken else username})


@app.route('/api/stats')
def stats():
    cleanup_rooms()
    return jsonify({'rooms': len(ROOMS), 'players': sum(len(room['players']) for room in ROOMS.values())})


@app.route('/api/recent_rooms')
def recent_rooms():
    cleanup_rooms()
    cutoff = now_utc() - timedelta(hours=24)
    items = []
    for token, room in ROOMS.items():
        if room['created_at'] >= cutoff:
            items.append({
                'token': token,
                'room_name': room['room_name'],
                'players': len(room['players']),
                'started': room['started'],
            })
    items.sort(key=lambda item: item['players'], reverse=True)
    return jsonify({'rooms': items[:12]})


@socketio.on('join')
def on_join(data):
    token = (data.get('room') or '').strip().upper()
    username = (data.get('username') or 'ضيف').strip()[:24]
    custom_img = (data.get('customImg') or '').strip()
    if not token:
        return
    if token not in ROOMS:
        ROOMS[token] = new_room(f'غرفة {token}')
    room = ROOMS[token]
    if request.sid not in room['players'] and len(room['players']) >= MAX_PLAYERS:
        emit('error', {'msg': f'الحد الأقصى {MAX_PLAYERS} لاعب'})
        return
    existing_sid = next((sid for sid, p in room['players'].items() if p['username'].lower() == username.lower()), None)
    if existing_sid and existing_sid != request.sid:
        player = room['players'].pop(existing_sid)
        room['players'][request.sid] = player
        if room['host'] == existing_sid:
            room['host'] = request.sid
    elif request.sid not in room['players']:
        if username.lower() in used_names(token):
            emit('name_taken', {'username': username, 'suggested': next_name(token, username)})
            return
        room['players'][request.sid] = {
            'username': username,
            'customImg': custom_img,
            'mic': False,
            'speaking': False,
            'alive': True,
            'role': None,
        }
        if not room['host']:
            room['host'] = request.sid
        system_message(token, f'{username} دخل الغرفة')
    else:
        room['players'][request.sid]['customImg'] = custom_img
    join_room(token)
    emit('joined_ok', {
        'token': token,
        'is_host': request.sid == room['host'],
        'room_name': room['room_name'],
        'my_sid': request.sid,
        'phase': room['game_phase'],
        'started': room['started'],
    })
    sync_players(token)


@socketio.on('disconnect')
def on_disconnect():
    for token in list(ROOMS.keys()):
        room = ROOMS[token]
        if request.sid in room['players']:
            username = room['players'][request.sid]['username']
            del room['players'][request.sid]
            if room['host'] == request.sid:
                room['host'] = next(iter(room['players']), None)
            if not room['players']:
                cleanup_rooms()
            else:
                system_message(token, f'{username} خرج من الغرفة')
                sync_players(token)
            break


@socketio.on('toggle_mic')
def on_toggle_mic(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if not room or request.sid not in room['players']:
        return
    state = bool(data.get('state', False))
    player = room['players'][request.sid]
    changed = player.get('mic') != state
    player['mic'] = state
    if not state:
        player['speaking'] = False
    if changed:
        sync_players(token)


@socketio.on('speaking')
def on_speaking(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if not room or request.sid not in room['players']:
        return
    player = room['players'][request.sid]
    if not player.get('mic'):
        return
    active = bool(data.get('active', False))
    if player.get('speaking') != active:
        player['speaking'] = active
        sync_players(token)


@socketio.on('chat_msg')
def on_chat(data):
    token = (data.get('room') or '').upper()
    msg = (data.get('msg') or '').strip()[:500]
    room = ROOMS.get(token)
    if not room or request.sid not in room['players'] or not msg:
        return
    player = room['players'][request.sid]
    if room['started'] and not player.get('alive', True):
        emit('error', {'msg': 'اللاعب الميت لا يرسل رسائل'})
        return
    socketio.emit('new_message', {
        'type': 'player',
        'user': player['username'],
        'customImg': player.get('customImg', ''),
        'msg': msg,
    }, room=token)


@socketio.on('start_game')
def on_start_game(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if not room:
        return
    if request.sid != room['host']:
        emit('error', {'msg': 'فقط الهوست يبدأ اللعبة'})
        return
    if len(room['players']) < MIN_PLAYERS:
        emit('error', {'msg': f'لازم يكون في {MIN_PLAYERS} لاعبين على الأقل'})
        return
    assign_roles(token)
    room['started'] = True
    room['game_phase'] = 'night'
    room['game_round'] = 1
    room['votes'] = {}
    room['night_actions'] = {}
    room['protected_sid'] = None
    socketio.emit('game_started', {'phase': 'night', 'round': 1}, room=token)
    broadcast_role_cards(token)
    send_night_info(token)
    sync_players(token)
    system_message(token, 'بدأت اللعبة')


@socketio.on('night_action')
def on_night_action(data):
    token = (data.get('room') or '').upper()
    target_sid = data.get('target_sid') or ''
    room = ROOMS.get(token)
    if not room or request.sid not in room['players'] or room.get('game_phase') != 'night':
        return
    role = room['players'][request.sid].get('role')
    if role == 'mafia':
        room['night_actions'][request.sid] = target_sid
        emit('action_received', {'msg': 'تم اختيار الهدف'})
    elif role == 'doctor':
        room['protected_sid'] = target_sid
        emit('action_received', {'msg': 'تم اختيار الحماية'})
    elif role == 'detective' and target_sid in room['players']:
        target_role = room['players'][target_sid].get('role', 'citizen')
        room['night_actions'][request.sid] = target_sid
        emit('detective_result', {
            'username': room['players'][target_sid]['username'],
            'is_mafia': target_role == 'mafia',
            'role': ROLES[target_role]['label'],
        })
    mafia_sids = [sid for sid, p in room['players'].items() if p.get('alive', True) and p.get('role') == 'mafia']
    mafia_done = mafia_sids and all(sid in room['night_actions'] for sid in mafia_sids)
    doctor_needed = any(p.get('alive', True) and p.get('role') == 'doctor' for p in room['players'].values())
    detective_needed = any(p.get('alive', True) and p.get('role') == 'detective' for p in room['players'].values())
    doctor_done = (not doctor_needed) or room.get('protected_sid') is not None
    detective_done = (not detective_needed) or any(room['players'][sid].get('role') == 'detective' and sid in room['night_actions'] for sid in room['players'])
    if mafia_done and doctor_done and detective_done:
        resolve_night(token)


@socketio.on('start_vote')
def on_start_vote(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if not room or request.sid != room['host'] or room.get('game_phase') != 'day':
        return
    room['game_phase'] = 'voting'
    room['votes'] = {}
    candidates = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p.get('alive', True)]
    socketio.emit('phase_change', {'phase': 'voting', 'candidates': candidates}, room=token)
    system_message(token, 'بدأ التصويت')


@socketio.on('cast_vote')
def on_cast_vote(data):
    token = (data.get('room') or '').upper()
    target_sid = data.get('target_sid') or ''
    room = ROOMS.get(token)
    if not room or room.get('game_phase') != 'voting' or request.sid not in room['players']:
        return
    if not room['players'][request.sid].get('alive', True):
        emit('error', {'msg': 'الميت لا يصوت'})
        return
    room['votes'][request.sid] = target_sid
    counts = {}
    for _, choice in room['votes'].items():
        counts[choice] = counts.get(choice, 0) + 1
    socketio.emit('vote_update', {'counts': counts}, room=token)
    emit('vote_ack', {'msg': 'تم تسجيل صوتك'})
    alive = [sid for sid, p in room['players'].items() if p.get('alive', True)]
    if all(sid in room['votes'] for sid in alive):
        resolve_vote(token)


@socketio.on('force_night_end')
def on_force_night_end(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if room and room.get('game_phase') == 'night' and request.sid == room['host']:
        resolve_night(token)


@socketio.on('force_vote_end')
def on_force_vote_end(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if room and room.get('game_phase') == 'voting' and request.sid == room['host']:
        resolve_vote(token)


@socketio.on('reset_game')
def on_reset_game(data):
    token = (data.get('room') or '').upper()
    room = ROOMS.get(token)
    if not room or request.sid != room['host']:
        return
    room['started'] = False
    room['game_phase'] = 'waiting'
    room['game_round'] = 0
    room['votes'] = {}
    room['night_actions'] = {}
    room['protected_sid'] = None
    for player in room['players'].values():
        player['alive'] = True
        player['role'] = None
        player['speaking'] = False
    socketio.emit('game_reset', {}, room=token)
    sync_players(token)


@socketio.on('webrtc_offer')
def on_webrtc_offer(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_offer', {'from': request.sid, 'sdp': data.get('sdp')}, room=target)


@socketio.on('webrtc_answer')
def on_webrtc_answer(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_answer', {'from': request.sid, 'sdp': data.get('sdp')}, room=target)


@socketio.on('webrtc_ice')
def on_webrtc_ice(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_ice', {'from': request.sid, 'candidate': data.get('candidate')}, room=target)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
