from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ChatMessageInput(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message:              str
    chat_history:         List[ChatMessageInput] = []
    ocr_text:             Optional[str] = None
    primary_hypothesis:   Optional[str] = None
    extracted_lab_values: Optional[Dict[str, str]] = None
    detailed_analysis:    Optional[List[Dict[str, Any]]] = None
    diagnosis:            Optional[Dict[str, Any]] = None 
    treatment:            Optional[Dict[str, Any]] = None 
    patient_name:         Optional[str] = "Guest"
    age:                  Optional[int] = None
    gender:               Optional[str] = None
    phone:                Optional[str] = None

class DoctorOut(BaseModel):
    id:               int
    name:             str
    specialization:   str
    hospital:         str
    location:         str
    experience_years: int
    rating:           float
    available_slots:  List[str]

class ChatResponse(BaseModel):
    reply:                      str
    possible_issue:             str
    recommended_specialization: str
    doctors:                    List[DoctorOut]
    ask_booking:                bool = True
    diagnosis:                  Optional[Dict[str, Any]] = None
    treatment:                  Optional[Dict[str, Any]] = None  
    booking:                    Optional[Dict[str, Any]] = None  


class AppointmentCreate(BaseModel):
    patient_name: str
    age:          Optional[int] = None
    gender:       Optional[str] = None
    phone:        Optional[str] = None
    doctor_id:    int
    slot:         str

class AppointmentOut(BaseModel):
    id:           int
    doctor_name:  str
    patient_name: str
    slot:         str
    status:       str


# ── Shared sub-schemas ────────────────────────────────────────────────────────

class LabMarker(BaseModel):
    test_name:        str
    patient_value:    str
    reference_range:  str
    status:           str               # Normal | High | Low | Borderline
    potential_causes: List[str] = []

class TreatmentStep(BaseModel):
    medication_or_action: str
    dosage_or_detail:     str
    rationale:            str

class MetaEvaluation(BaseModel):
    """Output of the Final Meta-Evaluator (Call 3) — pipeline-level quality gate."""
    overall_quality_score:    int    = 80    # 0-100 overall pipeline quality
    consistency_verdict:      str    = "minor_gaps"   # consistent | minor_gaps | inconsistent
    safety_verdict:           str    = "review_recommended"  # safe_to_proceed | review_recommended | escalate_immediately
    safety_flags:             List[str] = []           # list of safety concerns, empty if none
    clinical_summary:         str    = ""  # 2-3 sentence summary for the treating physician
    pipeline_recommendations: str    = ""  # what the physician should verify or do next


# ── Diagnosis-only response (/diagnose) ───────────────────────────────────────

class DiagnoseResponse(BaseModel):
    raw_text:                   str
    extracted_lab_values:       Dict[str, str]
    primary_hypothesis:         str
    simple_explanation:         str = ""      # plain English for the patient
    detailed_analysis:          List[LabMarker]
    recommended_specialization: str
    # Evaluator fields
    confidence_score:           int = 75
    key_abnormalities:          List[str] = []
    evaluation_notes:           str = ""
    doctors:                    List[DoctorOut] = []


# ── Treatment-only request/response (/treatment) ─────────────────────────────

class TreatmentRequest(BaseModel):
    """Sent by the frontend after the user asks for treatment."""
    # Diagnosis context (echoed back from DiagnoseResponse)
    primary_hypothesis:    str
    extracted_lab_values:  Dict[str, str]
    detailed_analysis:     List[Dict[str, Any]] = []
    # Patient's additional message / symptoms from the chat
    patient_symptoms:      str = ""
    patient_name:          Optional[str] = "Guest"

class TreatmentResponse(BaseModel):
    disease_explanation:  str
    treatment_plan:       List[TreatmentStep]
    prognosis:            str
    follow_up:            str
    # Treatment Evaluator (Node 4) fields
    severity_level:       str   # mild | moderate | severe | critical
    follow_up_question:   str   # targeted question for the patient
    # Final Meta-Evaluator (Call 3) output
    meta_evaluation:      Optional[MetaEvaluation] = None


# ── Legacy full-pipeline response (kept for /upload-report backward compat) ───

class ReportUploadResponse(BaseModel):
    raw_text:                   str
    extracted_lab_values:       Dict[str, str]
    primary_hypothesis:         str
    detailed_analysis:          List[LabMarker]
    disease_explanation:        str
    treatment_plan:             List[TreatmentStep]
    prognosis:                  str
    follow_up:                  str
    recommended_specialization: str
    doctors:                    List[DoctorOut] = []
    # Final Meta-Evaluator output
    meta_evaluation:            Optional[MetaEvaluation] = None
