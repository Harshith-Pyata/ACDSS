import os
import json
from dataclasses import dataclass
from typing import Optional

from langchain_groq import ChatGroq
from langchain_core.tools import tool
from langchain_core.messages import (
    SystemMessage, HumanMessage, AIMessage, ToolMessage,
)

from app.schemas import ChatRequest


@dataclass
class AgentResult:
    possible_issue: str
    specialization: str
    reply: str
    diagnosis: Optional[dict] = None   # set when the analyze_lab_report tool runs
    treatment: Optional[dict] = None   # set when the build_treatment_plan tool runs
    show_doctors: bool = False         # True only after the user agrees to see doctors
    doctor_specialization: str = ""    # which specialization to list when show_doctors
    booking: Optional[dict] = None     # set when book_appointment writes an appointment


# Specializations that actually exist in the doctor database. The agent must
# only ever recommend one of these so the /chat endpoint can find a real doctor.
VALID_SPECIALIZATIONS = [
    "General Physician",
    "Cardiologist",
    "Nephrologist",
    "Endocrinologist",
    "Gastroenterologist",
    "Dermatologist",
    "Neurologist",
    "Orthopedic",
    "Ophthalmologist",
    "Psychiatrist",
    "Pulmonologist",
    "Emergency Medicine",
]


def _snap_specialization(value: str) -> str:
    """Snap a free-text specialization to the nearest valid DB specialization."""
    spec = (value or "").strip()
    for v in VALID_SPECIALIZATIONS:
        if v.lower() == spec.lower():
            return v
    # loose contains-match (e.g. "Nephrology" -> "Nephrologist")
    low = spec.lower()
    for v in VALID_SPECIALIZATIONS:
        root = v.lower().replace("ist", "").replace("ian", "")
        if root and root in low:
            return v
    return "General Physician"


SYSTEM_PROMPT = (
    "You are ACDSS, a warm, compassionate AI clinical assistant that chats with "
    "patients in plain language and can drive a clinical-analysis pipeline.\n\n"
    "TOOLS YOU CAN USE:\n"
    "- analyze_lab_report: runs the diagnosis engine (RAG over clinical guidelines) "
    "on lab-report text. Call this WHENEVER the message contains text extracted "
    "from a lab report (it will be wrapped in [LAB REPORT TEXT] ... [END LAB REPORT "
    "TEXT]). After it runs, explain the diagnosis to the patient simply.\n"
    "- build_treatment_plan: runs the treatment engine using the existing "
    "diagnosis. Call this when the patient asks what to do / for treatment / "
    "medication / a plan, AND a diagnosis already exists. Then summarise the plan.\n"
    "- get_patient_labs: read back the patient's already-computed diagnosis/labs "
    "when they ask about their report or a specific marker.\n"
    "- recommend_specialist: record which specialist suits the patient's concern. "
    "This does NOT show any doctors — it only notes the specialization.\n"
    "- suggest_doctors: actually surface a list of doctors for a specialization. "
    "Call this ONLY after the patient has said yes to seeing doctor suggestions.\n"
    "- get_doctor_availability: look up a specific doctor by name and return their "
    "open appointment slots. Use this when the patient names a doctor to book.\n"
    "- book_appointment: book an appointment. Requires the doctor's name, the chosen "
    "slot, and the patient's name. Only call it once you have all three.\n\n"
    "HOW TO BEHAVE:\n"
    "1. You are first a conversational assistant. Answer questions directly and "
    "kindly. For greetings, thanks, or general questions, just reply naturally "
    "without calling any tool.\n"
    "2. Only call a tool when its specific trigger below is met.\n\n"
    "DOCTOR-SUGGESTION FLOW (follow this exactly):\n"
    "1. When you've identified a health concern, call recommend_specialist to note "
    "the specialization, then ASK the patient: 'Would you like me to suggest some "
    "doctors for this?' Do NOT list any doctors yet.\n"
    "2. Only if the patient says yes, call suggest_doctors with that specialization "
    "and briefly present the options it returns.\n"
    "3. If the patient names a specific doctor to book with, call "
    "get_doctor_availability for that name, then ASK which of the returned slots "
    "they want.\n"
    "4. Before booking you MUST have: the doctor's name, the chosen slot, and the "
    "patient's name. If any are missing, ASK the patient for them in chat (one "
    "friendly question). Only when you have all three, call book_appointment. "
    "Then confirm the booking warmly.\n\n"
    "STRICT BOOKING RULES (never break these):\n"
    "- NEVER invent or assume the patient's name, the doctor, or the slot. Only use "
    "values the patient actually gave you in the conversation.\n"
    "- If the patient asks to 'suggest', 'recommend', or 'show' doctors, call "
    "suggest_doctors — do NOT book anything.\n"
    "- Only call book_appointment after the patient has clearly said they want to "
    "book AND has given a doctor, a slot, and their name. When unsure, ask — never "
    "book.\n\n"
    "VALID SPECIALIZATIONS:\n"
    f"- Must be exactly one of: {', '.join(VALID_SPECIALIZATIONS)}.\n"
    "- Map sensibly, e.g. kidney/creatinine -> Nephrologist, heart/chest pain/BP -> "
    "Cardiologist, diabetes/thyroid/hormones -> Endocrinologist, stomach/digestion "
    "-> Gastroenterologist, skin -> Dermatologist, headache/nerves -> Neurologist, "
    "bones/joints -> Orthopedic, eyes -> Ophthalmologist, mood/anxiety -> "
    "Psychiatrist, lungs/breathing -> Pulmonologist, life-threatening -> Emergency "
    "Medicine. If unclear, General Physician.\n\n"
    "Keep replies concise, friendly, jargon-free. You are an assistant, not a "
    "substitute for a licensed doctor; remind patients to seek professional care "
    "for serious concerns."
)


