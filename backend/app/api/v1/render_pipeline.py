"""
Render Pipeline API – chained video generation for storyboard shots.

POST /              – start a new render pipeline
GET  /{pipeline_id} – poll pipeline + shot statuses
POST /{pipeline_id}/shots/{shot_index}/retry – retry a failed shot with new seed
"""
import asyncio
import hashlib
import json
import logging
import uuid
from typing import Optional, Union

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_user
from app.models.render_pipeline import RenderPipeline
from app.models.generation_task import GenerationTask
from app.models.user import User
from app.schemas.response import ResponseBase

logger = logging.getLogger(__name__)
router = APIRouter()


# 景别映射（与前端 drama-compose.SHOT_SIZE_CN 保持同款）；standard → 空（不强调）。
SHOT_SIZE_CN: dict[str, str] = {
    "closeup": "近景",
    "wide": "远景",
    "extreme": "特写",
    "standard": "",
}


# ── Prompt builder ───────────────────────────────────────────────────────

def build_beat_prompt(
    beats: list[dict],
    *,
    global_desc: str = "",
    images: Optional[list[dict]] = None,
    has_video: bool = False,
    has_audio: bool = False,
    video_label: str = "",
    audio_label: str = "",
    unify_voice: bool = False,
    composition: str = "",
    narration: str = "",
    bgm_label: str = "",
) -> str:
    """把时间段 beats 拼成「剧创提示词」（中文）。

    与前端 frontend/src/utils/drama-compose.ts 的 buildPrompt 保持同款规范：
    图片以「图片N」序号 + 名称代入（序号即提交给 API 的 content 顺序），
    确保视频生成 API 能按序号正确区分使用每张素材。
    - 图片清单前缀：「本镜参考图：图片1为「红苹果」(首帧)、图片2为「奶盖」(尾帧)。」无名称的图仅写「图片N」。
    - 全局图片用途：设了 usage 的图片另起一行「全程使用图片N「名称」<用途>。」（如第一视角构图）。
    - 参考视频/音频：有则各加一行，带名称（无名称用通用措辞），以点到方式说明其作用。
    - 整集级全局选项：人称(narration) / 构图视角(composition) / 背景音乐(bgm_label)。
    - beats：time + action，景别(shotSize) 非 standard 时前缀「（近景/远景/特写）」。
    has_video/has_audio/unify_voice 仅为兼容旧调用保留，unify_voice 不再产出文本。
    """
    lines: list[str] = []

    # 图片清单：按顺序「图片N为「名称」」，序号与提交给 API 的图片顺序一一对应；首尾帧加标注
    roster: list[str] = []
    for idx, im in enumerate(images or []):
        name = (im.get("label") or "").strip()
        base = f"图片{idx + 1}为「{name}」" if name else f"图片{idx + 1}"
        fr = im.get("frame")
        suffix = "(首帧)" if fr == "first" else "(尾帧)" if fr == "last" else ""
        roster.append(base + suffix)
    if roster:
        lines.append(f"本镜参考图：{'、'.join(roster)}。")

    # 配置元素的「形态/特征描述」：逐张「全片保持图片N「名称」的形象特征：<描述>。」
    # （来自「配置」里角色/场景/道具的 description，让要素形态/特征贯穿全片，保证生成一致）
    for idx, im in enumerate(images or []):
        desc = (im.get("desc") or "").strip()
        if not desc:
            continue
        name = (im.get("label") or "").strip()
        who = f"图片{idx + 1}「{name}」" if name else f"图片{idx + 1}"
        lines.append(f"全片保持{who}的形象特征：{desc}。")

    # 全局参考图的「用途/视角」：逐张「全程使用图片N「名称」<用途>。」
    # （对应整集素材库给图片设的用途，如「第一视角构图」，让该约束贯穿全片）
    for idx, im in enumerate(images or []):
        usage = (im.get("usage") or "").strip()
        if not usage:
            continue
        name = (im.get("label") or "").strip()
        who = f"图片{idx + 1}「{name}」" if name else f"图片{idx + 1}"
        lines.append(f"全程使用{who}{usage}。")

    # 参考视频 / 参考音频（带名称代入，点到其作用）
    if has_video:
        vn = (video_label or "").strip()
        lines.append(f"参考视频「{vn}」：全程沿用其运镜构图。" if vn else "参考视频：全程沿用其运镜构图。")
    if has_audio:
        an = (audio_label or "").strip()
        lines.append(f"参考音频「{an}」：全程作为背景音乐。" if an else "参考音频：全程作为背景音乐。")

    # ── 整集级全局选项 ──
    nr = (narration or "").strip()
    if nr:
        lines.append(f"全片采用{nr}视角。")
    cp = (composition or "").strip()
    if cp:
        lines.append(f"构图视角：{cp}。")
    bg = (bgm_label or "").strip()
    if bg:
        lines.append(f"参考音频「{bg}」：全程作为背景音乐。")

    g = (global_desc or "").strip()
    if g:
        lines.append(g)

    for b in beats:
        a = str(b.get("action", "") or "").strip()
        if not a:
            continue
        t = str(b.get("time", "") or "").strip()
        size_key = str(b.get("shotSize", "") or "")
        sz = SHOT_SIZE_CN.get(size_key, "") if size_key != "standard" else ""
        body = f"（{sz}）{a}" if sz else a
        lines.append(f"{t}：{body}" if t else body)
    return "\n".join(lines)


