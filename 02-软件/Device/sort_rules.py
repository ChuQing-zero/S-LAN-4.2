# -*- coding: utf-8 -*-
r"""
sort_rules.py —— 分拣规则：存储 + 匹配

规则集结构（存在 config.json 的 SORT_RULES 里，页面保存后不丢）：

SORT_RULES = {
    "identMode": "图像识别",          # 图像识别 / NFC识别 / 条形码识别 / 多种
    "aiKeyword": "",
    "ruleSet": 1,                     # 当前用哪一套（1/2）
    "sets": {
        "1": [ {outlet,addr,side,type,value}, ... 8 条 ],
        "2": [ ... ]
    }
}

规则类型（type）：
    前缀      卡牌编号以 value 开头
    精确      卡牌编号 == value
    关键字    卡名 或 编号 包含 value
    类别      类别 == value（怪兽卡 / 魔法卡 / 陷阱卡）
    星数区间  value 形如 "<=4"、">=5"、"4"、"3-5"
    兜底      直接命中（不看内容）

多值：value 里用 / 或 , 分隔，任意一个相等就算命中
    例：类别 = "融合怪兽/同调怪兽/超量怪兽/连接怪兽"

第二条件（AND）：规则里可带 type2 / value2，两条都命中才算命中
    例：类别=通常怪兽/效果怪兽  且  星数区间=>=5

匹配顺序：按 1#~8# 顺序逐条比，第一条命中的就是出口。
都没有命中 → 返回 OUTLET_FALLBACK（9 = 兜底，皮带送走，不做舵机动作）。
"""

OUTLET_FALLBACK = 9

RULE_TYPES = ["前缀", "精确", "关键字", "类别", "星数区间", "兜底"]

# 出口 → (单元地址, 左/右)
OUTLET_MAP = {
    1: ("0x20", "L"), 2: ("0x20", "R"),
    3: ("0x21", "L"), 4: ("0x21", "R"),
    5: ("0x22", "L"), 6: ("0x22", "R"),
    7: ("0x23", "L"), 8: ("0x23", "R"),
    9: (None, None),          # 兜底：不动作
}

OUTLET_NAMES = {
    1: "1#左", 2: "2#右", 3: "3#左", 4: "4#右",
    5: "5#左", 6: "6#右", 7: "7#左", 8: "8#右", 9: "兜底(送走)",
}


def default_sets():
    """默认 8 条规则（空规则，8# 兜底）"""
    def row(i, addr, side, rtype="前缀"):
        return {
            "outlet": "%d#%s" % (i, "左" if side == "L" else "右"),
            "addr": addr,
            "side": side,
            "type": rtype,
            "value": "",
        }

    return [
        row(1, "0x20", "L"),
        row(2, "0x20", "R", "精确"),
        row(3, "0x21", "L"),
        row(4, "0x21", "R"),
        row(5, "0x22", "L"),
        row(6, "0x22", "R"),
        row(7, "0x23", "L"),
        row(8, "0x23", "R", "兜底"),
    ]


def default_rules():
    return {
        "identMode": "图像识别",
        "aiKeyword": "",
        "ruleSet": 1,
        "sets": {"1": default_sets(), "2": default_sets()},
    }


# ------------------------------------------------------------------ 匹配
def _as_int(v, d=None):
    try:
        return int(str(v).strip())
    except Exception:
        return d


def _match_level(value, level):
    """星数区间：支持 '<=4' '>=5' '=4' '4' '3-5'"""
    if level is None:
        return False
    s = str(value).strip().replace(" ", "")
    if not s:
        return False
    if s.startswith("<="):
        n = _as_int(s[2:])
        return n is not None and level <= n
    if s.startswith(">="):
        n = _as_int(s[2:])
        return n is not None and level >= n
    if s.startswith("<"):
        n = _as_int(s[1:])
        return n is not None and level < n
    if s.startswith(">"):
        n = _as_int(s[1:])
        return n is not None and level > n
    if "-" in s:
        a, b = s.split("-", 1)
        na, nb = _as_int(a), _as_int(b)
        if na is None or nb is None:
            return False
        return na <= level <= nb
    n = _as_int(s.lstrip("="))
    return n is not None and level == n


def _one_hit(rtype, value, ident):
    """单个条件是否命中"""
    rtype = str(rtype or "").strip()
    value = str(value or "").strip()

    if rtype == "兜底":
        return True
    if not value:
        return False

    # 多值：任一项匹配即可
    if rtype in ("类别", "前缀", "精确", "关键字") and ("/" in value or "," in value):
        parts = [x.strip() for x in value.replace(",", "/").split("/") if x.strip()]
        for one in parts:
            if _one_hit(rtype, one, ident):
                return True
        return False

    code = str(ident.get("code", "") or "").strip().upper()
    name = str(ident.get("name", "") or "").strip()
    cat = str(ident.get("category", "") or "").strip()
    level = _as_int(ident.get("level"))

    if rtype == "前缀":
        return bool(code) and code.startswith(value.upper())
    if rtype == "精确":
        return bool(code) and code == value.upper()
    if rtype == "关键字":
        v = value.upper()
        return (code and v in code) or (value in name)
    if rtype == "类别":
        return bool(cat) and (value in cat or cat in value)
    if rtype == "星数区间":
        return _match_level(value, level)
    return False


def _hit(rule, ident):
    """单条规则是否命中 ident；支持第二条件（AND）"""
    if not _one_hit(rule.get("type"), rule.get("value"), ident):
        return False
    t2 = rule.get("type2")
    if t2:
        if not _one_hit(t2, rule.get("value2"), ident):
            return False
    return True


def match_outlet(ident, rules):
    """
    返回 (outlet_no, 命中的规则 dict 或 None)
    ident 例：{"code":"00121217","name":"青眼白龙","category":"怪兽卡","level":4}
    """
    if not rules:
        return OUTLET_FALLBACK, None
    rule_set = rules.get("sets", {}).get(str(rules.get("ruleSet", 1)), [])
    for i, rule in enumerate(rule_set):
        if _hit(rule, ident):
            return i + 1, rule
    return OUTLET_FALLBACK, None


def describe(ident, outlet, rule):
    """给日志用的一句话说明"""
    why = "未命中任何规则" if rule is None else (
        "命中规则 %s(%s=%s)" % (rule.get("outlet", ""), rule.get("type", ""), rule.get("value", ""))
    )
    return "识别=%s → %s  %s" % (
        {k: v for k, v in ident.items() if v not in (None, "", [])},
        OUTLET_NAMES.get(outlet, str(outlet)),
        why,
    )
