#!/usr/bin/env python3
"""Generate static data for the Beijing-time 2026 World Cup web dashboard."""
from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from pathlib import Path
from zoneinfo import ZoneInfo

BJ = ZoneInfo("Asia/Shanghai")
UTC = ZoneInfo("UTC")
PROJECT_DIR = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_DIR / "reports"
WEB_OUT = Path(os.environ.get("WORLDCUP_WEB_OUT", str(PROJECT_DIR)))
DATA_DIR = WEB_OUT / "data"
STATE_DIR = PROJECT_DIR / "state"
HISTORY_FILE = STATE_DIR / "web_predictions_history.json"
BET_HISTORY_FILE = STATE_DIR / "bet_recommendation_history.json"
SOURCE_CACHE = STATE_DIR / "espn_scoreboard_web.json"
SUMMARY_CACHE_DIR = STATE_DIR / "espn_summaries"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
UA = {"User-Agent": "WorldCupBeijingDashboard/1.0 (+local static report)"}
# Manual duplicate/noisy report exclusions for the dashboard stats audit trail.
# 2026-06-20-02-.md repeats predictions already present in 2026-06-20.md.
EXCLUDED_REPORT_FILES = {"2026-06-20-02-.md"}

ZH = {
    "United States": "美国", "Australia": "澳大利亚", "Scotland": "苏格兰", "Morocco": "摩洛哥",
    "Brazil": "巴西", "Haiti": "海地", "Turkiye": "土耳其", "Türkiye": "土耳其", "Turkey": "土耳其", "Paraguay": "巴拉圭",
    "Czechia": "捷克", "South Africa": "南非", "Bosnia-Herzegovina": "波黑", "Canada": "加拿大", "Qatar": "卡塔尔",
    "Uzbekistan": "乌兹别克斯坦", "Colombia": "哥伦比亚",
    "Netherlands": "荷兰", "Sweden": "瑞典", "Germany": "德国", "Ivory Coast": "科特迪瓦",
    "Ecuador": "厄瓜多尔", "Curacao": "库拉索", "Curaçao": "库拉索", "Tunisia": "突尼斯", "Japan": "日本",
    "Spain": "西班牙", "Saudi Arabia": "沙特阿拉伯", "Belgium": "比利时", "Iran": "伊朗",
    "Uruguay": "乌拉圭", "Cape Verde": "佛得角", "New Zealand": "新西兰", "Egypt": "埃及",
    "Argentina": "阿根廷", "France": "法国", "England": "英格兰", "Portugal": "葡萄牙", "Mexico": "墨西哥",
    "Canada": "加拿大", "Italy": "意大利", "Croatia": "克罗地亚", "Denmark": "丹麦", "Poland": "波兰",
    "Austria": "奥地利", "Iraq": "伊拉克", "Norway": "挪威", "Jordan": "约旦", "Algeria": "阿尔及利亚",
    "Switzerland": "瑞士", "Serbia": "塞尔维亚", "Korea Republic": "韩国", "South Korea": "韩国",
    "Cameroon": "喀麦隆", "Ghana": "加纳", "Senegal": "塞内加尔", "Nigeria": "尼日利亚",
    "Panama": "巴拿马", "Congo DR": "刚果（金）", "Congo Democratic Republic": "刚果（金）",
}

STRENGTH = {
    # S级：世界顶尖强队
    "Brazil": 96, "Spain": 94, "Argentina": 94, "France": 94,
    # A+级
    "England": 91, "Germany": 90, "Portugal": 90,
    # A级
    "Netherlands": 88, "Belgium": 86, "Croatia": 82, "Colombia": 82,
    # A-级
    "Uruguay": 84, "Italy": 83,
    # B+级
    "Denmark": 80, "Japan": 80, "Switzerland": 79, "Austria": 79,
    "Sweden": 78, "Ecuador": 78, "Morocco": 78, "Norway": 78, "Senegal": 78,
    "United States": 77, "Turkiye": 77, "Turkey": 77, "Poland": 77, "Korea Republic": 77, "South Korea": 77,
    "Algeria": 76, "Czechia": 76, "Mexico": 77,
    # B级
    "Scotland": 75, "Canada": 75, "Iran": 75,
    "Australia": 74, "Ivory Coast": 74, "Egypt": 74,
    "Nigeria": 73, "Tunisia": 73, "Bosnia-Herzegovina": 73, "Paraguay": 73,
    "Serbia": 76,
    # B-级
    "Cameroon": 72, "South Africa": 70, "Saudi Arabia": 70, "Ghana": 70,
    # C+级
    "Congo DR": 69, "Congo Democratic Republic": 69,
    "New Zealand": 68, "Cape Verde": 68, "Panama": 68,
    "Uzbekistan": 66, "Iraq": 67,
    "Jordan": 65, "Qatar": 65,
    # C级
    "Curacao": 64, "Curaçao": 64,
    "Haiti": 63,
}

@dataclass
class Match:
    id: str
    date_utc: datetime
    date_bj: datetime
    home: str
    away: str
    home_zh: str
    away_zh: str
    home_score: int | None
    away_score: int | None
    completed: bool
    status: str
    status_detail: str
    venue: str
    note: str
    link: str
    home_logo: str | None = None
    away_logo: str | None = None
    half_time_score: str | None = None
    half_full: str | None = None
    second_half_score: str | None = None

    @property
    def bj_date(self) -> str:
        return self.date_bj.strftime("%Y-%m-%d")

    @property
    def bj_time(self) -> str:
        return self.date_bj.strftime("%H:%M")

    @property
    def title(self) -> str:
        return f"{self.home_zh} vs {self.away_zh}"


def zh(name: str) -> str:
    return ZH.get(name, name)


def outcome(home_score: int, away_score: int) -> str:
    if home_score > away_score:
        return "主胜"
    if home_score < away_score:
        return "客胜"
    return "平"


def normalize_outcome_pick(text: str) -> str:
    raw = str(text or "")
    if "客胜" in raw or "负" in raw:
        return "客胜"
    if "平" in raw:
        return "平"
    if "主胜" in raw or "胜" in raw:
        return "主胜"
    return raw


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=35) as resp:
        return json.loads(resp.read().decode("utf-8"))


def outcome_to_home_code(text: str) -> str:
    """Convert outcome text to the home-team perspective used by half/full display."""
    t = (text or "").strip()
    if t in {"主胜", "胜"}:
        return "胜"
    if t in {"客胜", "负"}:
        return "负"
    if t in {"平", "平局"}:
        return "平"
    return t


def normalize_half_full(text: str) -> str:
    """Canonical half/full code from the home team's perspective, e.g. 平负 / 胜胜."""
    s = re.sub(r"\s+", "", text or "")
    s = s.replace("／", "/").replace("＋", "+").replace("-", "+")
    s = s.replace("半场", "").replace("全场", "")
    s = s.replace("主胜", "胜").replace("客胜", "负").replace("平局", "平")
    s = re.sub(r"[+/|、，,;；]", "", s)
    return s


def format_half_full_home(half: str, full: str) -> str:
    return f"{outcome_to_home_code(half)}{outcome_to_home_code(full)}"


def adjust_half_full_predictions(tendency: str, codes: list[str]) -> list[str]:
    """Keep half/full predictions in the home-team perspective.

    胜/平/负 are displayed relative to the listed home team, so 客胜 scenarios
    should normally include values such as 负负 or 平负. Do not rewrite them to
    home-win codes, otherwise cards like 苏格兰 vs 巴西 would incorrectly show 胜胜.
    """
    return list(codes)


