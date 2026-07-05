import os
import json
import concurrent.futures
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv

from .database import get_db
from .models import Doctor, Patient, Appointment, ChatMessage, ReportUpload
from .schemas import (
    ChatRequest, ChatResponse, DoctorOut,
    AppointmentCreate, AppointmentOut,
    DiagnoseResponse, LabMarker,
    TreatmentRequest, TreatmentResponse, TreatmentStep,
    ReportUploadResponse, MetaEvaluation,
)
from .agents import run_acdss_agent
from .seed import seed_database

load_dotenv()

# ── Allowed CORS origins ──────────────────────────────────────────────────────
_env_origin = os.getenv("FRONTEND_ORIGIN", "")
ALLOWED_ORIGINS = [o.strip() for o in _env_origin.split(",") if o.strip()] or [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

# ── Lazy-load the heavy pipeline ──────────────────────────────────────────────
_pipeline_loaded = False
_ocr_fn          = None
_run_diagnosis   = None
_run_treatment   = None

def _load_pipeline():
    global _pipeline_loaded, _ocr_fn, _run_diagnosis, _run_treatment
    if not _pipeline_loaded:
        from .ocr import extract_text_from_image
        from .Dual_Agent.Diagnosis_Agent.agent import run_diagnosis_agent
        from .Dual_Agent.Treatment_Agent.agent import run_treatment_agent
        _ocr_fn        = extract_text_from_image
        _run_diagnosis = run_diagnosis_agent
        _run_treatment = run_treatment_agent
        _pipeline_loaded = True

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

# ── App lifespan ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app_instance):
    seed_database()
    yield

app = FastAPI(title="ACDSS Doctor Referral API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def doctor_to_out(d: Doctor) -> DoctorOut:
    return DoctorOut(
        id=d.id, name=d.name, specialization=d.specialization,
        hospital=d.hospital, location=d.location,
        experience_years=d.experience_years, rating=d.rating,
        available_slots=[s.strip() for s in (d.available_slots or "").split(",") if s.strip()],
    )

def _normalise_labs(raw_analysis: list) -> list[LabMarker]:
    out = []
    for item in raw_analysis:
        if isinstance(item, dict):
            out.append(LabMarker(
                test_name=item.get("test_name", ""),
                patient_value=item.get("patient_value", ""),
                reference_range=item.get("reference_range", ""),
                status=item.get("status", "Unknown"),
                potential_causes=item.get("potential_causes", []),
            ))
    return out

def _normalise_plan(raw_plan: list) -> list[TreatmentStep]:
    out = []
    for step in raw_plan:
        if isinstance(step, dict):
            out.append(TreatmentStep(
                medication_or_action=step.get("medication_or_action", ""),
                dosage_or_detail=step.get("dosage_or_detail", ""),
                rationale=step.get("rationale", ""),
            ))
    return out

def _build_meta_eval(raw: dict | None) -> MetaEvaluation | None:
    """Safely coerce the raw meta-evaluation dict into a MetaEvaluation schema."""
    if not raw or not isinstance(raw, dict):
        return None
    return MetaEvaluation(
        overall_quality_score=raw.get("overall_quality_score", 80),
        consistency_verdict=raw.get("consistency_verdict", "minor_gaps"),
        safety_verdict=raw.get("safety_verdict", "review_recommended"),
        safety_flags=raw.get("safety_flags", []),
        clinical_summary=raw.get("clinical_summary", ""),
        pipeline_recommendations=raw.get("pipeline_recommendations", ""),
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "ACDSS backend running"}


# ── Conversational chat (symptom triage) ─────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """
    Smart conversational endpoint.
    Only fetches doctors when the AI determines a clinical specialization is needed.
    For plain conversational replies (greetings, thanks, etc.) it returns an empty
    doctor list and ask_booking=False so the frontend doesn't push booking.
    """
    result  = run_acdss_agent(req)
    spec    = result.specialization

    # Doctors are shown ONLY when the agent's suggest_doctors tool ran — i.e. the
    # patient explicitly agreed to see suggestions. The agent asks first.
    doctors = []
    ask_booking = False
    if result.show_doctors:
        list_spec = result.doctor_specialization or spec or "General Physician"
        doctors = (
            db.query(Doctor)
            .filter(Doctor.specialization == list_spec)
            .order_by(Doctor.rating.desc())
            .limit(5)
            .all()
        )
        if not doctors:
            doctors = db.query(Doctor).filter(
                Doctor.specialization == "General Physician"
            ).limit(5).all()
        spec = spec or list_spec
        ask_booking = bool(doctors)

    db.add(ChatMessage(user_message=req.message, ai_response=result.reply))
    db.commit()

    return ChatResponse(
        reply=result.reply,
        possible_issue=result.possible_issue,
        recommended_specialization=spec or "",
        doctors=[doctor_to_out(d) for d in doctors],
        ask_booking=ask_booking,
        diagnosis=result.diagnosis,
        treatment=result.treatment,
        booking=result.booking,
    )


# ── NEW: Diagnosis-only endpoint ──────────────────────────────────────────────
@app.post("/diagnose", response_model=DiagnoseResponse)
def diagnose(
    file:         UploadFile = File(...),
    doctor_notes: str        = Form(""),
    patient_name: str        = Form("Guest"),
    db:           Session    = Depends(get_db),
):
    """
    Step 1 of the 2-step flow.
    Runs OCR + Diagnosis + Diagnosis Evaluator.
    Does NOT run treatment — frontend shows diagnosis first.
    """
    allowed = {"image/jpeg", "image/png", "image/jpg", "image/bmp", "image/tiff"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Upload JPG or PNG.")

    image_bytes = file.file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB).")

    _load_pipeline()
    raw_text = _ocr_fn(image_bytes)
    if not raw_text:
        raise HTTPException(status_code=422,
            detail="Could not extract text from image. Upload a clear, high-resolution lab report.")

    future = _executor.submit(_run_diagnosis, raw_text, doctor_notes)
    try:
        result = future.result(timeout=120)
    except concurrent.futures.TimeoutError:
        raise HTTPException(status_code=504, detail="Diagnosis timed out. Please try again.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Diagnosis error: {exc}")

    db.add(ReportUpload(
        patient_name=patient_name,
        raw_text=raw_text,
        hypothesis=result.get("primary_hypothesis", ""),
        specialization=result.get("recommended_specialization", ""),
    ))
    db.commit()

    spec = result.get("recommended_specialization", "General Physician")
    doctors = (
        db.query(Doctor)
        .filter(Doctor.specialization == spec)
        .order_by(Doctor.rating.desc())
        .limit(5)
        .all()
    )

    return DiagnoseResponse(
        raw_text=raw_text,
        extracted_lab_values=result.get("extracted_lab_values", {}),
        primary_hypothesis=result.get("primary_hypothesis", ""),
        simple_explanation=result.get("simple_explanation", ""),
        detailed_analysis=_normalise_labs(result.get("detailed_analysis", [])),
        recommended_specialization=spec,
        confidence_score=result.get("confidence_score", 75),
        key_abnormalities=result.get("key_abnormalities", []),
        evaluation_notes=result.get("evaluation_notes", ""),
        doctors=[doctor_to_out(d) for d in doctors],
    )


# ── NEW: Treatment-only endpoint ──────────────────────────────────────────────
@app.post("/treatment", response_model=TreatmentResponse)
def treatment(req: TreatmentRequest):
    """
    Step 2 of the 2-step flow.
    Receives the diagnosis result + the patient's symptom message from chat.
    Runs Treatment + Treatment Evaluator.
    Returns treatment plan, severity, and a follow-up question.
    """
    _load_pipeline()

    diagnosis_dict = {
        "primary_hypothesis":   req.primary_hypothesis,
        "extracted_lab_values": req.extracted_lab_values,
        "detailed_analysis":    req.detailed_analysis,
    }

    future = _executor.submit(_run_treatment, diagnosis_dict, req.patient_symptoms)
    try:
        result = future.result(timeout=120)
    except concurrent.futures.TimeoutError:
        raise HTTPException(status_code=504, detail="Treatment planning timed out.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Treatment error: {exc}")

    return TreatmentResponse(
        disease_explanation=result.get("disease_explanation", ""),
        treatment_plan=_normalise_plan(result.get("treatment_plan", [])),
        prognosis=result.get("prognosis", ""),
        follow_up=result.get("follow_up", ""),
        severity_level=result.get("severity_level", "moderate"),
        follow_up_question=result.get("follow_up_question",
            "Are you currently experiencing any new or worsening symptoms?"),
        meta_evaluation=_build_meta_eval(result.get("meta_evaluation")),
    )


# ── Legacy: full pipeline (kept for backward compat) ─────────────────────────
@app.post("/upload-report", response_model=ReportUploadResponse)
def upload_report(
    file:         UploadFile = File(...),
    doctor_notes: str        = Form(""),
    patient_name: str        = Form("Guest"),
    db:           Session    = Depends(get_db),
):
    allowed = {"image/jpeg", "image/png", "image/jpg", "image/bmp", "image/tiff"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415,
            detail=f"Unsupported file type '{file.content_type}'.")

    image_bytes = file.file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB).")

    _load_pipeline()
    raw_text = _ocr_fn(image_bytes)
    if not raw_text:
        raise HTTPException(status_code=422, detail="Could not extract text from image.")

    from .Dual_Agent.orchestrator import run_dual_agent_pipeline
    future = _executor.submit(run_dual_agent_pipeline, raw_text, doctor_notes, "")
    try:
        result = future.result(timeout=120)
    except concurrent.futures.TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}")

    db.add(ReportUpload(
        patient_name=patient_name, raw_text=raw_text,
        hypothesis=result.get("primary_hypothesis", ""),
        specialization=result.get("recommended_specialization", ""),
    ))
    db.commit()

    spec = result.get("recommended_specialization", "General Physician")
    doctors = (
        db.query(Doctor).filter(Doctor.specialization == spec)
        .order_by(Doctor.rating.desc()).limit(5).all()
    )

    return ReportUploadResponse(
        raw_text=raw_text,
        extracted_lab_values=result.get("extracted_lab_values", {}),
        primary_hypothesis=result.get("primary_hypothesis", ""),
        detailed_analysis=_normalise_labs(result.get("detailed_analysis", [])),
        disease_explanation=result.get("disease_explanation", ""),
        treatment_plan=_normalise_plan(result.get("treatment_plan", [])),
        prognosis=result.get("prognosis", ""),
        follow_up=result.get("follow_up", ""),
        recommended_specialization=spec,
        doctors=[doctor_to_out(d) for d in doctors],
        meta_evaluation=_build_meta_eval(result.get("meta_evaluation")),
    )


# ── Doctor list ───────────────────────────────────────────────────────────────
@app.get("/doctors", response_model=list[DoctorOut])
def list_doctors(
    specialization: str | None = None,
    location:       str | None = None,
    db:             Session    = Depends(get_db),
):
    q = db.query(Doctor)
    if specialization:
        q = q.filter(Doctor.specialization == specialization)
    if location:
        q = q.filter(Doctor.location.ilike(f"%{location}%"))
    return [doctor_to_out(d) for d in q.order_by(Doctor.rating.desc()).all()]


# ── Appointment booking ───────────────────────────────────────────────────────
@app.post("/appointments", response_model=AppointmentOut)
def create_appointment(req: AppointmentCreate, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == req.doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    patient = Patient(name=req.patient_name, age=req.age, gender=req.gender, phone=req.phone)
    db.add(patient)
    db.flush()

    appointment = Appointment(
        patient_id=patient.id, doctor_id=doctor.id,
        slot=req.slot, status="booked",
    )
    db.add(appointment)
    db.commit()
    db.refresh(appointment)

    return AppointmentOut(
        id=appointment.id, doctor_name=doctor.name,
        patient_name=patient.name, slot=appointment.slot,
        status=appointment.status,
    )
