import os
import random
import string
import time
import logging
from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, join_room, emit

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=os.path.join(BASE_DIR, 'templates'), static_folder=os.path.join(BASE_DIR, 'static'))
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'omerta_gold_2026')
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024

socketio = SocketIO(
    app,
    cors_allowed_origins='*',
    async_mode='gevent',
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=4 * 1024 * 1024,
    allow_upgrades=True,
)

MIN_PLAYERS = 4
MAX_PLAYERS = 12
ROOM_KEEP_SECONDS = 24 * 60 * 60

ROLES = {
    'mafia': {'label': 'المافيا', 'color': '#d4af63'},
    'citizen': {'label': 'المواطن', 'color': '#f6ead0'},
    'doctor': {'label': 'الطبيب', 'color': '#d4af63'},
    'detective': {'label': 'الكاشف', 'color': '#d4af63'},
}

rooms = {}


def now_ts():
    return int(time.time())


def cleanup_rooms():
    cutoff = now_ts() - ROOM_KEEP_SECONDS
    for token in list(rooms.keys()):
        room = rooms[token]
        stale = room.get('created_at', 0) < cutoff
        empty_too_long = not room['players'] and room.get('updated_at', 0) < now_ts() - 7200
        if stale or empty_too_long:
            rooms.pop(token, None)


def make_token():
    chars = string.ascii_uppercase + string.digits
    while True:
        token = ''.join(random.choices(chars, k=8))
        if token not in rooms:
            return token


def new_room(name=''):
    ts = now_ts()
    return {
        'players': {},
        'host': None,
        'started': False,
        'room_name': name,
        'game_phase': 'waiting',
        'game_round': 0,
        'votes': {},
        'night_actions': {},
        'protected_sid': None,
        'created_at': ts,
        'updated_at': ts,
    }


def touch_room(token):
    room = rooms.get(token)
    if room:
        room['updated_at'] = now_ts()


def phase_label(phase):
    return {
        'waiting': 'اللوبي',
        'night': 'الليل',
        'day': 'النهار',
        'voting': 'التصويت',
        'results': 'النتائج',
    }.get(phase, phase)


def used_names(token):
    room = rooms.get(token)
    if not room:
        return set()
    return {p['username'].lower() for p in room['players'].values()}


def next_available_name(token, base):
    names = used_names(token)
    candidate = base or 'لاعب'
    if candidate.lower() not in names:
        return candidate
    i = 2
    while True:
        alt = f'{candidate} {i}'
        if alt.lower() not in names:
            return alt
        i += 1


def alive_players(token):
    room = rooms.get(token)
    if not room:
        return []
    return [(sid, p) for sid, p in room['players'].items() if p.get('alive', True)]


def players_payload(token):
    room = rooms.get(token)
    if not room:
        return []
    items = []
    for sid, p in room['players'].items():
        items.append({
            'sid': sid,
            'username': p['username'],
            'avatar': p.get('avatar', 'unknown'),
            'avatarType': p.get('avatarType', 'builtin'),
            'customImg': p.get('customImg') or '',
            'mic': p.get('mic', False),
            'speaking': p.get('speaking', False),
            'alive': p.get('alive', True),
            'is_host': sid == room['host'],
            'role': p.get('role') if room['game_phase'] == 'results' else None,
        })
    return items


def room_public_payload(token, room):
    return {
        'token': token,
        'room_name': room['room_name'],
        'players': len(room['players']),
        'started': room['started'],
        'phase': room['game_phase'],
        'phase_label': phase_label(room['game_phase']),
        'can_join': len(room['players']) < MAX_PLAYERS or not room['started'],
        'created_at': room.get('created_at', now_ts()),
    }


def broadcast(token, event, data):
    touch_room(token)
    socketio.emit(event, data, room=token)


def sync_players(token):
    if token not in rooms:
        return
    room = rooms[token]
    broadcast(token, 'update_players', {
        'players': players_payload(token),
        'count': len(room['players']),
        'host': room['host'],
        'phase': room['game_phase'],
        'phase_label': phase_label(room['game_phase']),
    })


