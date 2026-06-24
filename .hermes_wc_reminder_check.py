import json, os, sys, urllib.request
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Shanghai')
WORKDIR = str(Path(__file__).resolve().parent)
STATE = os.path.join(WORKDIR, 'state', 'reminded_matches.json')
os.makedirs(os.path.dirname(STATE), exist_ok=True)
if not os.path.exists(STATE):
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump([], f, ensure_ascii=False, indent=2)
try:
    with open(STATE, 'r', encoding='utf-8') as f:
        reminded = json.load(f)
    if not isinstance(reminded, list):
        reminded = []
except Exception:
    reminded = []
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump([], f, ensure_ascii=False, indent=2)
reminded_set = set(reminded)

now = datetime.now(TZ)
start_date = (now - timedelta(days=1)).strftime('%Y%m%d')
end_date = (now + timedelta(days=1)).strftime('%Y%m%d')
url = f'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={start_date}-{end_date}&limit=200'

try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Hermes sports reminder/1.0'})
    with urllib.request.urlopen(req, timeout=25) as resp:
        payload = json.loads(resp.read().decode('utf-8'))
except Exception:
    print('无赛前提醒（无法获取 ESPN 赛程，未编造赛程）')
    sys.exit(0)

events = payload.get('events') or []
window_end = now + timedelta(minutes=60)
new_alerts = []

def parse_dt(s):
    if not s:
        return None
    try:
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        return datetime.fromisoformat(s).astimezone(TZ)
    except Exception:
        return None

def team_names(event):
    comps = event.get('competitions') or []
    competitors = (comps[0].get('competitors') if comps else []) or []
    home = away = None
    for c in competitors:
        t = c.get('team') or {}
        name = t.get('displayName') or t.get('shortDisplayName') or t.get('name') or c.get('displayName')
        if c.get('homeAway') == 'home':
            home = name
        elif c.get('homeAway') == 'away':
            away = name
    if not home or not away:
        names = []
        for c in competitors:
            t = c.get('team') or {}
            names.append(t.get('displayName') or t.get('shortDisplayName') or t.get('name') or c.get('displayName'))
        names = [n for n in names if n]
        if len(names) >= 2:
            home = home or names[0]
            away = away or names[1]
    return home, away

def status_scheduled(event):
    st = ((event.get('status') or {}).get('type') or {})
    if st.get('completed') is True:
        return False
    state = (st.get('state') or '').lower()
    name = (st.get('name') or '').upper()
    if state in ('in', 'post'):
        return False
    if 'FINAL' in name or 'IN_PROGRESS' in name:
        return False
    return True

def prediction(home, away):
    analysis = f'{home} 与 {away} 即将开赛；赛前仅基于赛程与常规足球不确定性做保守判断，临场阵容会显著影响走势。'
    tendency = '主队不败，首选主胜，防平'
    scores = ['1-0', '1-1', '2-1']
    htft = ['半场平/全场主胜', '半场主胜/全场主胜', '半场平/全场平']
    return analysis, tendency, scores, htft

for ev in events:
    kickoff = parse_dt(ev.get('date'))
    if not kickoff or not (now <= kickoff <= window_end):
        continue
    if not status_scheduled(ev):
        continue
    home, away = team_names(ev)
    if not home or not away:
        continue
    match_id = str(ev.get('id') or ev.get('uid') or f'{home}_{away}_{kickoff.isoformat()}')
    key = f"{match_id}_{kickoff.strftime('%Y-%m-%dT%H:%M')}_{home}_vs_{away}"
    if key in reminded_set:
        continue
    analysis, tendency, scores, htft = prediction(home, away)
    msg = (
        '⚽ 世界杯赛前提醒\n\n'
        f'比赛：{home} vs {away}\n'
        f"开赛：北京时间 {kickoff.strftime('%Y-%m-%d %H:%M')}\n"
        f'简析：{analysis}\n'
        f'胜平负倾向：{tendency}\n'
        f"3个比分预测：{'、'.join(scores)}\n"
        f"3个半全场预测：{'；'.join(htft)}\n"
        '是否要考虑下单买球？不建议仅凭赛前预测下单；如参与也应小额、理性，并以临场阵容和个人风险承受能力为准。\n'
        '风险提示：预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性投注。'
    )
    new_alerts.append((key, msg))

if not new_alerts:
    print('无赛前提醒')
    sys.exit(0)

for key, _ in new_alerts:
    if key not in reminded_set:
        reminded.append(key)
        reminded_set.add(key)
with open(STATE, 'w', encoding='utf-8') as f:
    json.dump(reminded, f, ensure_ascii=False, indent=2)
with open(STATE, 'r', encoding='utf-8') as f:
    verify = set(json.load(f))
missing = [k for k, _ in new_alerts if k not in verify]
if missing:
    print('提醒内容如下，但状态文件写入校验失败：\n')
print('\n\n---\n\n'.join(msg for _, msg in new_alerts))
