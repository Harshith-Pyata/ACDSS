

import json
import re

from langchain_core.prompts import PromptTemplate

from .llm_models import llm, retriever
from .model import DiagnosisAgentState


# ── Specialization Mapper ─────────────────────────────────────────────────────

_SPEC_RULES = [
    (("diabetes", "glucose", "hba1c", "insulin", "glycated",
      "thyroid", "tsh", "endocrine"),                              "Endocrinologist"),
    (("cardiac", "heart", "cholesterol", "ldl", "hdl",
      "triglyceride", "lipid", "troponin"),                        "Cardiologist"),
    (("liver", "hepatic", "hepatitis", "cirrhosis", "ast", "alt",
      "bilirubin", "pancreatic", "amylase", "lipase"),             "Gastroenterologist"),
    (("neurological", "seizure", "migraine", "neuropathy",
      "stroke", "epilepsy"),                                        "Neurologist"),
    (("lung", "respiratory", "pneumonia", "asthma", "copd",
      "tuberculosis", "tb"),                                        "Pulmonologist"),
    (("kidney", "renal", "creatinine", "bun", "urea",
      "nephritis", "gfr", "proteinuria"),                           "Nephrologist"),
    (("psychiatric", "depression", "anxiety", "bipolar",
      "mental health"),                                             "Psychiatrist"),
    (("bone", "fracture", "arthritis", "osteoporosis",
      "vitamin d", "calcium"),                                      "Orthopedic"),
    (("skin", "dermatitis", "eczema", "psoriasis", "rash"),        "Dermatologist"),
]


def map_specialization(hypothesis: str) -> str:
    """Map a free-text primary hypothesis to the nearest doctor specialization."""
    text = hypothesis.lower()
    for keywords, spec in _SPEC_RULES:
        if any(k in text for k in keywords):
            return spec
    return "General Physician"


def _parse_json(text: str) -> dict:
    """Safely extract a JSON object from an LLM response, ignoring filler text."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}


# Node 1: Extract lab values from OCR text

_EXTRACT_PROMPT = PromptTemplate.from_template("""
You are a medical data extraction specialist.
Read the raw text extracted (via OCR) from a lab report.
Identify ALL laboratory tests and their corresponding numeric values (including units).

Doctor's Context: {explanation}
Raw Lab Text: {text}

Return ONLY a valid JSON dictionary where:
- keys   = Test Name  (e.g. "Glucose", "HbA1c", "AST")
- values = Result     (e.g. "189 mg/dL", "8.1 %", "240 IU/L")

Do NOT include markdown, code fences, or the word "json".
Start your response with {{ and end with }}.
""")


def _extract_labs_node(state: DiagnosisAgentState) -> dict:
    """Node 1 — Use the LLM to pull structured key→value pairs from raw OCR text."""
    print("[DiagnosisAgent] Node 1: Extracting lab values from OCR text...")

    response  = llm.invoke(_EXTRACT_PROMPT.format(
        explanation=state["doctor_explanation"][:300],
        text=state["raw_lab_text"][:1200],
    ))
    extracted = _parse_json(response.content)
    print(f"[DiagnosisAgent] Extracted {len(extracted)} lab values.")
    return {"extracted_lab_values": extracted}


# ── Node 2: Retrieve reference ranges from ChromaDB ──────────────────────────

def _retrieve_context_node(state: DiagnosisAgentState) -> dict:
    """Node 2 — Query ChromaDB for normal ranges and clinical significance of each test."""
    print("[DiagnosisAgent] Node 2: Retrieving reference ranges from knowledge base...")

    combined = ""
    for test in list(state["extracted_lab_values"].keys())[:4]:
        print(f"  -> Searching: {test}")
        docs  = retriever.invoke(
            f"What is the normal reference range and clinical significance of {test}?"
        )
        chunk = "\n".join(d.page_content[:400] for d in docs)
        combined += f"\n--- {test} ---\n{chunk}"
        if len(combined) > 1800:
            break

    return {"retrieved_lab_guidelines": combined}


# ── Node 3: Analyse labs against retrieved guidelines ────────────────────────

_ANALYZE_PROMPT = PromptTemplate.from_template("""
You are an expert Clinical Decision Support Agent.
Evaluate the patient's lab results strictly using the provided Medical Reference Text.
Take the Doctor's Context into consideration when writing your summary.

Doctor's Context: {explanation}
Patient Lab Results (JSON): {lab_inputs}
Medical Reference Text (from RAG Database): {context}

For each test, determine if it is Normal, High, or Low based on the reference text.
If abnormal, list the potential clinical causes or associated diseases.