def system_message(token, text):
    broadcast(token, 'new_message', {'type': 'system', 'msg': text})


def assign_roles(token):
    room = rooms.get(token)
    if not room:
        return
    sids = list(room['players'].keys())
    random.shuffle(sids)
    n = len(sids)
    num_mafia = 1 if n < 6 else max(2, n // 4)
    num_doctor = 1 if n >= 4 else 0
    num_detective = 1 if n >= 5 else 0
    num_citizen = n - num_mafia - num_doctor - num_detective
    roles = ['mafia'] * num_mafia + ['doctor'] * num_doctor + ['detective'] * num_detective + ['citizen'] * num_citizen
    random.shuffle(roles)
    for sid, role in zip(sids, roles):
        room['players'][sid]['role'] = role
        room['players'][sid]['alive'] = True


def check_win(token):
    alive = alive_players(token)
    mafia_count = sum(1 for _, p in alive if p['role'] == 'mafia')
    citizen_count = sum(1 for _, p in alive if p['role'] != 'mafia')
    if mafia_count == 0:
        return 'citizens'
    if mafia_count >= citizen_count:
        return 'mafia'
    return None


def end_game(token, winner):
    room = rooms.get(token)
    if not room:
        return
    reveal = []
    for sid, p in room['players'].items():
        reveal.append({
            'sid': sid,
            'username': p['username'],
            'avatar': p.get('avatar', 'unknown'),
            'avatarType': p.get('avatarType', 'builtin'),
            'customImg': p.get('customImg') or '',
            'role': p.get('role', 'citizen'),
            'alive': p.get('alive', True),
        })
    broadcast(token, 'game_over', {
        'winner': winner,
        'label': 'فاز فريق المدينة' if winner == 'citizens' else 'فاز فريق المافيا',
        'players': reveal,
    })
    room.update({
        'game_phase': 'waiting',
        'started': False,
        'votes': {},
        'night_actions': {},
        'game_round': 0,
        'protected_sid': None,
    })
    for p in room['players'].values():
        p['role'] = None
        p['alive'] = True
    sync_players(token)


def send_night_info(token):
    room = rooms.get(token)
    if not room:
        return
    all_alive = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p['alive']]
    non_mafia = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p['alive'] and p['role'] != 'mafia']
    for sid, player in room['players'].items():
        if not player.get('alive'):
            continue
        role = player.get('role')
        payload = {'role': role, 'targets': []}
        if role == 'mafia':
            payload['targets'] = non_mafia
        elif role == 'doctor':
            payload['targets'] = all_alive
        elif role == 'detective':
            payload['targets'] = [p for p in all_alive if p['sid'] != sid]
        socketio.emit('night_info', payload, room=sid)


def resolve_night(token):
    room = rooms.get(token)
    if not room:
        return
    kill_votes = {}
    for actor_sid, target_sid in room['night_actions'].items():
        actor = room['players'].get(actor_sid)
        if actor and actor.get('role') == 'mafia' and target_sid:
            kill_votes[target_sid] = kill_votes.get(target_sid, 0) + 1
    kill_sid = max(kill_votes, key=kill_votes.get) if kill_votes else None
    killed_name = None
    if kill_sid and kill_sid != room.get('protected_sid') and kill_sid in room['players']:
        room['players'][kill_sid]['alive'] = False
        killed_name = room['players'][kill_sid]['username']
    room['night_actions'] = {}
    room['protected_sid'] = None
    room['game_phase'] = 'day'
    room['updated_at'] = now_ts()
    system_message(token, f'بدأ النهار. خرج من اللعبة: {killed_name}' if killed_name else 'بدأ النهار. لم يخرج أحد هذه الليلة')
    winner = check_win(token)
    if winner:
        end_game(token, winner)
        return
    broadcast(token, 'phase_change', {'phase': 'day', 'round': room['game_round'], 'killed': killed_name})
    sync_players(token)