def fetch_halftime_score(event_id: str) -> tuple[int, int] | None:
    """Return (home_ht, away_ht) from ESPN summary linescores when available."""
    if not event_id:
        return None
    SUMMARY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = SUMMARY_CACHE_DIR / f"{event_id}.json"
    try:
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={event_id}"
            data = fetch_json(url)
            cache.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        comps = (((data.get("header") or {}).get("competitions")) or [])
        if not comps:
            return None
        teams = {c.get("homeAway"): c for c in (comps[0].get("competitors") or [])}
        vals = []
        for side in ("home", "away"):
            line = teams.get(side, {}).get("linescores") or []
            if not line:
                return None
            raw = line[0].get("value", line[0].get("displayValue"))
            vals.append(int(raw))
        return vals[0], vals[1]
    except Exception:
        return None


def completed_half_full_fields(event_id: str, home_score: int | None, away_score: int | None) -> dict:
    """Return halftime / half-full display fields for a completed match when ESPN summary has linescores."""
    if home_score is None or away_score is None:
        return {}
    ht = fetch_halftime_score(event_id)
    if ht is None:
        return {}
    half_outcome = outcome(ht[0], ht[1])
    full_outcome = outcome(home_score, away_score)
    return {
        "half_time_score": f"{ht[0]}-{ht[1]}",
        "half_full": format_half_full_home(half_outcome, full_outcome),
        "second_half_score": f"{home_score - ht[0]}-{away_score - ht[1]}",
    }


def parse_events(data: dict) -> list[Match]:
    matches: list[Match] = []
    for e in data.get("events", []):
        comps = e.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]
        competitors = comp.get("competitors") or []
        teams = {c.get("homeAway"): c for c in competitors}
        if "home" not in teams or "away" not in teams:
            continue
        home_c, away_c = teams["home"], teams["away"]
        home = home_c.get("team", {}).get("displayName") or home_c.get("team", {}).get("shortDisplayName") or "Home"
        away = away_c.get("team", {}).get("displayName") or away_c.get("team", {}).get("shortDisplayName") or "Away"
        dt_utc = datetime.fromisoformat((e.get("date") or comp.get("date")).replace("Z", "+00:00")).astimezone(UTC)
        status_type = (e.get("status") or comp.get("status") or {}).get("type", {})
        completed = bool(status_type.get("completed"))
        def score(c):
            s = c.get("score")
            try:
                return int(s) if s is not None and s != "" else None
            except Exception:
                return None
        venue = comp.get("venue") or {}
        addr = venue.get("address") or {}
        venue_name = venue.get("fullName") or venue.get("name") or "待核实"
        if addr.get("city") or addr.get("country"):
            venue_name += f"，{addr.get('city','')}{('，' + addr.get('country')) if addr.get('country') else ''}"
        link = f"https://www.espn.com/soccer/match/_/gameId/{e.get('id')}"
        home_score = score(home_c)
        away_score = score(away_c)
        hf_fields = completed_half_full_fields(str(e.get("id") or comp.get("id")), home_score, away_score) if completed else {}
        matches.append(Match(
            id=str(e.get("id") or comp.get("id")), date_utc=dt_utc, date_bj=dt_utc.astimezone(BJ),
            home=home, away=away, home_zh=zh(home), away_zh=zh(away),
            home_score=home_score, away_score=away_score, completed=completed,
            status=status_type.get("description") or status_type.get("name") or "Scheduled",
            status_detail=status_type.get("detail") or status_type.get("shortDetail") or "",
            venue=venue_name, note=comp.get("altGameNote") or "", link=link,
            home_logo=(home_c.get("team") or {}).get("logo"), away_logo=(away_c.get("team") or {}).get("logo"),
            half_time_score=hf_fields.get("half_time_score"), half_full=hf_fields.get("half_full"),
            second_half_score=hf_fields.get("second_half_score"),
        ))
    return sorted(matches, key=lambda m: m.date_utc)


def team_strength(name: str) -> int:
    return STRENGTH.get(name, 72)


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def decimal_odds(prob: float, payout: float = 0.88, lo: float = 1.15, hi: float = 120.0) -> float:
    prob = max(0.001, min(0.95, prob))
    return round(max(lo, min(hi, payout / prob)), 2)


def home_outcome_code(label: str) -> str:
    if label in {"主胜", "胜"}:
        return "胜"
    if label in {"客胜", "负"}:
        return "负"
    return "平"


def poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def model_outcome_probs(diff: int) -> dict[str, float]:
    draw = max(0.16, min(0.32, 0.29 - abs(diff) * 0.0045))
    home_share = 1 / (1 + math.exp(-diff / 7.0))
    home = (1 - draw) * home_share
    away = 1 - draw - home
    return {"胜": home, "平": draw, "负": away}


def model_score_probs(diff: int) -> dict[str, float]:
    # Home-team perspective Poisson grid, tuned to football-score ranges.
    home_lam = max(0.45, min(3.2, 1.28 + diff * 0.035))
    away_lam = max(0.35, min(3.0, 1.08 - diff * 0.028))
    out: dict[str, float] = {}
    for h in range(0, 6):
        for a in range(0, 6):
            out[f"{h}-{a}"] = poisson_pmf(h, home_lam) * poisson_pmf(a, away_lam)
    return out


def model_half_full_probs(outcome_probs: dict[str, float]) -> dict[str, float]:
    half = {
        "胜": outcome_probs["胜"] * 0.54 + 0.08,
        "平": 0.44,
        "负": outcome_probs["负"] * 0.54 + 0.08,
    }
    s = sum(half.values())
    half = {k: v / s for k, v in half.items()}
    out: dict[str, float] = {}
    for h, hp in half.items():
        for f, fp in outcome_probs.items():
            corr = 1.42 if h == f else 0.78 if h == "平" else 0.58
            out[f"{h}{f}"] = hp * fp * corr
    total = sum(out.values()) or 1
    return {k: v / total for k, v in out.items()}


def make_sporttery_reference_odds(
    diff: int,
    scores: list[tuple[int, int]],
    half_full: list[str],
    main_outcome: str,
    upset_scores: list[tuple[int, int]] | None = None,
    upset_half_full: list[str] | None = None,
) -> dict:
    """China Sports Lottery-style decimal odds from the local model.

    This project has no authenticated official Sporttery odds feed.  Values are
    model-estimated decimal odds in the same play categories: 胜平负 / 比分 / 半全场.
    """
    outcome_probs = model_outcome_probs(diff)
    score_probs = model_score_probs(diff)
    hf_probs = model_half_full_probs(outcome_probs)
    score_labels = [f"{a}-{b}" for a, b in scores]
    upset_labels = [f"{a}-{b}" for a, b in (upset_scores or [])]
    upset_hf_labels = list(upset_half_full or [])
    outcome_odds = {k: decimal_odds(v, payout=0.89, lo=1.18, hi=12) for k, v in outcome_probs.items()}
    score_odds = {s: decimal_odds(score_probs.get(s, 0.01), payout=0.80, lo=4.0, hi=90) for s in score_labels}
    upset_score_odds = {s: decimal_odds(score_probs.get(s, 0.006), payout=0.80, lo=5.0, hi=120) for s in upset_labels}
    half_full_odds = {h: decimal_odds(hf_probs.get(h, 0.01), payout=0.82, lo=3.2, hi=80) for h in half_full}
    upset_half_full_odds = {h: decimal_odds(hf_probs.get(h, 0.006), payout=0.82, lo=4.0, hi=120) for h in upset_hf_labels}
    pick = home_outcome_code(main_outcome)
    return {
        "source": "模型参考赔付系数（按体彩玩法格式推算，非体彩官方实际赔率）",
        "outcome": outcome_odds,
        "outcome_pick": {"label": pick, "odds": outcome_odds.get(pick)},
        "scores": score_odds,
        "upset_scores": upset_score_odds,
        "half_full": half_full_odds,
        "upset_half_full": upset_half_full_odds,
    }