def _beats_have_content(beats: list["BeatInput"]) -> bool:
    """True if at least one beat carries action / sfx / voice text."""
    return any((b.action or b.sfx or b.voice) for b in beats)


# ── Request / Response schemas ───────────────────────────────────────────

class BeatInput(BaseModel):
    time: str = ""
    action: str = ""
    sfx: str = ""
    voice: str = ""
    imageRef: Optional[int] = None
    shotSize: str = ""        # 景别：closeup/wide/extreme/standard；standard/空=默认不强调

class ShotImage(BaseModel):
    """有序参考图：kind = 'frame'(首尾帧图) | 'illustration'(插图)。
    frame 按顺序填 Seedance 首帧→尾帧（多余并入额外参考）；illustration 全进额外参考。"""
    key: str
    name: str = ""
    kind: str = "frame"       # 'frame' | 'illustration'
    label: str = ""           # 素材名称
    frame: str = ""           # 首尾帧指定：'first' | 'last' | ''（提示词标注用）
    usage: str = ""           # 用途/视角（全局图片代入「全程使用图片N…」），缺省不输出
    desc: str = ""            # 形态/特征描述（配置元素 description，代入「形象特征」行）

class ShotInput(BaseModel):
    id: str
    index: int
    duration: int = 5
    aspect_ratio: Optional[str] = None             # 该镜画幅，缺省用 body.aspect_ratio
    global_desc: str = ""                           # 该镜整体视角/风格概述（取代 scene_prompt）
    unify_voice: bool = False
    generate_audio: bool = False
    final_prompt: str = ""                           # AI 重构后的最终提示词（非空则覆盖确定性基线）
    # ── 整集级全局选项（已由前端按集汇入每镜，便于无状态拼装） ──
    composition: str = ""                            # 构图视角
    narration: str = ""                              # 人称定义
    bgm_label: str = ""                              # 背景音乐名称（代入提示词）
    # ── 时间段分镜（Seedance 2.0）：每镜必填 ──
    beats: list[BeatInput] = Field(default_factory=list)
    # ── 有序参考图（角色/参考图）：每镜至少 1 张，对应 图片1..N ──
    images: list[ShotImage] = Field(default_factory=list)
    reference_video_key: Optional[str] = None       # 视频1（单条可选）
    reference_video_label: str = ""                  # 在剧创提示词中代入的名称
    audio_key: Optional[str] = None                 # 音频1（单条可选）
    audio_label: str = ""                           # 在剧创提示词中代入的名称

class StartPipelineRequest(BaseModel):
    shots: list[ShotInput] = Field(..., min_length=1)
    model_id: str = "kling-v1"  # pricing tier; mapped to a gateway video family at render time
    aspect_ratio: str = "16:9"
    # 项目归属（用于成片存盘路径；结果回写 episodes_data 由前端轮询后自动保存完成）
    drama_project_id: Optional[str] = None
    episode: Optional[int] = None
    # False → 只逐镜生成分镜视频，不做 ffmpeg 拼接成片（成片改由「合并成片」步骤显式触发）
    compose: bool = True

class RetryShotRequest(BaseModel):
    seed_offset: int = Field(default=1, description="Offset added to original seed")

# Per-shot credit cost by model
PIPELINE_CREDIT_COSTS: dict[str, int] = {
    "kling-v1": 100,
    "kling-v2": 150,
    "kling-2.5": 200,
    "runway-gen3": 200,
}
DEFAULT_PIPELINE_SHOT_COST = 100


# ── Route: Start Pipeline ────────────────────────────────────────────────