def resolve_vote(token):
    room = rooms.get(token)
    if not room:
        return
    counts = {}
    for target_sid in room['votes'].values():
        counts[target_sid] = counts.get(target_sid, 0) + 1
    eliminated_sid = None
    if counts:
        top = max(counts.values())
        candidates = [sid for sid, total in counts.items() if total == top]
        eliminated_sid = random.choice(candidates)
    eliminated_name = None
    if eliminated_sid and eliminated_sid in room['players']:
        room['players'][eliminated_sid]['alive'] = False
        eliminated_name = room['players'][eliminated_sid]['username']
    room['votes'] = {}
    room['game_round'] += 1
    room['game_phase'] = 'night'
    room['night_actions'] = {}
    room['protected_sid'] = None
    room['updated_at'] = now_ts()
    system_message(token, f'انتهى التصويت. خرج من اللعبة: {eliminated_name}' if eliminated_name else 'انتهى التصويت بلا إقصاء')
    winner = check_win(token)
    if winner:
        end_game(token, winner)
        return
    send_night_info(token)
    broadcast(token, 'phase_change', {'phase': 'night', 'round': room['game_round'], 'eliminated': eliminated_name})
    sync_players(token)


@app.route('/')
def index():
    cleanup_rooms()
    return render_template('index.html')


@app.route('/room/<token>')
def room_page(token):
    cleanup_rooms()
    token = token.upper()
    if token not in rooms:
        rooms[token] = new_room(token)
    return render_template('room.html', token=token, room_name=rooms[token]['room_name'])


@app.route('/create_room', methods=['POST'])
def create_room():
    cleanup_rooms()
    data = request.get_json(silent=True) or {}
    token = make_token()
    name = (data.get('room_name') or f'غرفة {token}').strip()[:40] or f'غرفة {token}'
    rooms[token] = new_room(name)
    return jsonify({'success': True, 'room_id': token, 'room_name': name})


@app.route('/room_exists/<token>')
def room_exists(token):
    cleanup_rooms()
    token = token.upper()
    room = rooms.get(token)
    if not room:
        return jsonify({'exists': False})
    return jsonify({
        'exists': True,
        'started': room['started'],
        'room_name': room['room_name'],
        'players': len(room['players']),
        'phase': room['game_phase'],
        'phase_label': phase_label(room['game_phase']),
    })


@app.route('/check_name', methods=['POST'])
def check_name():
    token = (request.json or {}).get('token', '').upper()
    name = ((request.json or {}).get('username') or '').strip()
    room = rooms.get(token)
    if not room:
        return jsonify({'taken': False, 'suggested': name})
    taken = name.lower() in used_names(token)
    return jsonify({'taken': taken, 'suggested': next_available_name(token, name) if taken else name})


@app.route('/api/stats')
def stats():
    cleanup_rooms()
    total = sum(len(room['players']) for room in rooms.values())
    return jsonify({'rooms': len(rooms), 'players': total})


@app.route('/api/rooms')
def recent_rooms():
    cleanup_rooms()
    items = []
    for token, room in rooms.items():
        if room.get('created_at', 0) >= now_ts() - ROOM_KEEP_SECONDS:
            items.append(room_public_payload(token, room))
    items.sort(key=lambda r: r['created_at'], reverse=True)
    return jsonify({'rooms': items[:20]})


@socketio.on('join')
def handle_join(data):
    try:
        cleanup_rooms()
        token = (data.get('room') or '').strip().upper()
        username = (data.get('username') or 'لاعب').strip()[:24] or 'لاعب'
        avatar = data.get('avatar') or 'unknown'
        avatar_type = data.get('avatarType') or 'builtin'
        custom_img = (data.get('customImg') or '').strip()
        if not token:
            return
        if token not in rooms:
            rooms[token] = new_room(token)
        room = rooms[token]
        existing_sid = next((sid for sid, p in room['players'].items() if p['username'].lower() == username.lower()), None)
        if existing_sid and existing_sid != request.sid:
            player_data = room['players'].pop(existing_sid)
            player_data['customImg'] = custom_img or player_data.get('customImg', '')
            room['players'][request.sid] = player_data
            if room['host'] == existing_sid:
                room['host'] = request.sid
        elif existing_sid == request.sid:
            if custom_img:
                room['players'][request.sid]['customImg'] = custom_img
        else:
            if len(room['players']) >= MAX_PLAYERS:
                emit('error', {'msg': f'الغرفة مكتملة. الحد الأقصى {MAX_PLAYERS} لاعب'})
                return
            if username.lower() in used_names(token):
                emit('name_taken', {'username': username, 'suggested': next_available_name(token, username)})
                return
            room['players'][request.sid] = {
                'username': username,
                'avatar': avatar,
                'avatarType': avatar_type,
                'customImg': custom_img,
                'mic': False,
                'speaking': False,
                'alive': True,
                'role': None,
            }
            if not room['host']:
                room['host'] = request.sid
            system_message(token, f'انضم {username} إلى الغرفة')
        join_room(token)
        touch_room(token)
        emit('joined_ok', {
            'token': token,
            'is_host': request.sid == room['host'],
            'room_name': room['room_name'],
            'my_sid': request.sid,
            'phase': room['game_phase'],
            'started': room['started'],
        })
        sync_players(token)
    except Exception as exc:
        log.exception('join error: %s', exc)
        emit('error', {'msg': 'تعذر الانضمام'})


