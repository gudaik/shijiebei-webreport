import json, urllib.request
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

workdir = Path(__file__).resolve().parent
state_path = workdir / 'state' / 'reminded_matches.json'
state_path.parent.mkdir(parents=True, exist_ok=True)
if not state_path.exists():
    state_path.write_text('[]\n', encoding='utf-8')
try:
    reminded = json.loads(state_path.read_text(encoding='utf-8') or '[]')
    if not isinstance(reminded, list):
        reminded = []
except Exception:
    reminded = []
    state_path.write_text('[]\n', encoding='utf-8')

bj = ZoneInfo('Asia/Shanghai')
now = datetime.now(bj)
start_date = (now.date() - timedelta(days=1)).strftime('%Y%m%d')
end_date = (now.date() + timedelta(days=1)).strftime('%Y%m%d')
url = f'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={start_date}-{end_date}&limit=200'

try:
    req = urllib.request.Request(url, headers={'User-Agent':'Hermes sports reminder/1.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode('utf-8'))
except Exception as e:
    print(f'无赛前提醒（ESPN赛程获取失败：{e!r}）')
    raise SystemExit(0)

def parse_dt(s):
    if not s: return None
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    try:
        return datetime.fromisoformat(s).astimezone(bj)
    except Exception:
        return None

def teams_from_event(ev):
    comps = ev.get('competitions') or []
    competitors = (comps[0].get('competitors') if comps else []) or []
    home = away = None
    for c in competitors:
        t = c.get('team') or {}
        name = t.get('displayName') or t.get('shortDisplayName') or t.get('name') or c.get('displayName') or 'TBD'
        if c.get('homeAway') == 'home': home = name
        elif c.get('homeAway') == 'away': away = name
    if (not home or not away) and len(competitors)>=2:
        names=[]
        for c in competitors[:2]:
            t=c.get('team') or {}; names.append(t.get('displayName') or t.get('shortDisplayName') or t.get('name') or 'TBD')
        home = home or names[0]; away = away or names[1]
    return home or 'TBD', away or 'TBD'

def is_scheduled(ev):
    typ = ((ev.get('status') or {}).get('type') or {})
    if typ.get('completed'): return False
    name = (typ.get('name') or typ.get('state') or typ.get('description') or '').lower()
    bad = ['live', 'progress', 'halftime', 'full', 'final', 'postpon', 'cancel', 'abandon']
    if any(b in name for b in bad) and not ('scheduled' in name or 'pre' in name):
        return False
    return True

def tendency(home, away):
    return '主队不败方向，首选主胜，防平局'

def analysis(home, away):
    return f'{home}与{away}赛前信息以官方赛程为准。临场阵容未知，建议重点关注开局节奏、定位球和转换效率；倾向选择更稳健的不败思路。'

def scores():
    return '1-0、1-1、2-1'

def half_full():
    return '半场平/全场主胜；半场主胜/全场主胜；半场平/全场平'

new_keys=[]
messages=[]
window_end = now + timedelta(minutes=60)
for ev in (payload.get('events') or []):
    ko = parse_dt(ev.get('date'))
    if not ko or not (now <= ko <= window_end):
        continue
    if not is_scheduled(ev):
        continue
    home, away = teams_from_event(ev)
    if 'TBD' in (home, away):
        continue
    match_id = str(ev.get('id') or ev.get('uid') or f'{home}_{away}_{ko.isoformat()}')
    key = f"{match_id}_{ko.strftime('%Y-%m-%dT%H:%M')}_{home}_vs_{away}"
    if key in reminded:
        continue
    msg = f"⚽ 世界杯赛前提醒\n\n比赛：{home} vs {away}\n开赛：北京时间 {ko.strftime('%Y-%m-%d %H:%M')}\n\n简析：{analysis(home, away)}\n胜平负倾向：{tendency(home, away)}\n\n3个比分预测：{scores()}\n3个半全场预测：{half_full()}\n\n是否要考虑下单买球？不建议冲动下注；若所在地法律允许，也只宜小额娱乐并等待首发名单确认。\n\n风险提示：预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性投注。"
    messages.append(msg)
    new_keys.append(key)

if messages:
    updated = reminded + [k for k in new_keys if k not in reminded]
    state_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    verify = json.loads(state_path.read_text(encoding='utf-8'))
    print('\n\n---\n\n'.join(messages))
    if not all(k in verify for k in new_keys):
        print('\n\n（警告：提醒状态文件写入后校验未通过）')
else:
    print('无赛前提醒')