@router.post("", response_model=ResponseBase)
async def start_pipeline(
    body: StartPipelineRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # ── Credit check ──
    per_shot_cost = PIPELINE_CREDIT_COSTS.get(body.model_id, DEFAULT_PIPELINE_SHOT_COST)
    total_cost = per_shot_cost * len(body.shots)

    from app.services.credit_service import CreditService
    credit_service = CreditService(db)
    has_sufficient = await credit_service.check_sufficient_credits(
        current_user.tenant_id, total_cost
    )
    if not has_sufficient:
        balance = await credit_service.get_balance(current_user.tenant_id)
        raise HTTPException(
            status_code=400,
            detail=f"积分不足。需要 {total_cost} 积分（{len(body.shots)} 个镜头 × {per_shot_cost} 积分），当前余额 {balance} 积分",
        )

    pipeline_id = str(uuid.uuid4())

    # ── Validate every shot: time-segment storyboard + ≥1 image are mandatory ──
    for shot in body.shots:
        if not shot.images:
            raise HTTPException(
                status_code=422,
                detail=f"分镜 {shot.index} 缺少图片：每个镜头至少需要 1 张角色图或参考图",
            )
        if not _beats_have_content(shot.beats):
            raise HTTPException(
                status_code=422,
                detail=f"分镜 {shot.index} 缺少时间段分镜：请先填写至少一段时间段内容",
            )

    # Create a GenerationTask per shot
    shot_tasks = []
    for shot in body.shots:
        task_id = str(uuid.uuid4())
        shot_aspect = shot.aspect_ratio or body.aspect_ratio

        # ── 时间段分镜 → Seedance 提示词（图片N/视频1/音频1 与素材一一对应）──
        # final_prompt 非空：用户已 AI 重构/手改最终提示词，直接采用；否则走确定性基线。
        full_prompt = (shot.final_prompt or "").strip() or build_beat_prompt(
            [b.model_dump() for b in shot.beats],
            global_desc=shot.global_desc,
            images=[img.model_dump() for img in shot.images],
            has_video=bool(shot.reference_video_key),
            has_audio=bool(shot.audio_key),
            video_label=shot.reference_video_label,
            audio_label=shot.audio_label,
            unify_voice=shot.unify_voice,
            composition=shot.composition,
            narration=shot.narration,
            bgm_label=shot.bgm_label,
        )

        # 有序图片 → Seedance content：严格按用户排列顺序下发（图片1、图片2…图片N），
        # 不再按 kind 重排，确保提示词里的「图片N」与 content 数组第 N 张一一对应，
        # 让视频生成 API 能正确区分使用每张素材。
        ordered_keys = [img.key for img in shot.images if img.key]
        first_key = ordered_keys[0] if len(ordered_keys) > 0 else None
        last_key = ordered_keys[1] if len(ordered_keys) > 1 else None
        extra_keys = ordered_keys[2:]
        seed = int(hashlib.md5(f"{pipeline_id}-{shot.index}".encode()).hexdigest()[:8], 16)

        params = {
            "pipeline_id": pipeline_id,
            "shot_index": shot.index,
            "duration": shot.duration,
            "aspect_ratio": shot_aspect,
            "seed": seed,
            "generate_audio": shot.generate_audio,
        }
        # 复用 _generate_shot_video 既有 first/last/extra 入参：序号即 content 顺序
        if first_key:
            params["first_frame_key"] = first_key
        if last_key:
            params["last_frame_key"] = last_key
        if extra_keys:
            params["reference_image_keys"] = extra_keys
        if shot.reference_video_key:
            params["reference_video_key"] = shot.reference_video_key
        if shot.audio_key:
            params["audio_key"] = shot.audio_key

        db_task = GenerationTask(
            task_id=task_id,
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            model_id=body.model_id,
            task_type="video",
            prompt=full_prompt,
            parameters=json.dumps(params),
            status="pending",
            # 逐镜分镜视频属中间产物，不进作品画廊/AI视频（成片才展示）
            show_in_gallery=0,
        )
        db.add(db_task)

        shot_tasks.append({
            "shot_index": shot.index,
            "shot_id": shot.id,
            "task_id": task_id,
            "status": "pending",
            "seed": seed,
            "progress": 0,
            "result_url": None,
            "error": None,
        })

    # Create pipeline record. storyboard_json wraps project context so the
    # background task can name the composite path and store it under the project.
    pipeline = RenderPipeline(
        pipeline_id=pipeline_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        status="pending",
        total_shots=len(body.shots),
        storyboard_json=json.dumps({
            "drama_project_id": body.drama_project_id,
            "episode": body.episode,
            "aspect_ratio": body.aspect_ratio,
            "compose": body.compose,
            "shots": [s.model_dump() for s in body.shots],
        }),
        shot_tasks_json=json.dumps(shot_tasks),
    )
    db.add(pipeline)
    await db.commit()

    # Start background processing
    background_tasks.add_task(
        process_pipeline,
        pipeline_id=pipeline_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
    )

    return ResponseBase(
        success=True,
        message="渲染管线已启动",
        data={
            "pipeline_id": pipeline_id,
            "total_shots": len(body.shots),
            "shot_tasks": shot_tasks,
        },
    )


# ── Route: Poll Pipeline Status ──────────────────────────────────────────

@router.get("/{pipeline_id}", response_model=ResponseBase)
async def get_pipeline_status(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RenderPipeline).where(
            RenderPipeline.pipeline_id == pipeline_id,
            RenderPipeline.user_id == current_user.id,
        )
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    shot_tasks = json.loads(pipeline.shot_tasks_json) if pipeline.shot_tasks_json else []

    # Refresh each shot's status from GenerationTask table
    for st in shot_tasks:
        task_result = await db.execute(
            select(GenerationTask).where(GenerationTask.task_id == st["task_id"])
        )
        task = task_result.scalar_one_or_none()
        if task:
            st["status"] = task.status
            st["progress"] = task.progress or 0
            st["error"] = task.error_message
            if task.status == "completed" and task.result_path:
                st["result_url"] = f"/api/v1/render/pipeline/{pipeline_id}/shots/{st['shot_index']}/file"
            # Surface validation warnings from task parameters
            if task.parameters:
                try:
                    params = json.loads(task.parameters)
                    if params.get("validation_warnings"):
                        st["validation_warnings"] = params["validation_warnings"]
                except (json.JSONDecodeError, KeyError):
                    pass

    completed = sum(1 for s in shot_tasks if s["status"] == "completed")
    failed = sum(1 for s in shot_tasks if s["status"] == "failed")

    # 所有镜头完成 ≠ 整条管线完成：成片(ffmpeg 拼接)在所有镜头完成后才跑。
    # 此期间 pipeline.status 仍是 "processing"，必须如实上报 processing，
    # 否则前端会在 composite_url 写入前停止轮询，向导第4步拿不到成片而无法变完成态。
    all_shots_done = len(shot_tasks) > 0 and completed == len(shot_tasks)
    overall = pipeline.status
    if all_shots_done and pipeline.status == "completed":
        overall = "completed"
    elif failed > 0 and completed + failed == len(shot_tasks) and pipeline.status in ("partial", "failed"):
        overall = pipeline.status
    elif any(s["status"] == "processing" for s in shot_tasks) or (all_shots_done and pipeline.status not in ("completed", "partial", "failed")):
        # 镜头在生成中，或镜头都完成但成片(pipeline)尚未收尾 → 继续轮询
        overall = "processing"

    return ResponseBase(
        success=True,
        data={
            "pipeline_id": pipeline.pipeline_id,
            "status": overall,
            "total_shots": pipeline.total_shots,
            "completed_shots": completed,
            "failed_shots": failed,
            "shot_tasks": shot_tasks,
            "composite_url": (
                f"/api/v1/render/pipeline/{pipeline_id}/composite"
                if pipeline.composite_path else None
            ),
        },
    )


# ── Route: Stream shot result file ───────────────────────────────────────

@router.get("/{pipeline_id}/shots/{shot_index}/file")
async def get_shot_file(
    pipeline_id: str,
    shot_index: int,
    db: AsyncSession = Depends(get_db),
):
    """Stream a shot result file.

    No auth required — the pipeline_id UUID is unguessable and acts as a
    capability token, same pattern as character image endpoints.  This allows
    plain <video src="..."> tags to work without Bearer headers.
    """
    from fastapi.responses import Response
    from app.services.storage import get_storage_service, StorageService

    # Find the pipeline
    result = await db.execute(
        select(RenderPipeline).where(
            RenderPipeline.pipeline_id == pipeline_id,
        )
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    shot_tasks = json.loads(pipeline.shot_tasks_json) if pipeline.shot_tasks_json else []
    shot = next((s for s in shot_tasks if s["shot_index"] == shot_index), None)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    task_result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == shot["task_id"])
    )
    task = task_result.scalar_one_or_none()
    if not task or task.status != "completed" or not task.result_path:
        raise HTTPException(status_code=400, detail="File not available")

    if StorageService.is_minio_key(task.result_path):
        storage = get_storage_service()
        data, content_type = await storage.get_object_bytes(task.result_path)
        return Response(content=data, media_type=content_type)

    from pathlib import Path
    from fastapi.responses import FileResponse
    fp = Path(task.result_path)
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=fp, media_type="video/mp4")


