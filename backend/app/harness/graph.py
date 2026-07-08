"""LangGraph 状态图（P0-b-2）：agent → confirm_gate → tools 循环，支持人工确认。

    START → agent → (有 tool_calls?) → confirm_gate → tools → agent → ... → (无 tool_calls) → END

P0-b 起 build_graph 返回**未编译的 builder**，executor 用 checkpointer 编译（支持续跑）。
tools_node 只负责取 tool_calls、组装 ToolMessage；**扣费/幂等/取消/执行**全部委托给 executor
注入的 run_tool / check_cancelled 闭包（业务逻辑集中在 executor，图保持薄）。

P0-b-2 新增 confirm_gate 节点：依 confirm_mode 决定是否 `interrupt()` 挂起等人工确认。
- interrupt() 首次命中 → 抛 GraphInterrupt，checkpoint 落盘，ainvoke 返回；executor 检测后置
  awaiting_confirmation。
- `ainvoke(Command(resume=decision))` 恢复：confirm_gate 从头重跑，interrupt() 返回 decision。
  · continue → 原样放行到 tools
  · edit     → 用 decision.edited_args 覆盖 tool_calls 参数（同 id 替换 AIMessage）→ tools
  · skip     → 为每个 tool_call 回喂 skipped ToolMessage → 回 agent（不执行/不扣费）
  · abort    → 抛 GraphCancelled（→ cancelled）
interrupt() 之前只有纯函数调用（无副作用），保证重跑幂等；record_skip 在其后，仅恢复时执行一次。
"""
from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Awaitable, Callable, Optional, TypedDict

import operator

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.types import interrupt

logger = logging.getLogger(__name__)


class GraphCancelled(Exception):
    """Run 被用户取消（或人工确认选择 abort），用于中止图执行。"""


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    artifacts: Annotated[list, operator.add]   # 多轮累加（P0-b 修正 P0-a 的覆盖问题）


# run_tool(tool_name, args, tool_call_id) -> (artifact | None, error | None)
RunTool = Callable[[str, dict, str], Awaitable[tuple[Optional[dict], Optional[str]]]]
# check_cancelled() -> bool
CheckCancelled = Callable[[], Awaitable[bool]]
# confirm_payload(tool_calls) -> None（无需确认）| dict（待确认 payload，用于 interrupt）
ConfirmPayload = Callable[[list], Optional[dict]]
# record_skip(tool_calls, reason) -> None（写 skipped step）
RecordSkip = Callable[[list, str], Awaitable[None]]


def build_graph(
    llm_with_tools,
    run_tool: RunTool,
    check_cancelled: CheckCancelled,
    confirm_payload: ConfirmPayload,
    record_skip: RecordSkip,
):
    """返回未编译的 StateGraph builder（executor 负责用 checkpointer 编译）。"""

    async def agent_node(state: AgentState) -> dict:
        if await check_cancelled():
            raise GraphCancelled()
        resp = await llm_with_tools.ainvoke(state["messages"])
        return {"messages": [resp]}

    async def confirm_gate_node(state: AgentState) -> dict:
        # interrupt() 之前保持纯函数（无 DB/IO 副作用）——恢复时整个节点会重跑。
        if await check_cancelled():
            raise GraphCancelled()
        last = state["messages"][-1]
        tcs = list(getattr(last, "tool_calls", None) or [])
        if not tcs:
            return {}
        payload = confirm_payload(tcs)
        if payload is None:
            return {}                        # auto / 未达阈值 → 直通

        decision = interrupt(payload)        # 首次挂起；恢复时返回用户决定
        action = (decision or {}).get("action", "continue")

        if action == "abort":
            raise GraphCancelled()

        if action == "skip":
            reason = (decision or {}).get("reason") or "用户跳过此步"
            await record_skip(tcs, reason)
            return {"messages": [
                ToolMessage(
                    content=json.dumps({"skipped": True, "reason": reason}, ensure_ascii=False),
                    tool_call_id=tc["id"],
                )
                for tc in tcs
            ]}

        if action == "edit":
            edited = (decision or {}).get("edited_args") or {}
            new_tcs = [
                {**tc, "args": edited.get(tc["id"], tc.get("args", {}) or {})}
                for tc in tcs
            ]
            # 同 id 返回 → add_messages 就地替换原 AIMessage
            return {"messages": [AIMessage(content=last.content, tool_calls=new_tcs, id=last.id)]}

        return {}                            # continue → 原样放行

    async def tools_node(state: AgentState) -> dict:
        last = state["messages"][-1]
        tool_msgs: list[Any] = []
        new_artifacts: list[dict] = []
        for tc in (getattr(last, "tool_calls", None) or []):
            if await check_cancelled():
                raise GraphCancelled()
            artifact, error = await run_tool(tc["name"], tc.get("args", {}) or {}, tc["id"])
            if artifact:
                new_artifacts.append(artifact)
            payload = artifact if artifact else {"error": error or "未知错误"}
            tool_msgs.append(ToolMessage(
                content=json.dumps(payload, ensure_ascii=False), tool_call_id=tc["id"],
            ))
        return {"messages": tool_msgs, "artifacts": new_artifacts}

    def route_after_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        return "confirm_gate" if getattr(last, "tool_calls", None) else END

    def route_after_gate(state: AgentState) -> str:
        # skip 路径已回喂 ToolMessage（tool_calls 已被应答）→ 回 agent；否则去 tools 执行。
        last = state["messages"][-1]
        if isinstance(last, ToolMessage):
            return "agent"
        return "tools"

    g = StateGraph(AgentState)
    g.add_node("agent", agent_node)
    g.add_node("confirm_gate", confirm_gate_node)
    g.add_node("tools", tools_node)
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", route_after_agent, {"confirm_gate": "confirm_gate", END: END})
    g.add_conditional_edges("confirm_gate", route_after_gate, {"tools": "tools", "agent": "agent"})
    g.add_edge("tools", "agent")
    return g
