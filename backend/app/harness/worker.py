"""arq worker 入口：消费 run_agent 任务，驱动 Loop Harness 执行。

启动：arq app.harness.worker.WorkerSettings
"""
from __future__ import annotations

import logging

from arq.connections import RedisSettings

from app.config import settings

logger = logging.getLogger(__name__)


async def run_agent(ctx, run_id: str) -> str:
    """arq 任务：执行一个 AgentRun。"""
    from app.harness.executor import execute_run
    logger.info("worker 接到 run_agent: %s", run_id)
    await execute_run(run_id)
    return run_id


async def startup(ctx) -> None:
    """worker 启动：扫描 status=running 的 Run（崩溃中断的），重新入队 → 从检查点续跑。"""
    logger.info("harness worker 启动，Redis=%s", settings.REDIS_URL)
    try:
        from sqlalchemy import select
        from app.db.session import AsyncSessionLocal
        from app.models.agent import AgentRun
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(AgentRun.run_id).where(
                    AgentRun.status == "running", AgentRun.deleted_at.is_(None)
                )
            )).scalars().all()
        for run_id in rows:
            await ctx["redis"].enqueue_job("run_agent", run_id)
            logger.info("续跑：重新入队 running run %s", run_id)
        if rows:
            logger.info("harness worker 续跑扫描：重新入队 %d 个中断 Run", len(rows))
    except Exception as exc:  # noqa: BLE001
        logger.warning("续跑扫描失败（忽略）：%s", exc)


class WorkerSettings:
    functions = [run_agent]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    max_jobs = 4                 # 单 worker 并发上限（P0-a）
    job_timeout = 1800           # 单 Run 墙钟超时（秒）；P1-b 视频同步轮询可达 ~20min，拉高到 30min
    keep_result = 3600