@socketio.on('disconnect')
def handle_disconnect():
    try:
        for token, room in list(rooms.items()):
            if request.sid not in room['players']:
                continue
            username = room['players'][request.sid]['username']
            room['players'].pop(request.sid, None)
            if room['host'] == request.sid:
                room['host'] = next(iter(room['players']), None)
            touch_room(token)
            if not room['players']:
                continue
            system_message(token, f'غادر {username} الغرفة')
            sync_players(token)
            if room.get('started'):
                winner = check_win(token)
                if winner:
                    end_game(token, winner)
            break
    except Exception as exc:
        log.exception('disconnect error: %s', exc)


@socketio.on('toggle_mic')
def handle_mic(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if not room or request.sid not in room['players']:
        return
    state = bool(data.get('state', False))
    room['players'][request.sid]['mic'] = state
    if not state:
        room['players'][request.sid]['speaking'] = False
    sync_players(token)


@socketio.on('speaking')
def handle_speaking(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if not room or request.sid not in room['players']:
        return
    player = room['players'][request.sid]
    if not player.get('mic'):
        return
    player['speaking'] = bool(data.get('active', False))
    sync_players(token)


@socketio.on('chat_msg')
def handle_chat(data):
    token = (data.get('room') or '').upper()
    msg = (data.get('msg') or '').strip()[:500]
    room = rooms.get(token)
    if not room or not msg or request.sid not in room['players']:
        return
    player = room['players'][request.sid]
    if room.get('started') and not player.get('alive', True):
        emit('error', {'msg': 'اللاعب الخارج من اللعبة لا يرسل رسائل'})
        return
    broadcast(token, 'new_message', {
        'type': 'player',
        'user': player['username'],
        'avatar': player['avatar'],
        'avatarType': player['avatarType'],
        'customImg': player.get('customImg') or '',
        'msg': msg,
    })


@socketio.on('start_game')
def handle_start_game(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if not room:
        return
    if request.sid != room['host']:
        emit('error', {'msg': 'فقط الهوست يبدأ اللعبة'})
        return
    if len(room['players']) < MIN_PLAYERS:
        emit('error', {'msg': f'العدد غير كاف. تحتاج إلى {MIN_PLAYERS} لاعبين على الأقل'})
        return
    assign_roles(token)
    room['started'] = True
    room['game_phase'] = 'night'
    room['game_round'] = 1
    room['votes'] = {}
    room['night_actions'] = {}
    room['protected_sid'] = None
    room['updated_at'] = now_ts()
    broadcast(token, 'game_started', {'phase': 'night', 'round': 1})
    for sid, player in room['players'].items():
        role = player['role']
        socketio.emit('your_role', {'role': role, 'label': ROLES[role]['label'], 'color': ROLES[role]['color']}, room=sid)
    send_night_info(token)
    system_message(token, 'بدأت اللعبة. مرحلة الليل')
    sync_players(token)


@socketio.on('night_action')
def handle_night_action(data):
    token = (data.get('room') or '').upper()
    target_sid = data.get('target_sid') or ''
    room = rooms.get(token)
    if not room or request.sid not in room['players']:
        return
    if not room.get('started') or room['game_phase'] != 'night':
        return
    role = room['players'][request.sid].get('role')
    if role == 'mafia':
        room['night_actions'][request.sid] = target_sid
        emit('action_received', {'msg': 'تم تثبيت هدف المافيا'})
    elif role == 'doctor':
        room['protected_sid'] = target_sid
        emit('action_received', {'msg': 'تم اختيار اللاعب المحمي'})
    elif role == 'detective' and target_sid in room['players']:
        target_role = room['players'][target_sid]['role']
        emit('detective_result', {
            'username': room['players'][target_sid]['username'],
            'is_mafia': target_role == 'mafia',
            'role': ROLES[target_role]['label'],
        })
        room['night_actions'][request.sid] = target_sid

    mafia_sids = [sid for sid, p in room['players'].items() if p['alive'] and p['role'] == 'mafia']
    doctor_sids = [sid for sid, p in room['players'].items() if p['alive'] and p['role'] == 'doctor']
    detective_sids = [sid for sid, p in room['players'].items() if p['alive'] and p['role'] == 'detective']
    mafia_done = (not mafia_sids) or any(sid in room['night_actions'] for sid in mafia_sids)
    doctor_done = (not doctor_sids) or room['protected_sid'] is not None
    detective_done = (not detective_sids) or any(sid in room['night_actions'] for sid in detective_sids)
    if mafia_done and doctor_done and detective_done:
        resolve_night(token)


@socketio.on('force_night_end')
def force_night(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if room and request.sid == room['host'] and room['game_phase'] == 'night':
        resolve_night(token)


@socketio.on('start_vote')
def handle_start_vote(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if not room or request.sid != room['host'] or room['game_phase'] != 'day':
        return
    room['game_phase'] = 'voting'
    room['votes'] = {}
    alive = [{'sid': sid, 'username': p['username']} for sid, p in room['players'].items() if p['alive']]
    broadcast(token, 'phase_change', {'phase': 'voting', 'candidates': alive, 'round': room['game_round']})
    system_message(token, 'بدأ التصويت')


@socketio.on('cast_vote')
def handle_vote(data):
    token = (data.get('room') or '').upper()
    target_sid = data.get('target_sid') or ''
    room = rooms.get(token)
    if not room or request.sid not in room['players'] or room['game_phase'] != 'voting':
        return
    if not room['players'][request.sid].get('alive'):
        emit('error', {'msg': 'اللاعب الخارج من اللعبة لا يصوت'})
        return
    room['votes'][request.sid] = target_sid
    emit('vote_ack', {'msg': 'تم تسجيل صوتك'})
    counts = {}
    for sid in room['votes'].values():
        counts[sid] = counts.get(sid, 0) + 1
    broadcast(token, 'vote_update', {'counts': counts})
    if all(sid in room['votes'] for sid, p in room['players'].items() if p['alive']):
        resolve_vote(token)


@socketio.on('force_vote_end')
def force_vote(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if room and request.sid == room['host'] and room['game_phase'] == 'voting':
        resolve_vote(token)


@socketio.on('reset_game')
def handle_reset(data):
    token = (data.get('room') or '').upper()
    room = rooms.get(token)
    if not room or request.sid != room['host']:
        return
    room.update({
        'started': False,
        'game_phase': 'waiting',
        'game_round': 0,
        'votes': {},
        'night_actions': {},
        'protected_sid': None,
    })
    for p in room['players'].values():
        p['role'] = None
        p['alive'] = True
    broadcast(token, 'game_reset', {})
    system_message(token, 'تمت إعادة الجولة إلى اللوبي')
    sync_players(token)


@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_offer', {'from': request.sid, 'sdp': data.get('sdp')}, room=target)


@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_answer', {'from': request.sid, 'sdp': data.get('sdp')}, room=target)


@socketio.on('webrtc_ice')
def handle_webrtc_ice(data):
    target = data.get('target')
    if target:
        socketio.emit('webrtc_ice', {'from': request.sid, 'candidate': data.get('candidate')}, room=target)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
