"""
AI 角色属性 txt 解析器。

解析 AI_role_stock 角色文件夹下的 `角色属性.txt`，其结构固定为：

    角色属性

    大类
        古代
    文化区域
        东亚
    ...(共 13 个固定属性键)...
    场景
        诸侯争霸与百家争鸣

    辨识特征

    <一段自由文本>

    着装描述

    <一段自由文本>

返回 (attributes: dict[str,str], feature_desc: str, costume_desc: str)。
容错：缺键则跳过；未知行忽略。
"""
from __future__ import annotations

# 固定 13 维属性键（与 detail.png 右侧属性网格一致）
ATTRIBUTE_KEYS = [
    "大类", "文化区域", "时代", "性别", "年龄段", "物种",
    "体格", "身高", "肤色", "发长", "发色", "气质", "场景",
]

_SECTION_HEADERS = {"角色属性", "辨识特征", "着装描述"}

# 顺时针视角名称（index 0..3 ↔ AI 角色图 slot 1..4）：立绘→特写→表情→三视图。
# 与前端 AICharacterLibraryModal.SLOT_LABEL 保持同款语义。
VIEW_NAMES = ["特征图片", "肖像特写", "各种表情", "三个角度视图"]


def view_caption(name: str, index: int) -> str:
    """按序号生成一张图的视角描述定义，如 view_caption("林晚", 1) → "林晚的肖像特写"。

    index 从 0 起（对应第 1 张 / slot 1）；超出 4 个视角或角色名为空时返回空串。
    用于「手动上传」的角色图（无角色描述文本可对应，只能给通用视角名）。
    """
    name = (name or "").strip()
    if not name or index < 0 or index >= len(VIEW_NAMES):
        return ""
    return f"{name}的{VIEW_NAMES[index]}"


def ai_character_slot_caption(name: str, slot: int, description: str) -> str:
    """AI 角色四视图（顺时针 slot 1..4）的默认图片描述。

    按需求：以角色描述内容（build_description 的多行输出，通常 3 行：
    属性摘要 / 辨识特征 / 着装）逐行对应：
      - 第一幅(slot 1) → 描述第 1 行
      - 第二幅(slot 2) → 描述第 2 行
      - 第三幅(slot 3) → 统一「{角色名}的各种表情」
      - 第四幅(slot 4) → 描述第 3 行
    对应行缺失时回退到通用视角名（view_caption）。
    """
    name = (name or "").strip()
    lines = [ln.strip() for ln in (description or "").split("\n") if ln.strip()]

    def line(i: int) -> str:
        return lines[i] if 0 <= i < len(lines) else ""

    if slot == 1:
        return line(0) or view_caption(name, 0)
    if slot == 2:
        return line(1) or view_caption(name, 1)
    if slot == 3:
        return f"{name}的各种表情" if name else "各种表情"
    if slot == 4:
        return line(2) or view_caption(name, 3)
    return view_caption(name, slot - 1)


def parse_character_attributes(text: str) -> tuple[dict[str, str], str, str]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    attr_keys = set(ATTRIBUTE_KEYS)

    attributes: dict[str, str] = {}
    feature_lines: list[str] = []
    costume_lines: list[str] = []

    section = None          # None | 'attrs' | 'feature' | 'costume'
    pending_key: str | None = None

    for raw in lines:
        stripped = raw.strip()
        if not stripped:
            continue

        # 段落切换
        if stripped == "角色属性":
            section, pending_key = "attrs", None
            continue
        if stripped == "辨识特征":
            section, pending_key = "feature", None
            continue
        if stripped == "着装描述":
            section, pending_key = "costume", None
            continue

        if section == "attrs":
            if stripped in attr_keys:
                pending_key = stripped
            elif pending_key is not None:
                # 属性值行（缩进）；同一键只取首个值
                attributes.setdefault(pending_key, stripped)
                pending_key = None
        elif section == "feature":
            feature_lines.append(stripped)
        elif section == "costume":
            costume_lines.append(stripped)

    return attributes, "\n".join(feature_lines).strip(), "\n".join(costume_lines).strip()


def build_description(attributes: dict[str, str], feature_desc: str, costume_desc: str) -> str:
    """把属性 + 两段描述拼成一段人类可读描述，用于实例化要素的 description 字段。"""
    parts: list[str] = []
    summary = " · ".join(
        attributes[k] for k in ("性别", "年龄段", "体格", "气质") if attributes.get(k)
    )
    if summary:
        parts.append(summary)
    if feature_desc:
        parts.append(f"辨识特征：{feature_desc}")
    if costume_desc:
        parts.append(f"着装：{costume_desc}")
    return "\n".join(parts)