def make_upset_score_options(diff: int, base_scores: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Small-stake defensive score options for an upset/cold result scenario."""
    if diff >= 12:
        candidates = [(1, 1), (0, 1)]
    elif diff >= 5:
        candidates = [(1, 1), (1, 2)]
    elif diff >= 2:
        candidates = [(0, 1), (2, 2)]
    elif diff <= -12:
        candidates = [(1, 1), (1, 0)]
    elif diff <= -5:
        candidates = [(1, 1), (2, 1)]
    elif diff <= -2:
        candidates = [(1, 0), (2, 2)]
    else:
        candidates = [(0, 1), (1, 2)]
    seen = set(base_scores)
    return [s for s in candidates if s not in seen][:2]


def make_upset_half_full_options(diff: int, base_half_full: list[str]) -> list[str]:
    """Small-stake defensive half/full-time options for cold match scripts."""
    if diff >= 12:
        candidates = ["平平", "平负", "负负"]
    elif diff >= 5:
        candidates = ["平平", "负负", "胜负"]
    elif diff >= 2:
        candidates = ["负负", "平平", "胜负"]
    elif diff <= -12:
        candidates = ["平平", "平胜", "胜胜"]
    elif diff <= -5:
        candidates = ["平平", "胜胜", "负胜"]
    elif diff <= -2:
        candidates = ["胜胜", "平平", "负胜"]
    else:
        candidates = ["平负", "平胜", "负胜"]
    seen = {normalize_half_full(x) for x in base_half_full}
    return [h for h in candidates if normalize_half_full(h) not in seen][:2]


def make_prediction(m: Match) -> dict:
    hs = team_strength(m.home) + 2  # mild home designation advantage even on neutral-ish tournament listing
    aws = team_strength(m.away)
    diff = hs - aws

    if diff >= 18:
        # 碾压级优势：强队对弱旅，大比分碾压概率高
        tendency = "主胜"
        scores = [(3, 0), (2, 0), (4, 1), (4, 0)]
        htft = [("主胜", "主胜"), ("平", "主胜"), ("主胜", "平"), ("平", "平")]
        risk = "主队实力大幅领先，压迫性节奏下大比分概率较高，需防慢热开局。"
    elif diff >= 12:
        # 明显优势：主队更强但不至于碾压
        tendency = "主胜"
        scores = [(2, 0), (3, 1), (2, 1), (1, 0)]
        htft = [("主胜", "主胜"), ("平", "主胜"), ("主胜", "平"), ("平", "平")]
        risk = "主队整体实力占优明显，但世界杯氛围下弱队防守投入度高，首球关键。"
    elif diff >= 9:
        # 较大优势
        tendency = "主胜"
        scores = [(2, 1), (2, 0), (1, 0), (3, 1)]
        htft = [("平", "主胜"), ("主胜", "主胜"), ("主胜", "平"), ("平", "平")]
        risk = "主队占优，但世界杯大赛节奏谨慎，防守密度会压制进球数。"
    elif diff >= 5:
        # 小优势偏主队
        tendency = "主胜，防平"
        scores = [(2, 1), (1, 0), (1, 1), (0, 0)]
        htft = [("平", "主胜"), ("主胜", "主胜"), ("平", "平"), ("主胜", "平")]
        risk = "主队纸面与节奏略优，平局风险来自打不开局面。"
    elif diff >= 2:
        # 微弱主队优势
        tendency = "主胜，防平"
        scores = [(1, 0), (2, 1), (1, 1), (0, 0)]
        htft = [("平", "主胜"), ("平", "平"), ("主胜", "主胜"), ("主胜", "平")]
        risk = "主队略有上风，但差距有限，平局仍是合理结局。"
    elif diff <= -18:
        # 客队碾压
        tendency = "客胜"
        scores = [(0, 3), (0, 2), (1, 3), (0, 4)]
        htft = [("客胜", "客胜"), ("平", "客胜"), ("客胜", "平"), ("平", "平")]
        risk = "客队实力大幅领先，高比分客胜概率较高，主队难以组织有效进攻。"
    elif diff <= -12:
        # 客队明显优势
        tendency = "客胜"
        scores = [(0, 2), (1, 3), (0, 1), (1, 4)]
        htft = [("客胜", "客胜"), ("平", "客胜"), ("主胜", "客胜"), ("平", "平")]
        risk = "客队整体更强，但在中立/主场氛围下主队会拼死防守，需防低比分意外。"
    elif diff <= -9:
        # 较大客队优势
        tendency = "客胜"
        scores = [(0, 2), (1, 2), (0, 1), (1, 3)]
        htft = [("平", "客胜"), ("客胜", "客胜"), ("主胜", "客胜"), ("平", "平")]
        risk = "客队优势更清晰，若早段进球会扩大控场。"
    elif diff <= -5:
        # 小优势偏客队
        tendency = "客胜，防平"
        scores = [(1, 2), (0, 1), (1, 1), (0, 0)]
        htft = [("平", "客胜"), ("客胜", "客胜"), ("平", "平"), ("客胜", "平")]
        risk = "客队整体更稳，但杯赛小组赛节奏可能偏谨慎。"
    elif diff <= -2:
        # 微弱客队优势
        tendency = "客胜，防平"
        scores = [(0, 1), (1, 2), (1, 1), (0, 0)]
        htft = [("平", "客胜"), ("平", "平"), ("客胜", "客胜"), ("客胜", "平")]
        risk = "客队略有上风，主队主场动力可能制造变数，平局可防。"
    else:
        # diff 在 -1 到 1：真正均势
        tendency = "平局倾向，双方不败均可防"
        scores = [(1, 1), (0, 0), (1, 0), (2, 2)]
        htft = [("平", "平"), ("平", "主胜"), ("主胜", "平"), ("平", "客胜")]
        risk = "两队实力几乎相当，首球与定位球将主导走势，低比分平局概率最高。"

    main_outcome = outcome(*scores[0])
    half_full = adjust_half_full_predictions(tendency, [format_half_full_home(h, f) for h, f in htft])
    upset_scores = make_upset_score_options(diff, scores)
    upset_half_full = make_upset_half_full_options(diff, half_full)
    odds = make_sporttery_reference_odds(diff, scores, half_full, main_outcome, upset_scores, upset_half_full)
    return {
        "match_id": m.id,
        "generated_for_date": m.bj_date,
        "tendency": tendency,
        "primary_outcome": main_outcome,
        "scores": [f"{a}-{b}" for a, b in scores],
        "score_pairs": scores,
        "upset_scores": [f"{a}-{b}" for a, b in upset_scores],
        "upset_score_pairs": upset_scores,
        "half_full": half_full,
        "upset_half_full": upset_half_full,
        "half_full_pairs": htft,
        "odds": odds,
        "analysis": build_analysis(m, diff, risk),
    }


def build_analysis(m: Match, diff: int, risk: str) -> str:
    stronger = m.home_zh if diff >= 0 else m.away_zh
    weaker = m.away_zh if diff >= 0 else m.home_zh
    if abs(diff) >= 18:
        edge = f"{stronger}实力大幅领先，技术、体系和阵容深度全面压制{weaker}。"
    elif abs(diff) >= 12:
        edge = f"{stronger}整体实力、阵地推进和替补深度明显占优，{weaker}需要高效反击才能制造变数。"
    elif abs(diff) >= 9:
        edge = f"{stronger}整体实力占优，但世界杯大赛节奏下{weaker}防守投入度更高。"
    elif abs(diff) >= 5:
        edge = f"{stronger}略占上风，但{weaker}具备通过防守密度和转换制造麻烦的空间。"
    elif abs(diff) >= 2:
        edge = f"两队差距有限，{stronger}略有上风，但首球和定位球将显著改变比赛走势。"
    else:
        edge = "两队实力几乎相当，比赛更可能由临场效率、定位球和换人质量决定。"
    return f"{edge}{risk} 预测仅按赛前公开赛程与基础强弱模型生成，临近开赛请结合首发、伤停和天气。"


def normalize_team_name(name: str) -> str:
    text = re.sub(r"（.*?）|\(.*?\)", "", name or "")
    text = re.sub(r"^(?:主队|客队)\s*[：:]\s*", "", text.strip())
    text = text.replace("｜", " ").replace("|", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"\s+", " ", text).strip().lower()
    aliases = {
        "usa": "united states", "美国": "united states", "south korea": "korea republic",
        "czechia": "czechia", "turkiye": "turkey", "türkiye": "turkey", "curaçao": "curacao",
        "巴拿马": "panama", "刚果": "congo dr", "刚果（金）": "congo dr", "刚果(金)": "congo dr",
        "dr congo": "congo dr", "congo democratic republic": "congo dr",
    }
    if text in aliases:
        return aliases[text]
    for eng, cn in ZH.items():
        if text == cn.lower():
            return aliases.get(eng.lower(), eng.lower())
    return text


def split_prediction_items(raw: str) -> list[str]:
    raw = raw.strip().rstrip("。.")
    parts = re.split(r"[；;、，,]\s*", raw)
    return [p.strip() for p in parts if p.strip()]


def split_score_items(raw: str) -> list[str]:
    items = split_prediction_items(raw)
    out = []
    for item in items:
        m = re.search(r"(\d+)\s*-\s*(\d+)", item)
        out.append(f"{m.group(1)}-{m.group(2)}" if m else item)
    return out


def primary_outcome_from_text(tendency: str, scores: list[str]) -> str | None:
    t = tendency or ""
    if "主胜" in t:
        return "主胜"
    if "客胜" in t:
        return "客胜"
    if "平" in t:
        return "平"
    if scores:
        m = re.search(r"(\d+)\s*-\s*(\d+)", scores[0])
        if m:
            return outcome(int(m.group(1)), int(m.group(2)))
    return None


def report_date_bounds() -> tuple[datetime.date | None, datetime.date | None]:
    dates = []
    if REPORTS_DIR.exists():
        for p in REPORTS_DIR.glob("*.md"):
            m = re.match(r"(\d{4}-\d{2}-\d{2})", p.name)
            if m:
                dates.append(datetime.fromisoformat(m.group(1)).date())
    if not dates:
        return None, None
    return min(dates), max(dates)


def parse_report_predictions() -> list[dict]:
    """Parse markdown reports as the primary historical prediction source.

    The reports under PROJECT_DIR/reports are treated as the audit trail:
    each prediction block contributes score picks, WDL tendency, half/full-time picks,
    and later gets reconciled against ESPN actual results.
    """
    rows: list[dict] = []
    if not REPORTS_DIR.exists():
        return rows
    heading_re = re.compile(
        r"^(?:#{2,3})\s*(?:\d+\.\s*)?(?P<md>\d{2}(?:-|月)\d{2}(?:日)?)\s+(?P<hm>\d{2}:\d{2})\s*[｜|]?\s*(?P<teams>.+?)\s*(?:[｜|].*)?$",
        re.M,
    )
    for path in sorted(REPORTS_DIR.glob("*.md")):
        if path.name in EXCLUDED_REPORT_FILES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        fm = re.match(r"(\d{4})-(\d{2})-(\d{2})", path.name)
        report_year = int(fm.group(1)) if fm else datetime.now(BJ).year
        report_date = f"{fm.group(1)}-{fm.group(2)}-{fm.group(3)}" if fm else ""
        matches = list(heading_re.finditer(text))
        for idx, h in enumerate(matches, 1):
            block = text[h.end(): matches[idx].start() if idx < len(matches) else len(text)]
            score_m = re.search(r"[-*]\s*[34]个比分预测：\s*(.+)", block)
            hf_m = re.search(r"[-*]\s*[34]个半全场预测：\s*(.+)", block)
            tendency_m = re.search(r"[-*]\s*胜平负倾向：\s*(.+)", block)
            if not (score_m or hf_m or tendency_m):
                continue
            teams = re.sub(r"\s*[-—].*$", "", h.group("teams")).strip()
            tvs = re.split(r"\s+vs\s+", teams, flags=re.I)
            if len(tvs) != 2:
                continue
            home_raw, away_raw = [re.sub(r"^(?:主队|客队)\s*[：:]\s*", "", re.sub(r"（.*?）|\(.*?\)", "", x).strip()) for x in tvs]
            md = h.group("md").replace("月", "-").replace("日", "")
            date = f"{report_year}-{md}"
            scores = split_score_items(score_m.group(1)) if score_m else []
            half_full_raw = split_prediction_items(hf_m.group(1)) if hf_m else []
            tendency = tendency_m.group(1).strip() if tendency_m else ""
            half_full = adjust_half_full_predictions(tendency, [normalize_half_full(x) for x in half_full_raw if normalize_half_full(x)])
            rows.append({
                "source": "reports",
                "source_file": str(path),
                "source_file_name": path.name,
                "source_report_date": report_date,
                "source_index": idx,
                "report_match_key": f"{path.name}#{idx}",
                "date": date,
                "time": h.group("hm"),
                "date_bj": f"{date}T{h.group('hm')}:00+08:00",
                "home_zh": home_raw if home_raw in ZH.values() else zh(home_raw),
                "away_zh": away_raw if away_raw in ZH.values() else zh(away_raw),
                "home": home_raw,
                "away": away_raw,
                "title": f"{home_raw} vs {away_raw}",
                "prediction": {
                    "tendency": tendency,
                    "primary_outcome": primary_outcome_from_text(tendency, scores),
                    "scores": scores,
                    "half_full": half_full,
                },
            })
    return rows


def reconcile_report_predictions(report_rows: list[dict], matches: list[Match]) -> list[dict]:
    by_date = {}
    for m in matches:
        by_date.setdefault(m.bj_date, []).append(m)
    out = []
    for rec in report_rows:
        cands = by_date.get(rec.get("date"), [])
        home_keys = {normalize_team_name(rec.get("home", "")), normalize_team_name(rec.get("home_zh", ""))}
        away_keys = {normalize_team_name(rec.get("away", "")), normalize_team_name(rec.get("away_zh", ""))}
        found = None
        for m in cands:
            mh = {normalize_team_name(m.home), normalize_team_name(m.home_zh)}
            ma = {normalize_team_name(m.away), normalize_team_name(m.away_zh)}
            if (home_keys & mh and away_keys & ma) or (home_keys & ma and away_keys & mh):
                found = m
                break
        row = dict(rec)
        if found:
            row.update({
                "match_id": found.id,
                "date_bj": found.date_bj.isoformat(),
                "date": found.bj_date,
                "time": found.bj_time,
                "home": found.home,
                "away": found.away,
                "home_zh": found.home_zh,
                "away_zh": found.away_zh,
                "title": found.title,
                "status": found.status,
                "status_detail": found.status_detail,
                "link": found.link,
            })
            if found.completed and found.home_score is not None and found.away_score is not None:
                actual_score = f"{found.home_score}-{found.away_score}"
                actual_outcome = outcome(found.home_score, found.away_score)
                pred = row.get("prediction", {})
                ht = fetch_halftime_score(found.id)
                actual_half_full = None
                half_full_hit = None
                if ht is not None:
                    half_outcome = outcome(ht[0], ht[1])
                    actual_half_full = format_half_full_home(half_outcome, actual_outcome)
                    half_full_hit = normalize_half_full(actual_half_full) in {normalize_half_full(x) for x in pred.get("half_full", [])}
                row["completed"] = True
                row["actual"] = {"score": actual_score, "outcome": actual_outcome, "home_score": found.home_score, "away_score": found.away_score}
                if ht is not None:
                    row["actual"].update({"half_time_score": f"{ht[0]}-{ht[1]}", "half_full": actual_half_full})
                row["hit"] = {
                    "exact_score": actual_score in pred.get("scores", []),
                    "outcome": actual_outcome == pred.get("primary_outcome"),
                    "half_full": half_full_hit,
                    "half_full_note": "已从 ESPN summary linescores 读取半场比分。" if ht is not None else "当前数据源未返回半场比分，半全场命中率暂按待统计展示。",
                }
            else:
                row["completed"] = False
        else:
            row["matched"] = False
            row["completed"] = False
        out.append(row)
    return out


def calc_stats_from_records(rows: list[dict]) -> dict:
    completed = [r for r in rows if r.get("completed") and r.get("hit")]
    pending = [r for r in rows if not r.get("completed")]
    total = len(completed)
    exact = sum(1 for r in completed if r["hit"].get("exact_score"))
    outcome_hits = sum(1 for r in completed if r["hit"].get("outcome"))
    half_full_known = [r for r in completed if r["hit"].get("half_full") is not None]
    half_full_hits = sum(1 for r in half_full_known if r["hit"].get("half_full"))
    half_full_missing = total - len(half_full_known)
    by_date = {}
    for r in completed:
        d = r.get("date") or (r.get("date_bj", "")[:10])
        item = by_date.setdefault(d, {"date": d, "total": 0, "score_hits": 0, "outcome_hits": 0, "half_full_hits": 0, "half_full_checked": 0, "half_full_missing": 0})
        item["total"] += 1
        item["score_hits"] += 1 if r["hit"].get("exact_score") else 0
        item["outcome_hits"] += 1 if r["hit"].get("outcome") else 0
        if r["hit"].get("half_full") is not None:
            item["half_full_checked"] += 1
            item["half_full_hits"] += 1 if r["hit"].get("half_full") else 0
        else:
            item["half_full_missing"] += 1
    for item in by_date.values():
        item["half_full_total"] = item["total"]
        item["score_rate"] = round(item["score_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["outcome_rate"] = round(item["outcome_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["half_full_rate"] = round(item["half_full_hits"] / item["total"] * 100, 1) if item["total"] else None

    upset_by_date = {}
    upset_recent = []
    upset_score_total = upset_score_hits = 0
    upset_hf_total = upset_hf_hits = 0
    upset_combo_total = upset_combo_hits = 0
    for r in completed:
        pred = r.get("prediction") or {}
        actual = r.get("actual") or {}
        actual_score = actual.get("score")
        actual_hf = actual.get("half_full")
        upset_scores = {str(x) for x in pred.get("upset_scores", [])}
        upset_hfs = {normalize_half_full(x) for x in pred.get("upset_half_full", [])}
        has_score_pool = bool(upset_scores)
        has_hf_pool = bool(upset_hfs and actual_hf)
        if not has_score_pool and not has_hf_pool:
            continue
        score_hit = bool(actual_score and actual_score in upset_scores) if has_score_pool else None
        hf_hit = bool(actual_hf and normalize_half_full(actual_hf) in upset_hfs) if has_hf_pool else None
        combo_hit = bool(score_hit or hf_hit)
        if has_score_pool:
            upset_score_total += 1
            upset_score_hits += 1 if score_hit else 0
        if has_hf_pool:
            upset_hf_total += 1
            upset_hf_hits += 1 if hf_hit else 0
        upset_combo_total += 1
        upset_combo_hits += 1 if combo_hit else 0
        d = r.get("date") or (r.get("date_bj", "")[:10])
        item = upset_by_date.setdefault(d, {"date": d, "total": 0, "combo_hits": 0, "score_total": 0, "score_hits": 0, "half_full_total": 0, "half_full_hits": 0})
        item["total"] += 1
        item["combo_hits"] += 1 if combo_hit else 0
        if has_score_pool:
            item["score_total"] += 1
            item["score_hits"] += 1 if score_hit else 0
        if has_hf_pool:
            item["half_full_total"] += 1
            item["half_full_hits"] += 1 if hf_hit else 0
        row = dict(r)
        row["upset_hit"] = {"score": score_hit, "half_full": hf_hit, "any": combo_hit}
        upset_recent.append(row)
    for item in upset_by_date.values():
        item["combo_rate"] = round(item["combo_hits"] / item["total"] * 100, 1) if item["total"] else None
        item["score_rate"] = round(item["score_hits"] / item["score_total"] * 100, 1) if item["score_total"] else None
        item["half_full_rate"] = round(item["half_full_hits"] / item["half_full_total"] * 100, 1) if item["half_full_total"] else None
    upset_stats = {
        "total": upset_combo_total,
        "hits": upset_combo_hits,
        "rate": round(upset_combo_hits / upset_combo_total * 100, 1) if upset_combo_total else None,
        "score_total": upset_score_total,
        "score_hits": upset_score_hits,
        "score_rate": round(upset_score_hits / upset_score_total * 100, 1) if upset_score_total else None,
        "half_full_total": upset_hf_total,
        "half_full_hits": upset_hf_hits,
        "half_full_rate": round(upset_hf_hits / upset_hf_total * 100, 1) if upset_hf_total else None,
        "by_date": sorted(upset_by_date.values(), key=lambda x: x.get("date", "")),
        "recent": sorted(upset_recent, key=lambda r: r.get("date_bj", ""), reverse=True)[:30],
        "note": "爆冷命中率只统计包含防爆冷比分/半全场选项的已结算比赛；比分与半全场任一命中即计入综合命中。",
    }
    report_rows = [r for r in rows if r.get("source_type") != "dashboard_history"]
    dashboard_history_rows = [r for r in rows if r.get("source_type") == "dashboard_history"]
    report_files_with_predictions = {
        r.get("source_file_name") for r in report_rows if r.get("source_file_name")
    }
    return {
        "source": "reports+dashboard_history",
        "source_label": f"{REPORTS_DIR} Markdown 报告 + 页面自动预测历史",
        "report_files_total": len([p for p in REPORTS_DIR.glob("*.md") if p.name not in EXCLUDED_REPORT_FILES]) if REPORTS_DIR.exists() else 0,
        "report_files_with_predictions": len(report_files_with_predictions),
        "report_predictions_total": len(report_rows),
        "dashboard_history_predictions_total": len(dashboard_history_rows),
        "audited_predictions_total": len(rows),
        "pending_total": len(pending),
        "completed_total": total,
        "exact_score_hits": exact,
        "outcome_hits": outcome_hits,
        "exact_score_rate": round(exact / total * 100, 1) if total else None,
        "outcome_rate": round(outcome_hits / total * 100, 1) if total else None,
        "half_full_rate": round(half_full_hits / total * 100, 1) if total else None,
        "half_full_hits": half_full_hits,
        "half_full_total": total,
        "half_full_checked": len(half_full_known),
        "half_full_missing": half_full_missing,
        "half_full_note": f"半全场统计以已结算总场次为分母；已核对半场比分 {len(half_full_known)} 场，缺少半场比分 {half_full_missing} 场。" if total else "半全场命中统计需稳定半场比分源；当前暂无已结算比赛。",
        "by_date": sorted(by_date.values(), key=lambda x: x.get("date", "")),
        "recent": sorted(completed, key=lambda r: r.get("date_bj", ""), reverse=True)[:30],
        "pending": sorted(pending, key=lambda r: r.get("date_bj", ""))[:30],
        "upset": upset_stats,
    }


def merge_history_records_for_stats(report_rows: list[dict], history: dict) -> list[dict]:
    """Merge durable dashboard predictions with parsed Markdown reports for stats.

    The report parser only sees matches that were written into local Markdown files.
    When ESPN later exposes a fuller slate, update_history() keeps the dashboard's own
    pre-match predictions in history.json. Include those records here so the
    "recent settled" comparison does not silently drop same-day matches that were
    predicted by the dashboard but missing from a Markdown report.
    """
    merged: dict[str, dict] = {}

    def row_key(r: dict) -> str:
        return str(r.get("match_id") or "|".join([
            str(r.get("date_bj") or r.get("date") or ""),
            str(r.get("title") or ""),
        ]))

    for row in report_rows:
        merged[row_key(row)] = row

    for rec in history.get("predictions", {}).values():
        if not rec.get("completed") or not rec.get("hit"):
            continue
        key = row_key(rec)
        if key in merged:
            continue
        row = dict(rec)
        row["source_type"] = "dashboard_history"
        row["source_file_name"] = row.get("source_file_name") or "页面自动预测历史"
        row.setdefault("matched", True)
        merged[key] = row

    return list(merged.values())


def load_history() -> dict:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            backup = HISTORY_FILE.with_suffix(".broken.json")
            backup.write_text(HISTORY_FILE.read_text(encoding="utf-8", errors="ignore"), encoding="utf-8")
    return {"version": 1, "predictions": {}}


def save_history(history: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def update_history(history: dict, matches: list[Match], target_matches: list[Match]) -> None:
    preds = history.setdefault("predictions", {})
    # add/refresh predictions for target day until match starts/completes; keep same deterministic values
    now = datetime.now(BJ)
    for m in target_matches:
        pred = make_prediction(m)
        rec = preds.get(m.id, {})
        if not rec or not rec.get("completed"):
            rec.update({
                "match_id": m.id,
                "date_bj": m.date_bj.isoformat(),
                "date": m.bj_date,
                "home": m.home,
                "away": m.away,
                "home_zh": m.home_zh,
                "away_zh": m.away_zh,
                "title": m.title,
                "predicted_at": now.isoformat(),
                "prediction": pred,
            })
            preds[m.id] = rec
    # update actuals for all completed matches we know, including previous predictions
    by_id = {m.id: m for m in matches}
    for mid, rec in list(preds.items()):
        m = by_id.get(mid)
        if not m or not m.completed or m.home_score is None or m.away_score is None:
            continue
        pred = rec.get("prediction", {})
        if not pred.get("upset_scores") or not pred.get("upset_half_full"):
            enriched = make_prediction(m)
            for key in ("upset_scores", "upset_score_pairs", "upset_half_full"):
                pred.setdefault(key, enriched.get(key, []))
            pred_odds = pred.setdefault("odds", {})
            enriched_odds = enriched.get("odds", {})
            for key in ("upset_scores", "upset_half_full"):
                pred_odds.setdefault(key, enriched_odds.get(key, {}))
            rec["prediction"] = pred
        actual_score = f"{m.home_score}-{m.away_score}"
        actual_outcome = outcome(m.home_score, m.away_score)
        rec["completed"] = True
        rec["actual"] = {
            "home_score": m.home_score,
            "away_score": m.away_score,
            "score": actual_score,
            "outcome": actual_outcome,
            "status": m.status,
        }
        if m.half_time_score and m.half_full:
            rec["actual"].update({"half_time_score": m.half_time_score, "half_full": m.half_full})
        rec["hit"] = {
            "exact_score": actual_score in pred.get("scores", []),
            "outcome": actual_outcome == pred.get("primary_outcome"),
            "half_full": normalize_half_full(m.half_full) in {normalize_half_full(x) for x in pred.get("half_full", [])} if m.half_full else None,
            "upset_score": actual_score in pred.get("upset_scores", []),
            "upset_half_full": normalize_half_full(m.half_full) in {normalize_half_full(x) for x in pred.get("upset_half_full", [])} if m.half_full else None,
            "half_full_note": "已从 ESPN summary linescores 读取半场比分。" if m.half_full else "ESPN scoreboard 当前未稳定提供半场比分，半全场命中率暂不纳入总命中率。",
        }


def calc_stats(history: dict) -> dict:
    rows = list(history.get("predictions", {}).values())
    completed = [r for r in rows if r.get("completed") and r.get("hit")]
    total = len(completed)
    exact = sum(1 for r in completed if r["hit"].get("exact_score"))
    outcome_hits = sum(1 for r in completed if r["hit"].get("outcome"))
    by_date = {}
    for r in completed:
        d = r.get("date") or (r.get("date_bj", "")[:10])
        item = by_date.setdefault(d, {"date": d, "total": 0, "score_hits": 0, "outcome_hits": 0})
        item["total"] += 1
        item["score_hits"] += 1 if r["hit"].get("exact_score") else 0
        item["outcome_hits"] += 1 if r["hit"].get("outcome") else 0
    for item in by_date.values():
        item["score_rate"] = round(item["score_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["outcome_rate"] = round(item["outcome_hits"] / item["total"] * 100, 1) if item["total"] else 0
    recent = sorted(completed, key=lambda r: r.get("date_bj", ""), reverse=True)[:20]
    return {
        "completed_total": total,
        "exact_score_hits": exact,
        "outcome_hits": outcome_hits,
        "exact_score_rate": round(exact / total * 100, 1) if total else None,
        "outcome_rate": round(outcome_hits / total * 100, 1) if total else None,
        "half_full_rate": None,
        "half_full_note": "半全场命中统计需半场比分源；当前 ESPN scoreboard 未稳定提供，页面先展示预测项与待统计状态。",
        "by_date": sorted(by_date.values(), key=lambda x: x.get("date", "")),
        "recent": recent,
    }


def load_bet_history() -> dict:
    if BET_HISTORY_FILE.exists():
        try:
            data = json.loads(BET_HISTORY_FILE.read_text(encoding="utf-8"))
            data.setdefault("version", 1)
            data.setdefault("records", {})
            return data
        except Exception:
            backup = BET_HISTORY_FILE.with_suffix(".broken.json")
            backup.write_text(BET_HISTORY_FILE.read_text(encoding="utf-8", errors="ignore"), encoding="utf-8")
    return {"version": 1, "records": {}}


def save_bet_history(history: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    BET_HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def bet_hit_type(candidate: dict, actual: dict) -> bool | None:
    if not actual:
        return None
    ctype = candidate.get("type")
    pick = str(candidate.get("pick") or "")
    if ctype == "胜平负":
        return normalize_outcome_pick(pick) == actual.get("outcome")
    if ctype == "比分":
        m = re.search(r"(\d+)\s*-\s*(\d+)", pick)
        return bool(m and f"{m.group(1)}-{m.group(2)}" == actual.get("score"))
    if ctype == "半全场":
        if not actual.get("half_full"):
            return None
        codes = re.findall(r"[胜平负]", pick)
        pick_code = "".join(codes[-2:]) if len(codes) >= 2 else normalize_half_full(pick)
        return normalize_half_full(pick_code) == normalize_half_full(actual.get("half_full"))
    return None


def bet_candidate(match: Match | dict, pred: dict, category: str, ctype: str, pick: str, units: int, reason: str, play: str = "单关", legs: list[dict] | None = None) -> dict:
    is_dict = isinstance(match, dict)
    title = match.get("title") if is_dict else match.title
    match_id = match.get("match_id") or match.get("id") if is_dict else match.id
    date_bj = match.get("date_bj") if is_dict else match.date_bj.isoformat()
    return {
        "id": "|".join([str(match_id or title), category, play, ctype, str(pick)]),
        "match_id": str(match_id or ""),
        "date_bj": date_bj,
        "title": title,
        "category": category,
        "play": play,
        "type": ctype,
        "pick": pick,
        "units": int(units),
        "stake": int(units) * 2,
        "reason": reason,
        "legs": legs or [],
    }


def build_daily_bet_record_from_match_dicts(pred_rows: list[dict], target_date: str, now: datetime | None = None) -> dict:
    """Create the durable daily purchase recommendation snapshot.

    This mirrors the visible dashboard defaults, but keeps the record server-side so
    future runs can settle hit-rate stats even if the user never copies/exports the ticket.
    """
    now = now or datetime.now(BJ)
    candidates: list[dict] = []
    rows = sorted(pred_rows, key=lambda r: r.get("date_bj", ""))
    for idx, row in enumerate(rows):
        pred = row.get("prediction") or {}
        title = row.get("title") or f"{row.get('home_zh')} vs {row.get('away_zh')}"
        match_ref = {"id": row.get("id") or pred.get("match_id"), "match_id": row.get("id") or pred.get("match_id"), "date_bj": row.get("date_bj"), "title": title}
        primary = pred.get("primary_outcome") or pred.get("tendency") or "主胜"
        scores = pred.get("scores") or []
        half_full = pred.get("half_full") or []
        upset_scores = pred.get("upset_scores") or []
        upset_hf = pred.get("upset_half_full") or []
        candidates.append(bet_candidate(match_ref, pred, "main", "胜平负", primary, 2, "主线胜平负方向，作为基础仓位。"))
        if scores:
            candidates.append(bet_candidate(match_ref, pred, "main", "比分", scores[0], 1, "主线首选比分，小注增强。"))
        if half_full:
            candidates.append(bet_candidate(match_ref, pred, "main", "半全场", half_full[0], 1, "主线半全场走势，小注增强。"))
        if upset_scores:
            candidates.append(bet_candidate(match_ref, pred, "upset", "比分", f"防冷比分 {upset_scores[0]}", 1, "防爆冷比分小注，补平局或反向小胜。"))
        if upset_hf:
            candidates.append(bet_candidate(match_ref, pred, "upset", "半全场", f"防冷半全场 {upset_hf[0]}", 1, "防爆冷半全场小注，覆盖慢热、反转或弱队爆冷走势。"))
    # Conservative 2串1 mainline supplement: only primary outcomes from first two matches.
    if len(rows) >= 2:
        legs = []
        for row in rows[:2]:
            pred = row.get("prediction") or {}
            legs.append({
                "match_id": str(row.get("id") or pred.get("match_id") or ""),
                "title": row.get("title"),
                "type": "胜平负",
                "pick": pred.get("primary_outcome") or pred.get("tendency") or "主胜",
            })
        candidates.append({
            "id": f"{target_date}|parlay|main-outcome-2x1",
            "match_id": "",
            "date_bj": rows[0].get("date_bj"),
            "title": "主线胜平负2串1",
            "category": "parlay",
            "play": "2串1",
            "type": "串关",
            "pick": " × ".join(f"{leg['title']} {leg['pick']}" for leg in legs),
            "units": 1,
            "stake": 2,
            "reason": "只串主线胜平负，作为高风险补充。",
            "legs": legs,
        })
    return {
        "date": target_date,
        "created_at_bj": now.isoformat(),
        "strategy": {"budget": 52, "risk": "balanced", "mode": "daily-default", "note": "每日自动记录：主线为胜平负/首选比分/首选半全场；防爆冷为首个防冷比分/半全场；串关只作补充。"},
        "matches_total": len(rows),
        "candidates": candidates,
    }


def ensure_daily_bet_record(bet_history: dict, target_matches: list[Match], target_date: str, now: datetime) -> None:
    records = bet_history.setdefault("records", {})
    if not target_matches or target_date in records:
        return
    rows = [as_match_dict(m, include_pred=True) for m in target_matches]
    records[target_date] = build_daily_bet_record_from_match_dicts(rows, target_date, now)


def backfill_bet_history_from_prediction_history(bet_history: dict, prediction_history: dict) -> None:
    """Backfill older daily recommendation snapshots from dashboard prediction history.

    This gives the new hit-rate view immediate historical context; future dates are
    recorded once by ensure_daily_bet_record().
    """
    records = bet_history.setdefault("records", {})
    by_date: dict[str, list[dict]] = {}
    for rec in prediction_history.get("predictions", {}).values():
        pred = rec.get("prediction") or {}
        if not pred:
            continue
        d = rec.get("date") or str(rec.get("date_bj") or "")[:10]
        if not d or d in records:
            continue
        row = {
            "id": rec.get("match_id"),
            "date_bj": rec.get("date_bj"),
            "title": rec.get("title"),
            "home_zh": rec.get("home_zh"),
            "away_zh": rec.get("away_zh"),
            "prediction": pred,
        }
        by_date.setdefault(d, []).append(row)
    for d, rows in by_date.items():
        records[d] = build_daily_bet_record_from_match_dicts(rows, d)
        records[d]["backfilled"] = True


def settle_bet_history(bet_history: dict, prediction_history: dict, matches: list[Match]) -> None:
    by_id = {m.id: m for m in matches}
    pred_by_id = {str(r.get("match_id")): r for r in prediction_history.get("predictions", {}).values() if r.get("match_id")}

    def actual_for(mid: str) -> dict | None:
        m = by_id.get(str(mid))
        if m and m.completed and m.home_score is not None and m.away_score is not None:
            actual = {"score": f"{m.home_score}-{m.away_score}", "outcome": outcome(m.home_score, m.away_score), "home_score": m.home_score, "away_score": m.away_score}
            if m.half_full:
                actual["half_full"] = m.half_full
                actual["half_time_score"] = m.half_time_score
            return actual
        rec = pred_by_id.get(str(mid))
        if rec and rec.get("completed") and rec.get("actual"):
            return rec.get("actual")
        return None

    for record in bet_history.get("records", {}).values():
        settled = pending = hits = 0
        for c in record.get("candidates", []):
            if c.get("play") != "单关" and c.get("legs"):
                leg_results = []
                leg_details = []
                for leg in c.get("legs", []):
                    actual = actual_for(str(leg.get("match_id") or ""))
                    h = bet_hit_type(leg, actual or {}) if actual else None
                    leg_results.append(h)
                    leg_details.append({**leg, "actual": actual, "hit": h})
                if any(x is None for x in leg_results):
                    c["settled"] = False
                    c["hit"] = None
                    pending += 1
                else:
                    c["settled"] = True
                    c["hit"] = all(leg_results)
                    settled += 1
                    hits += 1 if c["hit"] else 0
                c["leg_results"] = leg_details
                continue
            actual = actual_for(str(c.get("match_id") or ""))
            if not actual:
                c["settled"] = False
                c["hit"] = None
                pending += 1
                continue
            c["actual"] = actual
            h = bet_hit_type(c, actual)
            if h is None:
                c["settled"] = False
                c["hit"] = None
                pending += 1
            else:
                c["settled"] = True
                c["hit"] = bool(h)
                settled += 1
                hits += 1 if h else 0
        record["settlement"] = {
            "settled": settled,
            "pending": pending,
            "hits": hits,
            "rate": round(hits / settled * 100, 1) if settled else None,
            "settled_at_bj": datetime.now(BJ).isoformat(),
        }


def calc_bet_stats(bet_history: dict) -> dict:
    records = sorted(bet_history.get("records", {}).values(), key=lambda r: r.get("date", ""))
    candidates = []
    for rec in records:
        for c in rec.get("candidates", []):
            row = dict(c)
            row["record_date"] = rec.get("date")
            row["record_strategy"] = rec.get("strategy", {})
            candidates.append(row)
    settled = [c for c in candidates if c.get("settled") and c.get("hit") is not None]
    pending = [c for c in candidates if not c.get("settled")]

    def agg(rows: list[dict]) -> dict:
        total = len(rows)
        hits = sum(1 for c in rows if c.get("hit"))
        return {"total": total, "hits": hits, "rate": round(hits / total * 100, 1) if total else None}

    by_category = {k: agg([c for c in settled if c.get("category") == k]) for k in ("main", "upset", "parlay")}
    by_type = {k: agg([c for c in settled if c.get("type") == k]) for k in ("胜平负", "比分", "半全场", "串关")}
    by_date = []
    for rec in records:
        rows = [c for c in rec.get("candidates", []) if c.get("settled") and c.get("hit") is not None]
        main = [c for c in rows if c.get("category") == "main"]
        upset = [c for c in rows if c.get("category") == "upset"]
        parlay = [c for c in rows if c.get("category") == "parlay"]
        item = {"date": rec.get("date"), **agg(rows), "main": agg(main), "upset": agg(upset), "parlay": agg(parlay), "pending": len([c for c in rec.get("candidates", []) if not c.get("settled")])}
        if rows or item["pending"]:
            by_date.append(item)

    recent = sorted(settled, key=lambda c: (c.get("record_date", ""), c.get("date_bj", "")), reverse=True)[:40]
    suggestions = []
    score_rate = by_type.get("比分", {}).get("rate")
    upset_rate = by_category.get("upset", {}).get("rate")
    parlay_rate = by_category.get("parlay", {}).get("rate")
    main_rate = by_category.get("main", {}).get("rate")
    if score_rate is not None and score_rate < 35:
        suggestions.append("比分单项命中偏低：主线保留首选比分，资金权重继续向胜平负/半全场倾斜；比分只做小注增强。")
    if upset_rate is not None and main_rate is not None and upset_rate < main_rate:
        suggestions.append("防爆冷命中低于主线：只保留每场1个最核心防冷比分/半全场，减少冷门覆盖过宽导致的无效注。")
    if parlay_rate is not None and parlay_rate < 30:
        suggestions.append("串关波动最大：默认限制为2串1，只有主线连续命中率稳定后再提高串关占比。")
    suggestions.append("后续增强方向：按购买推荐实际结算结果动态调整权重，连续低命中玩法自动降权，连续命中玩法小幅升权。")
    overall = agg(settled)
    return {
        "records_total": len(records),
        "settled_total": overall["total"],
        "hits": overall["hits"],
        "rate": overall["rate"],
        "pending_total": len(pending),
        "by_category": by_category,
        "by_type": by_type,
        "by_date": by_date,
        "recent": recent,
        "suggestions": suggestions,
        "note": "购买推荐命中率按每日自动记录的推荐项逐项结算：单关按对应玩法命中；串关需所有子项命中才算命中。",
    }


def as_match_dict(m: Match, include_pred: bool = False) -> dict:
    d = {
        "id": m.id, "date_bj": m.date_bj.isoformat(), "date": m.bj_date, "time": m.bj_time,
        "home": m.home, "away": m.away, "home_zh": m.home_zh, "away_zh": m.away_zh,
        "title": m.title, "status": m.status, "status_detail": m.status_detail, "completed": m.completed,
        "home_score": m.home_score, "away_score": m.away_score, "venue": m.venue, "note": m.note,
        "link": m.link, "home_logo": m.home_logo, "away_logo": m.away_logo,
        "half_time_score": m.half_time_score, "half_full": m.half_full,
        "second_half_score": m.second_half_score,
    }
    if include_pred:
        d["prediction"] = make_prediction(m)
    return d


def main() -> int:
    now = datetime.now(BJ)
    report_rows = parse_report_predictions()
    min_report_date, _ = report_date_bounds()
    # Query enough UTC range to cover the whole local reports audit trail plus upcoming predictions.
    default_start = now.date() - timedelta(days=4)
    if min_report_date:
        default_start = min(default_start, min_report_date - timedelta(days=1))
    start = default_start.strftime("%Y%m%d")
    end = (now.date() + timedelta(days=5)).strftime("%Y%m%d")
    url = f"{ESPN_BASE}?dates={start}-{end}&limit=300"
    data = fetch_json(url)
    SOURCE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SOURCE_CACHE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    matches = parse_events(data)

    today = now.date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    def on_date(m: Match, d) -> bool:
        return m.date_bj.date() == d

    today_matches = [m for m in matches if on_date(m, today)]
    yesterday_matches = [m for m in matches if on_date(m, yesterday)]
    tomorrow_matches = [m for m in matches if on_date(m, tomorrow)]
    target_matches = [m for m in matches if on_date(m, tomorrow) and not m.completed]
    if not target_matches:
        # Fallback: if the local tomorrow bucket is empty, use the next scheduled slate after Beijing tomorrow starts.
        start_dt = datetime.combine(tomorrow, time.min, BJ)
        target_matches = [m for m in matches if (not m.completed and m.date_bj >= start_dt)]

    history = load_history()
    update_history(history, matches, target_matches)
    bet_history = load_bet_history()
    backfill_bet_history_from_prediction_history(bet_history, history)
    ensure_daily_bet_record(bet_history, target_matches, tomorrow.isoformat(), now)
    settle_bet_history(bet_history, history, matches)
    save_history(history)
    save_bet_history(bet_history)
    report_predictions = reconcile_report_predictions(report_rows, matches)
    audited_predictions = merge_history_records_for_stats(report_predictions, history)
    stats = calc_stats_from_records(audited_predictions)
    bet_stats = calc_bet_stats(bet_history)

    current = {
        "generated_at_bj": now.isoformat(),
        "generated_at_label": now.strftime("%Y-%m-%d %H:%M:%S 北京时间"),
        "timezone": "Asia/Shanghai",
        "source": {"name": "ESPN FIFA World Cup scoreboard API", "url": url},
        "report_source": {
            "directory": str(REPORTS_DIR),
            "windows_directory": "C:\\nginx-1.24.0\\html\\worldcup2\\reports",
            "files_total": stats.get("report_files_total", 0),
            "predictions_total": stats.get("report_predictions_total", 0),
            "description": "命中率统计以本地 Markdown 预测报告为主数据源；若报告漏掉同日已预测比赛，会补入页面自动预测历史，再与 ESPN 完赛比分核对。",
        },
        "dates": {
            "today": today.isoformat(), "yesterday": yesterday.isoformat(),
            "tomorrow": tomorrow.isoformat(), "prediction_target": tomorrow.isoformat(),
        },
        "summary": {
            "today_count": len(today_matches), "tomorrow_count": len(tomorrow_matches),
            "prediction_count": len(target_matches), "completed_known": sum(1 for m in matches if m.completed),
        },
        "sections": {
            "yesterday_results": [as_match_dict(m) for m in yesterday_matches],
            "today_matches": [as_match_dict(m) for m in today_matches],
            "tomorrow_matches": [as_match_dict(m) for m in tomorrow_matches],
            "day_after_predictions": [as_match_dict(m, include_pred=True) for m in target_matches],
            "report_predictions": report_predictions,
            "all_known_matches": [as_match_dict(m) for m in matches],
        },
        "stats": stats,
        "bet_stats": bet_stats,
        "risk_notice": "预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性看球。",
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "current.json").write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "bet_recommendation_history.json").write_text(json.dumps(bet_history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Generated {DATA_DIR / 'current.json'}")
    print(f"Prediction target {tomorrow.isoformat()}, matches={len(target_matches)}")
    for m in target_matches:
        print(f"- {m.date_bj:%m-%d %H:%M} {m.title}")
    print(f"Report source {REPORTS_DIR}, files={stats.get('report_files_total', 0)}, parsed_predictions={stats.get('report_predictions_total', 0)}, completed={stats.get('completed_total', 0)}")
    print(f"Bet recommendation records={bet_stats.get('records_total', 0)}, settled={bet_stats.get('settled_total', 0)}, hit_rate={bet_stats.get('rate')}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
