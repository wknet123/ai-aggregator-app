#!/usr/bin/env python
"""
导入 AI 角色资源库到 MinIO + 数据库（幂等，可反复运行以增量追加新资源）。

资源目录约定（示例 /home/juhe0092/AI_role_stock）：

    <root>/
      main.png, detail.png            ← 顶层参考图，跳过
      古代历史/                        ← 一级分类
        中国-先秦/                     ← 二级分类
          诸侯国君/                    ← 叶子 = 一个角色（含 角色属性.txt）
            1.png 2.png 3.png 4.png
            角色属性.txt

规则：
  - 逐级目录 → AICharacterCategory（物化 path 去重 upsert）
  - 含「角色属性.txt」的文件夹 → 一个 AICharacter（以 path+name 为自然键去重）
  - 图片 1..N.png 上传到 MinIO：public/ai_characters/{category_path}/{character_key}/{n}.png
  - 已存在的角色默认跳过；--force 时删除旧记录+图片后重建

运行（容器内）：
    docker compose exec backend python -m scripts.import_ai_characters --root /data/AI_role_stock
或本机（需能连通 MinIO/MySQL）：
    python -m scripts.import_ai_characters --root /path/to/AI_role_stock

参数：
    --root PATH     资源根目录（默认 /data/AI_role_stock）
    --force         已存在的角色也重新导入（覆盖）
    --dry-run       只扫描打印，不写库/不上传
"""
import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, delete

from app.db.session import AsyncSessionLocal
from app.models.ai_character import AICharacterCategory, AICharacter, AICharacterImage
from app.services.storage import get_storage_service, StorageService
from app.utils.ai_character_parser import parse_character_attributes

ATTR_FILE_NAMES = ("角色属性.txt", "角色描述.txt")   # 兼容两种命名
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
SKIP_NAMES = {".DS_Store", "main.png", "detail.png", "Thumbs.db"}


def _is_character_dir(d: Path) -> bool:
    return any((d / n).exists() for n in ATTR_FILE_NAMES)


def _attr_file(d: Path) -> Path | None:
    for n in ATTR_FILE_NAMES:
        p = d / n
        if p.exists():
            return p
    return None


def _images(d: Path) -> list[Path]:
    """返回按 1,2,3,4 数字序排列的图片（无编号的排后面）。"""
    files = [f for f in d.iterdir()
             if f.is_file() and f.suffix.lower() in IMAGE_EXTS and f.name not in SKIP_NAMES]

    def sort_key(f: Path):
        stem = f.stem
        return (0, int(stem)) if stem.isdigit() else (1, f.name)

    return sorted(files, key=sort_key)


async def _get_or_create_category(db, path: str, name: str, level: int,
                                   parent_id: int | None, dry: bool) -> int | None:
    existing = (await db.execute(
        select(AICharacterCategory).where(AICharacterCategory.path == path)
    )).scalar_one_or_none()
    if existing:
        return existing.id
    if dry:
        print(f"  [dry] + category L{level}: {path}")
        return None
    cat = AICharacterCategory(parent_id=parent_id, name=name, path=path,
                              level=level, sort_order=0)
    db.add(cat)
    await db.flush()   # 拿到 id
    print(f"  + category L{level}: {path}")
    return cat.id


async def _walk_categories(db, base: Path, root: Path, parent_id: int | None,
                           dry: bool) -> None:
    """递归：为每个非角色的子目录建分类，遇到角色目录则导入角色。"""
    subdirs = sorted([d for d in base.iterdir()
                      if d.is_dir() and d.name not in SKIP_NAMES])
    for d in subdirs:
        rel_path = str(d.relative_to(root)).replace("\\", "/")
        level = len(rel_path.split("/"))
        if _is_character_dir(d):
            # d 的父目录就是所属分类；父分类应已在上层建立
            await _import_character(db, d, root, dry)
        elif any(x.is_dir() and x.name not in SKIP_NAMES for x in d.iterdir()):
            # 含子目录 → 视为分类，继续下钻
            cat_id = await _get_or_create_category(db, rel_path, d.name, level, parent_id, dry)
            await _walk_categories(db, d, root, cat_id, dry)
        else:
            # 叶子目录但无 角色属性.txt 且无子目录 → 资源不完整，跳过并告警
            print(f"    ! 跳过不完整资源目录（缺 角色属性.txt / 无子目录）: {rel_path}")


