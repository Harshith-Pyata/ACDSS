"""
architecture.py
===============
Builds and compiles the Diagnosis Agent LangGraph.

Imports nodes from node_tools.py and the state schema from model.py,
wires them into a 4-node sequential graph, and exposes the compiled
agent as `diagnosis_agent` for use by agent.py.

Graph flow:
    extract_labs → retrieve_context → analyze_labs → evaluate_diagnosis → END
"""

from langgraph.graph import StateGraph, END

from .model import DiagnosisAgentState
from .node_tools import (
    _extract_labs_node,
    _retrieve_context_node,
    _analyze_labs_node,
    _evaluate_diagnosis_node,
)

# ── Build the LangGraph ───────────────────────────────────────────────────────

_workflow = StateGraph(DiagnosisAgentState)

_workflow.add_node("extract_labs",       _extract_labs_node)
_workflow.add_node("retrieve_context",   _retrieve_context_node)
_workflow.add_node("analyze_labs",       _analyze_labs_node)
_workflow.add_node("evaluate_diagnosis", _evaluate_diagnosis_node)

_workflow.set_entry_point("extract_labs")
_workflow.add_edge("extract_labs",       "retrieve_context")
_workflow.add_edge("retrieve_context",   "analyze_labs")
_workflow.add_edge("analyze_labs",       "evaluate_diagnosis")
_workflow.add_edge("evaluate_diagnosis", END)

# ── Compiled agent (imported by agent.py) ─────────────────────────────────────
diagnosis_agent = _workflow.compile()