# ── Route: Retry Failed Shot ─────────────────────────────────────────────

@router.post("/{pipeline_id}/shots/{shot_index}/retry", response_model=ResponseBase)
async def retry_shot(
    pipeline_id: str,
    shot_index: int,
    body: RetryShotRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RenderPipeline).where(
            RenderPipeline.pipeline_id == pipeline_id,
            RenderPipeline.user_id == current_user.id,
        )
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    shot_tasks = json.loads(pipeline.shot_tasks_json) if pipeline.shot_tasks_json else []
    shot = next((s for s in shot_tasks if s["shot_index"] == shot_index), None)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    # Create new task with adjusted seed
    new_task_id = str(uuid.uuid4())
    new_seed = shot["seed"] + body.seed_offset

    # Get original task for prompt
    orig_result = await db.execute(
        select(GenerationTask).where(GenerationTask.task_id == shot["task_id"])
    )
    orig_task = orig_result.scalar_one_or_none()
    if not orig_task:
        raise HTTPException(status_code=404, detail="Original task not found")

    # Update parameters with new seed
    params = json.loads(orig_task.parameters) if orig_task.parameters else {}
    params["seed"] = new_seed
    params["retry_of"] = shot["task_id"]

    new_db_task = GenerationTask(
        task_id=new_task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        model_id=orig_task.model_id,
        task_type="video",
        prompt=orig_task.prompt,
        parameters=json.dumps(params),
        status="pending",
        # 重绘的逐镜视频仍是中间产物，不进作品画廊/AI视频
        show_in_gallery=0,
    )
    db.add(new_db_task)

    # Update shot task reference
    shot["task_id"] = new_task_id
    shot["status"] = "pending"
    shot["seed"] = new_seed
    shot["progress"] = 0
    shot["error"] = None
    shot["result_url"] = None

    pipeline.shot_tasks_json = json.dumps(shot_tasks)
    pipeline.status = "processing"
    await db.commit()

    # Process single shot
    background_tasks.add_task(
        process_single_shot,
        pipeline_id=pipeline_id,
        task_id=new_task_id,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        shot_index=shot_index,
    )

    return ResponseBase(
        success=True,
        message="重绘任务已提交",
        data={"task_id": new_task_id, "seed": new_seed},
    )


# ── Real generation via the aggregation gateway ──────────────────────────

async def _load_video_bytes(storage, key_or_path: str) -> bytes:
    """Read a stored video (MinIO key or local path) into bytes."""
    from app.services.storage import StorageService
    if StorageService.is_minio_key(key_or_path):
        data, _ = await storage.get_object_bytes(key_or_path)
        return data
    import aiofiles
    async with aiofiles.open(key_or_path, "rb") as f:
        return await f.read()


async def _extract_last_frame(video_bytes: bytes) -> Optional[bytes]:
    """Extract the last frame of an MP4 as JPEG bytes via the bundled ffmpeg.

    Returns None on any failure (caller falls back to the character reference).
    """
    import os
    import tempfile
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        logger.warning(f"ffmpeg unavailable for last-frame extraction: {e}")
        return None

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name
        # Seek to ~1s before EOF and grab a single frame as MJPEG on stdout.
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-nostdin", "-loglevel", "error", "-sseof", "-1", "-i", tmp_path,
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        if proc.returncode != 0 or not out:
            logger.warning(f"last-frame extraction failed: {err.decode()[:200]}")
            return None
        return out
    except Exception as e:
        logger.warning(f"last-frame extraction error: {e}")
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