def _to_lc_messages(chat_history):
    """Convert the request's chat history into LangChain message objects."""
    msgs = []
    for m in (chat_history or [])[-6:]:
        role = (m.role or "").lower()
        if role in ("user", "human"):
            msgs.append(HumanMessage(content=m.content))
        elif role in ("assistant", "ai"):
            msgs.append(AIMessage(content=m.content))
    return msgs


def run_acdss_agent(req: ChatRequest) -> AgentResult:
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.4,
        api_key=os.getenv("GROQ_API_KEY"),
    )

    # Mutable state captured by the tools and returned to the caller (main.py).
    agent_state = {
        "specialization": "",
        "possible_issue": "General health concern",
        "diagnosis": None,        # full diagnosis dict once analyze_lab_report runs
        "treatment": None,        # full treatment dict once build_treatment_plan runs
        "show_doctors": False,    # set True by suggest_doctors (after user agrees)
        "doctor_spec": "",        # specialization to list when show_doctors is True
        "booking": None,          # appointment dict once book_appointment succeeds
    }

    def _current_diagnosis() -> dict:
        """Best available diagnosis: freshly computed this turn, else round-tripped."""
        if agent_state["diagnosis"]:
            return agent_state["diagnosis"]
        if req.primary_hypothesis or req.extracted_lab_values:
            return {
                "primary_hypothesis":   req.primary_hypothesis or "",
                "extracted_lab_values": req.extracted_lab_values or {},
                "detailed_analysis":    req.detailed_analysis or [],
            }
        return {}

    # ── Tool 1: run the Diagnosis Agent (RAG) on extracted lab-report text ────
    @tool
    def analyze_lab_report(ocr_text: str = "") -> str:
        """Run the diagnosis engine on lab-report text extracted from an image.
        Call this whenever lab-report text is available. `ocr_text` is the extracted
        text. Returns a short diagnosis summary; the full structured result is stored
        for the rest of the conversation."""
        text = (ocr_text or req.ocr_text or "").strip()
        if not text:
            return "No lab-report text is available to analyze. Ask the patient to upload a report."
        # Deferred import so plain chats never load the heavy LangGraph/Chroma stack.
        from app.Dual_Agent.Diagnosis_Agent.agent import run_diagnosis_agent
        diag = run_diagnosis_agent(text, doctor_notes=req.message or "")
        agent_state["diagnosis"] = diag
        agent_state["specialization"] = _snap_specialization(
            diag.get("recommended_specialization", "")
        )
        agent_state["possible_issue"] = diag.get(
            "primary_hypothesis", "General health concern"
        )
        return (
            "Diagnosis complete.\n"
            f"- Primary hypothesis: {diag.get('primary_hypothesis', 'N/A')}\n"
            f"- Plain explanation: {diag.get('simple_explanation', '')}\n"
            f"- Key abnormalities: {', '.join(diag.get('key_abnormalities', [])) or 'none noted'}\n"
            f"- Confidence: {diag.get('confidence_score', 'N/A')}\n"
            f"- Suggested specialist: {agent_state['specialization']}\n"
            "Explain this to the patient simply and kindly."
        )

    # ── Tool 2: run the Treatment Agent on the existing diagnosis ────────────
    @tool
    def build_treatment_plan(symptoms: str = "") -> str:
        """Run the treatment engine using the existing diagnosis to produce a
        personalised treatment plan. Call this when the patient asks for treatment,
        medication, or a plan AND a diagnosis already exists. `symptoms` is any
        additional symptoms the patient mentioned."""
        diag = _current_diagnosis()
        if not (diag.get("primary_hypothesis") or diag.get("extracted_lab_values")):
            return ("No diagnosis exists yet. A lab report must be analyzed first "
                    "(use analyze_lab_report) before building a treatment plan.")
        from app.Dual_Agent.Treatment_Agent.agent import run_treatment_agent
        treat = run_treatment_agent(diag, symptoms or req.message or "")
        agent_state["treatment"] = treat
        steps = treat.get("treatment_plan", [])
        step_lines = "; ".join(
            s.get("medication_or_action", "") for s in steps if isinstance(s, dict)
        )
        return (
            "Treatment plan ready.\n"
            f"- Overview: {treat.get('disease_explanation', '')}\n"
            f"- Steps: {step_lines or 'see plan'}\n"
            f"- Severity: {treat.get('severity_level', 'moderate')}\n"
            f"- Prognosis: {treat.get('prognosis', '')}\n"
            "Summarise this for the patient and remind them to confirm with a doctor."
        )

    # ── Tool 3: read back already-computed labs/diagnosis ────────────────────
    @tool
    def get_patient_labs(query: str = "") -> str:
        """Read back the patient's already-computed diagnosis and lab values when
        they ask about their report, kidney, heart, sugar, or any uploaded result."""
        diag = _current_diagnosis()
        if diag.get("primary_hypothesis") or diag.get("extracted_lab_values"):
            return (
                f"Patient Diagnosis: {diag.get('primary_hypothesis', '')}\n"
                f"Extracted Lab Values: {json.dumps(diag.get('extracted_lab_values', {}))}"
            )
        return "No lab report has been analyzed for this patient yet."

    # ── Tool 4: note the suitable specialist (does NOT show doctors) ─────────
    @tool
    def recommend_specialist(specialization: str, issue_summary: str) -> str:
        """Record which specialist suits the patient's concern. `specialization`
        must be a valid specialization; `issue_summary` is a short description.
        This does NOT display any doctors — after calling it you must ASK the
        patient whether they'd like doctor suggestions."""
        agent_state["specialization"] = _snap_specialization(specialization)
        agent_state["possible_issue"] = issue_summary or "General health concern"
        return (
            f"Noted: {agent_state['specialization']} for "
            f"{agent_state['possible_issue']}. Do NOT list doctors yet — first ask "
            "the patient if they want doctor suggestions."
        )

    # ── Tool 5: surface doctors (only after the patient agrees) ──────────────
    @tool
    def suggest_doctors(specialization: str = "") -> str:
        """Surface a list of doctors for a specialization. Call ONLY after the
        patient has agreed to see doctor suggestions. Returns the available doctors
        so you can present them; the structured list is shown to the patient too."""
        spec = _snap_specialization(specialization or agent_state["specialization"])
        agent_state["show_doctors"] = True
        agent_state["doctor_spec"] = spec
        from app.database import SessionLocal
        from app.models import Doctor
        db = SessionLocal()
        try:
            docs = (
                db.query(Doctor)
                .filter(Doctor.specialization == spec)
                .order_by(Doctor.rating.desc())
                .limit(5)
                .all()
            )
            if not docs:
                docs = (
                    db.query(Doctor)
                    .filter(Doctor.specialization == "General Physician")
                    .limit(5).all()
                )
                spec = "General Physician"
                agent_state["doctor_spec"] = spec
            if not docs:
                return f"No doctors found for {spec}."
            lines = [
                f"{d.name} ({d.specialization}, {d.hospital}, {d.location}) — "
                f"rating {d.rating}"
                for d in docs
            ]
            return (
                f"Showing {len(docs)} {spec}(s) to the patient:\n- "
                + "\n- ".join(lines)
                + "\nPresent these briefly and ask if they'd like to book one."
            )
        finally:
            db.close()

    # ── Tool 6: look up a named doctor's open slots ──────────────────────────
    @tool
    def get_doctor_availability(doctor_name: str) -> str:
        """Look up a doctor by name and return their open appointment slots so you
        can ask the patient which slot they want. `doctor_name` is the patient's
        spoken name for the doctor (partial names are okay)."""
        name = (doctor_name or "").strip()
        if not name:
            return "Ask the patient which doctor they'd like to book with."
        from app.database import SessionLocal
        from app.models import Doctor
        db = SessionLocal()
        try:
            matches = (
                db.query(Doctor)
                .filter(Doctor.name.ilike(f"%{name}%"))
                .all()
            )
            if not matches:
                return (f"No doctor matching '{name}' was found. Ask the patient to "
                        "check the name or pick from the suggested doctors.")
            if len(matches) > 1:
                names = "; ".join(f"{d.name} ({d.specialization}, {d.location})" for d in matches)
                return (f"Multiple doctors match '{name}': {names}. Ask the patient "
                        "which one they mean.")
            d = matches[0]
            slots = [s.strip() for s in (d.available_slots or "").split(",") if s.strip()]
            return (
                f"{d.name} ({d.specialization}, {d.hospital}, {d.location}). "
                f"Available slots: {', '.join(slots) if slots else 'none listed'}. "
                "Ask the patient which slot they want."
            )
        finally:
            db.close()

    # ── Tool 7: book an appointment (writes to the DB) ───────────────────────
    @tool
    def book_appointment(
        doctor_name: str,
        slot: str,
        patient_name: str = "",
        age: str = "",
        gender: str = "",
        phone: str = "",
    ) -> str:
        """Book an appointment. Requires `doctor_name`, `slot`, and `patient_name`.
        If any of those are missing, do not call this — ask the patient first.
        `age`, `gender`, `phone` are optional."""
        # ── Ground every argument in what the USER actually said, so the model
        #    cannot book on invented data (e.g. a hallucinated 'John Doe'). ──
        user_text = " ".join(
            [req.message or ""]
            + [(m.content or "") for m in (req.chat_history or [])
               if (getattr(m, "role", "") or "").lower() in ("user", "human")]
        ).lower()

        # 1) The patient must have actually asked to book — never book unprompted.
        if not any(w in user_text for w in ("book", "appointment", "schedule", "reserve")):
            return ("The patient has not asked to book an appointment. Do NOT book. "
                    "If they want to see doctors, call suggest_doctors instead; "
                    "otherwise just keep chatting.")

        # 2) A slot is required.
        if not (slot or "").strip():
            return "Ask the patient which appointment slot they'd like before booking."

        # 3) Resolve the patient's name: prefer the form, else it must appear in the
        #    conversation. Never accept an invented name.
        name = (req.patient_name or "").strip()
        if not name or name.lower() == "guest":
            cand = (patient_name or "").strip()
            if cand and cand.lower() in user_text:
                name = cand
            else:
                return ("I don't have the patient's real name yet. Ask the patient "
                        "for their name — do NOT invent one like 'John Doe'.")

        if not (doctor_name or "").strip():
            return "Ask the patient which doctor they'd like to book with."

        from app.database import SessionLocal
        from app.models import Doctor, Patient, Appointment
        db = SessionLocal()
        try:
            matches = db.query(Doctor).filter(Doctor.name.ilike(f"%{doctor_name.strip()}%")).all()
            if not matches:
                return f"No doctor matching '{doctor_name}' found. Ask the patient to confirm the name."
            if len(matches) > 1:
                names = "; ".join(d.name for d in matches)
                return f"Multiple doctors match '{doctor_name}': {names}. Ask which one."
            doctor = matches[0]

            # 4) The slot must be one of the doctor's real openings.
            avail = [s.strip() for s in (doctor.available_slots or "").split(",") if s.strip()]
            if avail and slot.strip().lower() not in [s.lower() for s in avail]:
                return (f"'{slot}' is not one of {doctor.name}'s open slots. Available: "
                        f"{', '.join(avail)}. Ask the patient to pick one of these.")

            try:
                age_val = int(age) if str(age).strip() else None
            except (TypeError, ValueError):
                age_val = None

            patient = Patient(
                name=name,
                age=age_val,
                gender=(gender or None),
                phone=(phone or None),
            )
            db.add(patient)
            db.flush()
            appt = Appointment(
                patient_id=patient.id,
                doctor_id=doctor.id,
                slot=slot.strip(),
                status="booked",
            )
            db.add(appt)
            db.commit()
            db.refresh(appt)

            agent_state["booking"] = {
                "id": appt.id,
                "doctor_name": doctor.name,
                "patient_name": patient.name,
                "slot": appt.slot,
                "status": appt.status,
            }
            return (
                f"Appointment booked: {patient.name} with {doctor.name} at "
                f"{appt.slot} (status: {appt.status}). Confirm this warmly to the patient."
            )
        except Exception as be:
            db.rollback()
            return f"Booking failed: {be}. Apologise and suggest trying again."
        finally:
            db.close()

    tools = [
        analyze_lab_report, build_treatment_plan, get_patient_labs,
        recommend_specialist, suggest_doctors, get_doctor_availability,
        book_appointment,
    ]
    tool_map = {t.name: t for t in tools}
    llm_with_tools = llm.bind_tools(tools)

    # Build the human turn. If OCR text arrived, wrap it so the agent reliably
    # recognises it and calls analyze_lab_report.
    user_input = req.message or ""
    if req.ocr_text:
        wrapped = (
            "[LAB REPORT TEXT]\n" + req.ocr_text.strip() + "\n[END LAB REPORT TEXT]"
        )
        user_input = (
            f"{user_input}\n\n{wrapped}\n\nPlease analyze this lab report."
            if user_input else
            f"{wrapped}\n\nPlease analyze this lab report."
        )

    def _flatten(content) -> str:
        if isinstance(content, list):  # some models return content blocks
            return " ".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            ).strip()
        return content or ""

    # Manual tool-calling loop (works without langchain.agents).
    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    messages += _to_lc_messages(req.chat_history)
    messages.append(HumanMessage(content=user_input))

    reply = ""
    try:
        ai = None
        for _ in range(5):  # max tool-calling iterations
            ai = llm_with_tools.invoke(messages)
            messages.append(ai)
            tool_calls = getattr(ai, "tool_calls", None) or []
            if not tool_calls:
                reply = _flatten(ai.content)
                break
            for tc in tool_calls:
                fn = tool_map.get(tc.get("name"))
                try:
                    result = fn.invoke(tc.get("args", {})) if fn else f"Unknown tool: {tc.get('name')}"
                except Exception as te:
                    result = f"Tool error: {te}"
                messages.append(ToolMessage(
                    content=str(result), tool_call_id=tc.get("id", ""),
                ))
        else:
            # Ran out of iterations — fall back to the last model text.
            reply = _flatten(ai.content) if ai is not None else ""

        return AgentResult(
            possible_issue=agent_state["possible_issue"],
            specialization=agent_state["specialization"],
            reply=reply or "I'm here to help — could you tell me a bit more about how you're feeling?",
            diagnosis=agent_state["diagnosis"],
            treatment=agent_state["treatment"],
            show_doctors=agent_state["show_doctors"],
            doctor_specialization=agent_state["doctor_spec"],
            booking=agent_state["booking"],
        )
    except Exception as e:
        print(f"Error in ACDSS agent: {e}")
        return AgentResult(
            possible_issue="General health concern",
            specialization="",
            reply="Sorry, I ran into a problem processing that. Could you rephrase your question?",
            diagnosis=agent_state["diagnosis"],
            treatment=agent_state["treatment"],
            show_doctors=agent_state["show_doctors"],
            doctor_specialization=agent_state["doctor_spec"],
            booking=agent_state["booking"],
        )
