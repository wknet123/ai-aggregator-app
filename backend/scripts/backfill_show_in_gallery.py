"""One-time backfill: hide drama intermediate products from the works gallery.

旧数据在新增 show_in_gallery 列时统一拿到 DEFAULT 1，导致短剧中间产物
(分镜图 / 逐镜分镜视频) 仍会出现在作品画廊/AI图片/AI视频。本脚本把这些
中间产物回填为 show_in_gallery=0，最终成片保持 1。

判定「中间产物」(置 0)：
  1) 任何出现在 render_pipelines.shot_tasks_json 里的逐镜任务 task_id；
  2) parameters 含 drama_project_id 的任务，但排除最终成片：
       - model_id = 'ffmpeg-concat'（compose-final 拼接成片）
       - parameters 含 '"compose": true'（compose-video 合并成片）

幂等：可重复执行。运行：
    docker compose exec backend python -m scripts.backfill_show_in_gallery
"""
import asyncio
import json

from sqlalchemy import select, update

from app.db.session import AsyncSessionLocal
from app.models.generation_task import GenerationTask
from app.models.render_pipeline import RenderPipeline


async def main() -> None:
    async with AsyncSessionLocal() as db:
        # 1) 收集所有 render pipeline 的逐镜任务 id
        shot_task_ids: set[str] = set()
        rows = (await db.execute(select(RenderPipeline.shot_tasks_json))).scalars().all()
        for raw in rows:
            if not raw:
                continue
            try:
                for st in json.loads(raw):
                    tid = st.get("task_id")
                    if tid:
                        shot_task_ids.add(tid)
            except Exception:
                continue

        n_pipeline = 0
        if shot_task_ids:
            res = await db.execute(
                update(GenerationTask)
                .where(
                    GenerationTask.task_id.in_(shot_task_ids),
                    GenerationTask.show_in_gallery == 1,
                )
                .values(show_in_gallery=0)
            )
            n_pipeline = res.rowcount or 0

        # 2) 带 drama_project_id 的中间产物（分镜图 + 单镜视频），排除成片
        res2 = await db.execute(
            update(GenerationTask)
            .where(
                GenerationTask.show_in_gallery == 1,
                GenerationTask.parameters.like('%drama_project_id%'),
                GenerationTask.model_id != "ffmpeg-concat",
                ~GenerationTask.parameters.like('%"compose": true%'),
            )
            .values(show_in_gallery=0)
        )
        n_drama = res2.rowcount or 0

        await db.commit()
        print(f"✓ backfill done: pipeline-shot tasks hidden={n_pipeline}, "
              f"drama-tagged intermediates hidden={n_drama}")


if __name__ == "__main__":
    asyncio.run(main())