async def _generate_shot_video(
    db: "AsyncSession",
    db_task: GenerationTask,
    params: dict,
    prompt: str,
    user_id: int,
    pipeline_id: str,
    shot_index: int,
) -> str:
    """Generate a real video for one shot through the aggregation gateway.

    Resolves a character reference image (for face/identity consistency),
    submits the task to the matching gateway video family (default Seedance/
    短剧, with Hailuo / HappyHorse selectable by model_id), polls to completion
    while advancing ``db_task.progress``, then stores the result in MinIO.

    Returns the result path (MinIO key or local path). Raises on failure/timeout.
    """
    from app.services.storage import get_storage_service
    from app.config import settings
    from app.integrations.gateway import get_gateway_client, GatewayError

    gw = get_gateway_client()
    storage = get_storage_service()
    from app.api.v1.drama import _public_asset_url

    def _asset_url(object_key: str) -> Optional[str]:
        """MinIO key → 远程可访问的 proxy URL（经 /api/v1/drama/ref-asset 发布）。
        提交给视频生成 API 的素材统一用此 URL，让外部服务能远程拉取 MinIO 实际存储资源。"""
        if not object_key:
            return None
        if not settings.PUBLIC_BASE_URL:
            return None
        return _public_asset_url(object_key, ttl_seconds=6 * 3600)

    # ── 解析本镜首帧(图片1) ──
    # 优先用 proxy URL（远程可拉取）；仅「上一镜末帧链式参考」是运行时抽帧出的 bytes（无存储对象），
    # 此时回退 base64 内联。reference_image 可能是 URL(str) 或 bytes。
    reference_image: Optional[Union[str, bytes]] = None

    # 0) 该镜自带首帧(图片1)：用 proxy URL；URL 不可用时回退读 bytes。
    own_first_key = params.get("first_frame_key")
    if own_first_key:
        url = _asset_url(own_first_key)
        if url:
            reference_image = url
            logger.info(
                f"Pipeline {pipeline_id} shot {shot_index}: first frame via proxy URL ({own_first_key})"
            )
        else:
            try:
                data, _ = await storage.get_object_bytes(own_first_key)
                reference_image = data
            except Exception as e:
                logger.warning(f"Failed to load own first frame for shot {shot_index}: {e}")

    # 1) Prefer the previous shot's last frame for visual continuity (chained, 运行时抽帧→bytes).
    chain_key = params.get("chain_reference") if params.get("chain_mode") == "last_frame" else None
    if reference_image is None and chain_key:
        try:
            prev_video = await _load_video_bytes(storage, chain_key)
            frame = await _extract_last_frame(prev_video)
            if frame:
                reference_image = frame  # 抽帧 bytes：无存储对象，只能 base64 内联
                logger.info(
                    f"Pipeline {pipeline_id} shot {shot_index}: chained last frame "
                    f"({len(frame)} bytes) from {chain_key}"
                )
        except Exception as e:
            logger.warning(f"Last-frame chaining failed for shot {shot_index}: {e}")

    # 2) Fall back to the character reference image (identity consistency).
    if reference_image is None:
        ref_key = params.get("reference_image_key")
        if ref_key:
            url = _asset_url(ref_key)
            if url:
                reference_image = url
            else:
                try:
                    data, _ = await storage.get_object_bytes(ref_key)
                    reference_image = data
                except Exception as e:
                    logger.warning(f"Failed to load reference image for shot {shot_index}: {e}")

    # ── 时间段分镜额外素材（仅 Seedance 消费）：尾帧(图片2)/额外参考图(图片3+)/参考视频/参考音频 ──
    # 全部统一用 proxy URL 远程发布（图片有 MinIO key，必走 proxy；URL 不可用才回退 bytes）。
    last_frame_image: Optional[Union[str, bytes]] = None
    extra_images: list[Union[str, bytes]] = []
    reference_video_url: Optional[str] = None
    audio_url: Optional[str] = None
    if params.get("last_frame_key"):
        url = _asset_url(params["last_frame_key"])
        if url:
            last_frame_image = url
        else:
            try:
                last_frame_image, _ = await storage.get_object_bytes(params["last_frame_key"])
            except Exception as e:
                logger.warning(f"Failed to load last frame for shot {shot_index}: {e}")
    for k in (params.get("reference_image_keys") or []):
        url = _asset_url(k)
        if url:
            extra_images.append(url)
            continue
        try:
            data, _ = await storage.get_object_bytes(k)
            extra_images.append(data)
        except Exception as e:
            logger.warning(f"Failed to load extra ref image ({k}) for shot {shot_index}: {e}")
    if params.get("reference_video_key") or params.get("audio_key"):
        if settings.PUBLIC_BASE_URL:
            if params.get("reference_video_key"):
                reference_video_url = _asset_url(params["reference_video_key"])
            if params.get("audio_key"):
                audio_url = _asset_url(params["audio_key"])
        else:
            logger.info(
                f"Pipeline {pipeline_id} shot {shot_index}: skipping reference video/audio "
                f"— PUBLIC_BASE_URL not set"
            )

    aspect_ratio = params.get("aspect_ratio", "16:9")
    # Seedance 单次生成时长范围 3–12s：钳制以免超上限触发 InvalidParameter（前端已拦 >12，
    # 这里是后端兜底，避免任何路径把 20s 之类的值直接下发网关）。
    duration = max(3, min(int(params.get("duration", 5) or 5), 12))
    family = (db_task.model_id or "").lower()

    db_task.status = "processing"
    db_task.progress = 15
    await db.commit()

    # ── Submit task to the matching gateway video family ──
    if "hailuo" in family or "minimax" in family:
        dur = 6 if duration <= 6 else 10
        task = await gw.hailuo_create(
            prompt, first_frame_image=reference_image, duration=dur, resolution="768P"
        )
        poll = gw.video_poll
    elif "happyhorse" in family:
        images = [reference_image] if reference_image else None
        task = await gw.happyhorse_create(
            prompt,
            mode="i2v" if reference_image else "t2v",
            duration=duration,
            ratio=aspect_ratio,
            images=images,
        )
        poll = gw.video_poll
    else:  # Seedance (短剧) — default for the drama workbench
        task = await gw.seedance_create(
            prompt,
            reference_image=reference_image,
            last_frame_image=last_frame_image,
            reference_images=extra_images or None,
            reference_video_url=reference_video_url,
            audio_url=audio_url,
            generate_audio=bool(params.get("generate_audio")),
            ratio=aspect_ratio,
            duration=duration,
        )
        poll = gw.seedance_poll

    db_task.progress = 40
    await db.commit()

    # ── Poll until done (≈30 min ceiling) ──
    video_url: Optional[str] = None
    max_checks = 180
    for i in range(max_checks):
        await asyncio.sleep(10)
        state = await poll(task)
        status = state["status"]
        db_task.progress = min(40 + (i * 50 // max_checks), 90)
        await db.commit()
        if gw.is_done(status) and state.get("url"):
            video_url = state["url"]
            break
        if gw.is_failed(status):
            raise GatewayError(f"视频生成失败: {state.get('raw')}")

    if not video_url:
        raise GatewayError("视频生成超时")

    # ── Download result + store ──
    video_bytes = await gw.fetch_bytes(video_url)
    result_path = f"users/{user_id}/render/{pipeline_id}/shot_{shot_index:02d}.mp4"
    if settings.MINIO_ENABLED:
        await storage.upload_bytes(video_bytes, result_path, "video/mp4")
    else:
        from pathlib import Path
        import aiofiles
        local_dir = Path("uploads") / "render" / str(pipeline_id)
        local_dir.mkdir(parents=True, exist_ok=True)
        result_path = str(local_dir / f"shot_{shot_index:02d}.mp4")
        async with aiofiles.open(result_path, "wb") as f:
            await f.write(video_bytes)
    return result_path


# ── Background: Process Full Pipeline (chained) ──────────────────────────

async def process_pipeline(pipeline_id: str, user_id: int, tenant_id: int):
    """Process all shots sequentially with chained last-frame references."""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(RenderPipeline).where(RenderPipeline.pipeline_id == pipeline_id)
            )
            pipeline = result.scalar_one_or_none()
            if not pipeline:
                return

            pipeline.status = "processing"
            await db.commit()

            shot_tasks = json.loads(pipeline.shot_tasks_json)
            previous_result_path: Optional[str] = None

            for i, shot in enumerate(shot_tasks):
                task_id = shot["task_id"]

                # Fetch the generation task
                t_result = await db.execute(
                    select(GenerationTask).where(GenerationTask.task_id == task_id)
                )
                db_task = t_result.scalar_one_or_none()
                if not db_task:
                    continue

                # Inject chain reference: the previous shot's video, whose last
                # frame is extracted and used as this shot's reference for continuity.
                # 该镜自带首帧(图片1)时不注入链式参考——显式首帧优先。
                params = json.loads(db_task.parameters) if db_task.parameters else {}
                if previous_result_path and not params.get("first_frame_key"):
                    params["chain_reference"] = previous_result_path
                    params["chain_mode"] = "last_frame"
                db_task.parameters = json.dumps(params)

                # ── Deduct credits for this shot ──
                model_id = db_task.model_id or "kling-v1"
                shot_cost = PIPELINE_CREDIT_COSTS.get(model_id, DEFAULT_PIPELINE_SHOT_COST)
                try:
                    from app.services.credit_service import CreditService
                    credit_svc = CreditService(db)
                    await credit_svc.deduct(
                        tenant_id,
                        shot_cost,
                        f"渲染管线 Shot {shot['shot_index']} ({model_id})",
                    )
                except Exception as e:
                    logger.warning(f"Pipeline {pipeline_id} shot {shot['shot_index']} credit deduction failed: {e}")

                try:
                    # ── Real generation via the aggregation gateway ──
                    result_path = await _generate_shot_video(
                        db=db,
                        db_task=db_task,
                        params=params,
                        prompt=db_task.prompt or "",
                        user_id=user_id,
                        pipeline_id=pipeline_id,
                        shot_index=shot["shot_index"],
                    )

                    db_task.status = "completed"
                    db_task.progress = 100
                    db_task.result_path = result_path
                    await db.commit()

                    previous_result_path = result_path
                    shot["status"] = "completed"

                except Exception as e:
                    # 保证错误信息非空：str(e) 对部分异常为空，回退到类型名，避免前端只看到「失败」无原因
                    err_msg = (str(e) or repr(e) or f"{type(e).__name__}: 生成失败（无详细信息）")[:1000]
                    db_task.status = "failed"
                    db_task.progress = 0
                    db_task.error_message = err_msg
                    await db.commit()
                    shot["status"] = "failed"
                    shot["error"] = err_msg
                    logger.warning(f"Pipeline {pipeline_id} shot {shot['shot_index']} failed: {err_msg!r}", exc_info=True)
                    # Refund credits for failed shot
                    try:
                        from app.services.credit_service import CreditService
                        credit_svc = CreditService(db)
                        await credit_svc.recharge(
                            tenant_id,
                            shot_cost,
                            "system",
                            f"refund-pipeline-{pipeline_id}-shot-{shot['shot_index']}",
                        )
                    except Exception as refund_err:
                        logger.error(f"Failed to refund credits for shot {shot['shot_index']}: {refund_err}")
                    # Continue to next shot (don't break chain entirely)
                    # But next shot won't have chain_reference

                pipeline.shot_tasks_json = json.dumps(shot_tasks)
                pipeline.completed_shots = sum(1 for s in shot_tasks if s["status"] == "completed")
                pipeline.failed_shots = sum(1 for s in shot_tasks if s["status"] == "failed")
                await db.commit()

            # Final status — 当需要成片时，先拼接再标记 completed，
            # 否则状态接口会在 composite_path 写入前就报 completed，
            # 前端停轮询时拿不到 composite_url，向导第4步无法变完成态。
            if pipeline.failed_shots == 0 and pipeline.completed_shots > 0:
                # compose=False：只生成分镜视频，跳过拼接（成片由「合并成片」步骤显式触发）
                ctx = json.loads(pipeline.storyboard_json) if pipeline.storyboard_json else {}
                if ctx.get("compose", True):
                    # 拼接期间 pipeline.status 仍为 "processing"（见上），让前端继续轮询
                    try:
                        await _compose_episode(db, pipeline, shot_tasks, user_id)
                    except Exception as e:
                        logger.warning(f"Pipeline {pipeline_id} composite failed: {e}")
                pipeline.status = "completed"
            elif pipeline.completed_shots > 0:
                pipeline.status = "partial"
            else:
                pipeline.status = "failed"
            await db.commit()

        except Exception as e:
            logger.error(f"Pipeline {pipeline_id} fatal error: {e}")
            try:
                pipeline.status = "failed"
                pipeline.error_message = str(e)
                await db.commit()
            except:
                pass


# ── Composite: concat per-shot videos into one episode MP4 ───────────────

async def _compose_episode(db, pipeline: RenderPipeline, shot_tasks: list[dict], user_id: int) -> None:
    """Download completed shot videos in order, ffmpeg-concat, store the result.

    Reuses the normalization/concat helpers from drama.py. Stores under the
    drama project path when the pipeline carries a drama_project_id, else under
    the render path. Updates pipeline.composite_path / composite_url.
    """
    import os
    import tempfile
    from pathlib import Path as _P
    from app.services.storage import get_storage_service
    from app.api.v1.drama import _normalize_clip, _run_ffmpeg, _AR_TO_WH

    ctx = json.loads(pipeline.storyboard_json) if pipeline.storyboard_json else {}
    drama_project_id = ctx.get("drama_project_id")
    episode = ctx.get("episode")
    aspect_ratio = ctx.get("aspect_ratio", "16:9")
    w, h = _AR_TO_WH.get(aspect_ratio, (720, 1280))
    storage = get_storage_service()

    # Resolve ordered shot result paths
    ordered = sorted(shot_tasks, key=lambda s: s["shot_index"])
    task_ids = [s["task_id"] for s in ordered]
    res = await db.execute(select(GenerationTask).where(GenerationTask.task_id.in_(task_ids)))
    by_id = {t.task_id: t for t in res.scalars().all()}

    with tempfile.TemporaryDirectory() as tmp:
        norm_paths: list[str] = []
        for i, st in enumerate(ordered):
            t = by_id.get(st["task_id"])
            if not t or not t.result_path:
                continue
            raw = os.path.join(tmp, f"raw_{i}.mp4")
            if storage.is_minio_key(t.result_path):
                data, _ = await storage.get_object_bytes(t.result_path)
                with open(raw, "wb") as f:
                    f.write(data)
            elif os.path.exists(t.result_path):
                raw = t.result_path
            else:
                continue
            norm = os.path.join(tmp, f"norm_{i}.mp4")
            await _normalize_clip(raw, norm, w, h)
            norm_paths.append(norm)

        if not norm_paths:
            return

        list_file = os.path.join(tmp, "list.txt")
        with open(list_file, "w") as f:
            for p in norm_paths:
                f.write(f"file '{p}'\n")
        out_path = os.path.join(tmp, "final.mp4")
        rc, err = await _run_ffmpeg([
            "-y", "-f", "concat", "-safe", "0", "-i", list_file,
            "-c", "copy", "-movflags", "+faststart", out_path,
        ])
        if rc != 0 or not os.path.exists(out_path):
            raise RuntimeError(f"concat failed: {err}")

        ep_tag = f"ep{episode}_" if episode is not None else ""
        filename = f"{ep_tag}{pipeline.pipeline_id}.mp4"
        if drama_project_id:
            object_key = storage.drama_final_key(user_id, drama_project_id, filename)
        else:
            object_key = f"users/{user_id}/render/{pipeline.pipeline_id}/{filename}"
        # 仅上传；不保留预签名 URL：它带内网 host minio:9000，浏览器无法解析。
        # composite_url 统一存后端流式代理路径，播放走 /composite 端点。
        await storage.upload_and_get_url(_P(out_path), object_key, "video/mp4")

    pipeline.composite_path = object_key
    pipeline.composite_url = f"/api/v1/render/pipeline/{pipeline.pipeline_id}/composite"
    await db.commit()

    # 把成片回写进项目 episodes_data 并推导项目状态（每集都有成片→已完成）。
    # 这样项目卡片状态不依赖前端是否在线/保存，后端即为权威来源。
    if drama_project_id:
        try:
            await _persist_project_completion(
                db, drama_project_id, user_id, episode, pipeline.pipeline_id, object_key
            )
        except Exception as e:
            logger.warning(
                f"Pipeline {pipeline.pipeline_id} project status write-back failed: {e}"
            )


async def _persist_project_completion(
    db, project_id: str, user_id: int, episode, pipeline_id: str, object_key: str
) -> None:
    """成片完成后回写项目：目标集 composite_url/pipeline_id + 项目状态推导。"""
    from app.models.drama_project import DramaProject

    res = await db.execute(
        select(DramaProject).where(
            DramaProject.project_id == project_id,
            DramaProject.user_id == user_id,
            DramaProject.deleted_at.is_(None),
        )
    )
    proj = res.scalar_one_or_none()
    if not proj or not proj.episodes_data:
        return
    try:
        data = json.loads(proj.episodes_data)
    except (json.JSONDecodeError, TypeError):
        return
    eps = data.get("episodes") or []
    if not eps:
        return

    proxy = f"/api/v1/render/pipeline/{pipeline_id}/composite"
    target = None
    if episode is not None:
        target = next((e for e in eps if e.get("episode") == episode), None)
    if target is None and len(eps) == 1:
        target = eps[0]
    if target is None:
        return
    target["composite_url"] = proxy
    target["pipeline_id"] = pipeline_id

    proj.episodes_data = json.dumps(data, ensure_ascii=False)
    proj.final_video_path = object_key
    if proj.archived_at is None:
        all_done = all(e.get("composite_url") for e in eps)
        proj.status = "completed" if all_done else "in_progress"
    await db.commit()


# ── Route: Stream episode composite ──────────────────────────────────────

@router.get("/{pipeline_id}/composite")
async def get_composite_file(
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Stream the assembled episode composite (pipeline_id acts as capability token)."""
    from fastapi.responses import Response
    from app.services.storage import get_storage_service, StorageService

    result = await db.execute(
        select(RenderPipeline).where(RenderPipeline.pipeline_id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline or not pipeline.composite_path:
        raise HTTPException(status_code=404, detail="Composite not available")

    if StorageService.is_minio_key(pipeline.composite_path):
        storage = get_storage_service()
        data, content_type = await storage.get_object_bytes(pipeline.composite_path)
        return Response(content=data, media_type=content_type or "video/mp4")

    from pathlib import Path
    from fastapi.responses import FileResponse
    fp = Path(pipeline.composite_path)
    if not fp.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=fp, media_type="video/mp4")


# ── Background: Process Single Shot (for retry) ──────────────────────────

async def process_single_shot(
    pipeline_id: str, task_id: str, user_id: int, tenant_id: int, shot_index: int
):
    """Process a single shot (used for retries)."""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            t_result = await db.execute(
                select(GenerationTask).where(GenerationTask.task_id == task_id)
            )
            db_task = t_result.scalar_one_or_none()
            if not db_task:
                return

            params = json.loads(db_task.parameters) if db_task.parameters else {}

            # Deduct credits for retry
            model_id = db_task.model_id or "kling-v1"
            shot_cost = PIPELINE_CREDIT_COSTS.get(model_id, DEFAULT_PIPELINE_SHOT_COST)
            try:
                from app.services.credit_service import CreditService
                credit_svc = CreditService(db)
                has_sufficient = await credit_svc.check_sufficient_credits(tenant_id, shot_cost)
                if not has_sufficient:
                    db_task.status = "failed"
                    db_task.error_message = f"积分不足，需要 {shot_cost} 积分"
                    await db.commit()
                    return
                await credit_svc.deduct(tenant_id, shot_cost, f"重绘 Shot {shot_index} ({model_id})")
            except Exception as e:
                logger.warning(f"Retry shot {shot_index} credit deduction failed: {e}")

            # ── Real generation via the aggregation gateway ──
            result_path = await _generate_shot_video(
                db=db,
                db_task=db_task,
                params=params,
                prompt=db_task.prompt or "",
                user_id=user_id,
                pipeline_id=pipeline_id,
                shot_index=shot_index,
            )

            db_task.status = "completed"
            db_task.progress = 100
            db_task.result_path = result_path
            await db.commit()

            # Update pipeline counts
            p_result = await db.execute(
                select(RenderPipeline).where(RenderPipeline.pipeline_id == pipeline_id)
            )
            pipeline = p_result.scalar_one_or_none()
            if pipeline:
                shot_tasks = json.loads(pipeline.shot_tasks_json)
                for st in shot_tasks:
                    if st["shot_index"] == shot_index:
                        st["status"] = "completed"
                        st["error"] = None
                pipeline.shot_tasks_json = json.dumps(shot_tasks)
                pipeline.completed_shots = sum(1 for s in shot_tasks if s["status"] == "completed")
                pipeline.failed_shots = sum(1 for s in shot_tasks if s["status"] == "failed")
                if pipeline.failed_shots == 0 and pipeline.completed_shots == pipeline.total_shots:
                    pipeline.status = "completed"
                elif pipeline.completed_shots > 0:
                    pipeline.status = "partial"
                await db.commit()

        except Exception as e:
            logger.error(f"Retry shot {shot_index} for pipeline {pipeline_id} failed: {e}")
            try:
                db_task.status = "failed"
                db_task.error_message = str(e)
                await db.commit()
            except:
                pass