async def _import_character(db, d: Path, root: Path, dry: bool,
                            force: bool = False) -> None:
    rel_path = str(d.relative_to(root)).replace("\\", "/")
    category_path = str(d.parent.relative_to(root)).replace("\\", "/")
    name = d.name

    # 所属分类必须存在（走 _walk 时父级已建）
    cat = (await db.execute(
        select(AICharacterCategory).where(AICharacterCategory.path == category_path)
    )).scalar_one_or_none()
    if not cat and not dry:
        # 兜底：直接为父路径链补建分类
        parts = category_path.split("/")
        parent_id = None
        for i, part in enumerate(parts, start=1):
            p = "/".join(parts[:i])
            cid = await _get_or_create_category(db, p, part, i, parent_id, dry)
            parent_id = cid
        cat = (await db.execute(
            select(AICharacterCategory).where(AICharacterCategory.path == category_path)
        )).scalar_one_or_none()

    existing = (await db.execute(
        select(AICharacter).where(AICharacter.path == category_path, AICharacter.name == name)
    )).scalar_one_or_none()

    if existing and not force:
        print(f"    = skip existing character: {rel_path}")
        return
    if existing and force and not dry:
        # 删除旧图片对象 + 记录
        storage = get_storage_service()
        for im in existing.images:
            await storage.delete(im.image_path)
        await db.execute(delete(AICharacter).where(AICharacter.id == existing.id))
        await db.flush()

    attr_path = _attr_file(d)
    raw = attr_path.read_text(encoding="utf-8", errors="ignore") if attr_path else ""
    attrs, feature, costume = parse_character_attributes(raw)

    images = _images(d)
    if not images:
        print(f"    ! no images, skip: {rel_path}")
        return

    if dry:
        print(f"  [dry] + character: {rel_path}  imgs={len(images)}  attrs={len(attrs)}")
        return

    char_key = str(uuid.uuid4())
    storage = get_storage_service()

    image_records: list[AICharacterImage] = []
    cover_key = None
    for idx, img_path in enumerate(images):
        stem = img_path.stem
        slot = int(stem) if stem.isdigit() else idx + 1
        object_key = storage.ai_character_key(category_path, char_key, f"{slot}{img_path.suffix.lower()}")
        content_type = StorageService.content_type_for(img_path.name)
        data = img_path.read_bytes()
        await storage.upload_bytes(data, object_key, content_type)
        image_records.append(AICharacterImage(image_path=object_key, slot=slot, sort_order=idx))
        if idx == 0:
            cover_key = object_key

    character = AICharacter(
        character_key=char_key,
        category_id=cat.id if cat else None,
        path=category_path,
        name=name,
        attributes_json=json.dumps(attrs, ensure_ascii=False) if attrs else None,
        attributes_raw=raw or None,
        feature_desc=feature or None,
        costume_desc=costume or None,
        cover_path=cover_key,
        sort_order=0,
    )
    character.images = image_records
    db.add(character)
    await db.flush()
    print(f"    + character: {rel_path}  imgs={len(images)}  attrs={len(attrs)}")


async def main(root: str, force: bool, dry: bool) -> None:
    root_path = Path(root)
    if not root_path.exists():
        print(f"❌ 资源根目录不存在: {root_path}")
        sys.exit(1)

    print(f"📂 扫描: {root_path}  (force={force}, dry_run={dry})")

    if not dry:
        # 确保桶存在
        try:
            await get_storage_service().ensure_bucket()
        except Exception as exc:
            print(f"⚠️  MinIO ensure_bucket 失败: {exc}")

    async with AsyncSessionLocal() as db:
        if force:
            # force 模式下逐个角色目录单独处理（先建分类树，再强制重导）
            await _walk_and_import(db, root_path, dry, force=True)
        else:
            await _walk_categories(db, root_path, root_path, None, dry)
        if not dry:
            await db.commit()

    # 统计
    if not dry:
        async with AsyncSessionLocal() as db:
            n_cat = (await db.execute(select(AICharacterCategory))).scalars().all()
            n_char = (await db.execute(select(AICharacter))).scalars().all()
            print(f"\n✅ 完成。分类总数={len(n_cat)}  角色总数={len(n_char)}")
    else:
        print("\n(dry-run 完成，未写库)")


async def _walk_and_import(db, root_path: Path, dry: bool, force: bool) -> None:
    """force 模式：先建全部分类，再对所有角色目录强制导入。"""
    # 建分类
    def rec_categories(base: Path):
        for d in sorted([x for x in base.iterdir() if x.is_dir() and x.name not in SKIP_NAMES]):
            if _is_character_dir(d):
                continue
            yield d
            yield from rec_categories(d)

    for d in rec_categories(root_path):
        rel = str(d.relative_to(root_path)).replace("\\", "/")
        level = len(rel.split("/"))
        parent_rel = str(d.parent.relative_to(root_path)).replace("\\", "/")
        parent = None
        if parent_rel and parent_rel != ".":
            parent = (await db.execute(
                select(AICharacterCategory).where(AICharacterCategory.path == parent_rel)
            )).scalar_one_or_none()
        await _get_or_create_category(db, rel, d.name, level, parent.id if parent else None, dry)
    await db.flush()

    # 导入角色
    def rec_chars(base: Path):
        for d in sorted([x for x in base.iterdir() if x.is_dir() and x.name not in SKIP_NAMES]):
            if _is_character_dir(d):
                yield d
            else:
                yield from rec_chars(d)

    for d in rec_chars(root_path):
        await _import_character(db, d, root_path, dry, force=force)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/data/AI_role_stock", help="资源根目录")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的角色")
    ap.add_argument("--dry-run", action="store_true", help="只扫描不写库")
    args = ap.parse_args()
    asyncio.run(main(args.root, args.force, args.dry_run))
