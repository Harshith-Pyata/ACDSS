"""
Dual_Agent/orchestrator.py
===========================
Combines the standalone Diagnosis and Treatment agents into one
sequential dual-agent pipeline, with a Final Meta-Evaluator that
cross-validates the combined output.

Pipeline:
  1. Diagnosis Agent  → structured diagnosis result
  2. Treatment Agent  → personalised treatment plan
  3. Meta-Evaluator   → cross-validation, safety verdict, quality score

Usage:
    from app.Dual_Agent.orchestrator import run_dual_agent_pipeline

    result = run_dual_agent_pipeline(
        raw_ocr_text="...",
        doctor_notes="...",
        patient_symptoms="fatigue, blurred vision",
    )
"""

from .Diagnosis_Agent.agent import run_diagnosis_agent
from .Treatment_Agent.agent import run_treatment_agent
from .meta_evaluator import run_meta_evaluation


def run_dual_agent_pipeline(
    raw_ocr_text: str,
    doctor_notes: str = "",
    patient_symptoms: str = "",
) -> dict:
    """
    Run the full dual-agent pipeline:
      1. Diagnosis Agent  → structured diagnosis result
      2. Treatment Agent  → personalised treatment plan
      3. Meta-Evaluator   → cross-validation, safety verdict, quality score

    Args:
        raw_ocr_text:      OCR-extracted text from the lab report.
        doctor_notes:      Optional context from the doctor/patient.
        patient_symptoms:  Additional symptoms described in chat.

    Returns:
        Merged dict containing all diagnosis + treatment + meta-evaluation keys.
    """
    print("\n[DualAgent] ─── Starting Diagnosis Agent ───")
    diagnosis_result = run_diagnosis_agent(raw_ocr_text, doctor_notes)

    print("\n[DualAgent] ─── Starting Treatment Agent ───")

    diagnosis_result["doctor_explanation"] = doctor_notes
    treatment_result = run_treatment_agent(diagnosis_result, patient_symptoms)

    print("\n[DualAgent] ─── Starting Final Meta-Evaluator ───")

    _raw_treatment = {
        "severity_level":            treatment_result.get("severity_level", "moderate"),
        "prognosis":                 treatment_result.get("prognosis", ""),
        "optimized_treatment_plan":  treatment_result.get("treatment_plan", []),
    }
    meta_result = run_meta_evaluation(
        diagnosis_result=diagnosis_result,
        treatment_result=_raw_treatment,
    )

    print("\n[DualAgent] ─── Pipeline Complete ───")

    return {

        "primary_hypothesis":         diagnosis_result["primary_hypothesis"],
        "simple_explanation":         diagnosis_result["simple_explanation"],
        "detailed_analysis":          diagnosis_result["detailed_analysis"],
        "extracted_lab_values":       diagnosis_result["extracted_lab_values"],
        "recommended_specialization": diagnosis_result["recommended_specialization"],
        "confidence_score":           diagnosis_result["confidence_score"],
        "key_abnormalities":          diagnosis_result["key_abnormalities"],
        "evaluation_notes":           diagnosis_result["evaluation_notes"],
        "completeness_flag":          diagnosis_result["completeness_flag"],
        "disease_explanation":        treatment_result["disease_explanation"],
        "treatment_plan":             treatment_result["treatment_plan"],
        "prognosis":                  treatment_result["prognosis"],
        "follow_up":                  treatment_result["follow_up"],
        "severity_level":             treatment_result["severity_level"],
        "follow_up_question":         treatment_result["follow_up_question"],
        "meta_evaluation":            meta_result,
    }