Return ONLY a valid JSON object in this exact structure:
{{
  "primary_hypothesis": "A concise 1-2 sentence summary of the most likely condition",
  "simple_explanation": "2-3 sentences in plain everyday English a patient can understand. No jargon.",
  "detailed_analysis": [
    {{
      "test_name": "...",
      "patient_value": "...",
      "reference_range": "...",
      "status": "Normal | High | Low | Borderline",
      "potential_causes": ["...", "..."]
    }}
  ]
}}

Do NOT include markdown, code fences, or the word "json".
Start your response with {{ and end with }}.
""")


def _analyze_labs_node(state: DiagnosisAgentState) -> dict:
    """Node 3 — Combine extracted values + RAG context to produce a structured diagnosis."""
    print("[DiagnosisAgent] Node 3: Analysing results against medical guidelines...")

    response = llm.invoke(_ANALYZE_PROMPT.format(
        explanation=state["doctor_explanation"][:300],
        lab_inputs=json.dumps(state["extracted_lab_values"]),
        context=state["retrieved_lab_guidelines"][:1500],
    ))
    result = _parse_json(response.content)
    print("[DiagnosisAgent] Analysis complete.")
    return {"evaluation_results": result}


# ── Node 4: Diagnosis Evaluator (Quality Gate) ────────────────────────────────

_EVALUATE_PROMPT = PromptTemplate.from_template("""
You are a Senior Clinical Auditor. Your job is to verify an AI-generated diagnosis by comparing it against the raw lab data and the medical reference guidelines.

Raw Lab Values (Extracted): {raw_labs}
Medical Guidelines (ChromaDB): {chroma_context}

AI-Generated Diagnosis to Evaluate:
Primary Hypothesis: {hypothesis}
Abnormal Findings Flagged by AI: {abnormals}

Compare the AI-Generated Diagnosis against the Raw Lab Values and Medical Guidelines.
Check for Hallucinations: Did the AI invent any abnormal values that weren't in the raw labs?
Check for Missed Data: Did the AI miss any abnormal values that the guidelines say are high/low?

Rate and evaluate the diagnosis. Return ONLY valid JSON:
{{
  "confidence_score": <integer 0-100 based on accuracy of the diagnosis>,
  "completeness_flag": "complete | partial | insufficient",
  "key_abnormalities": ["most critical finding 1", "most critical finding 2"],
  "evaluation_notes": "reviewer commentary on whether the diagnosis accurately reflects the raw labs and guidelines. Flag any hallucinations here.",
  "recommended_specialization": "single best specialist type (e.g. Endocrinologist)"
}}

Start your response with {{ and end with }}.
""")


def _evaluate_diagnosis_node(state: DiagnosisAgentState) -> dict:
    """
    Node 4 (Diagnosis Evaluator) — Quality-gate that reviews the raw diagnosis against ground truth data:
      - confidence_score       (0–100)
      - completeness_flag      (complete / partial / insufficient)
      - key_abnormalities      list of the most critical abnormal findings
      - evaluation_notes       any caveats, missing data flags, or hallucination warnings
      - recommended_specialization  map the hypothesis to a specialist
    """
    print("[DiagnosisAgent] Node 4 (Evaluator): Cross-checking diagnosis against raw labs and guidelines...")

    evaluation = state.get("evaluation_results", {})
    detailed   = evaluation.get("detailed_analysis", [])
    hypothesis = evaluation.get("primary_hypothesis", "")

    # Format the abnormals that Node 3 found
    abnormals = [
        f"{r.get('test_name','?')}: {r.get('patient_value','?')} ({r.get('status','?')})"
        for r in detailed if r.get("status", "Normal") != "Normal"
    ]
    
    # Get the raw inputs to use as Ground Truth for the evaluator
    raw_labs = json.dumps(state.get("extracted_lab_values", {}))
    chroma_context = state.get("retrieved_lab_guidelines", "")

    response = llm.invoke(_EVALUATE_PROMPT.format(
        raw_labs=raw_labs,
        chroma_context=chroma_context[:1000], # Limit context to save tokens
        hypothesis=hypothesis[:300],
        abnormals="; ".join(abnormals[:6]) or "None flagged",
    ))
    summary = _parse_json(response.content)

    # Override specialization with the rule-based mapper for consistency
    summary["recommended_specialization"] = map_specialization(hypothesis)

    print(f"[DiagnosisAgent] Confidence: {summary.get('confidence_score', '?')}% | "
          f"Completeness: {summary.get('completeness_flag', '?')}")
    return {"evaluation_summary": summary}
