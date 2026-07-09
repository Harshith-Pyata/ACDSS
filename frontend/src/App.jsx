import React, { useState, useRef, useEffect } from 'react';
import { Send, Stethoscope, CalendarCheck, Plus, Paperclip, X } from 'lucide-react';
import { TypewriterBubble } from './components/TypewriterBubble';
import { DoctorCard } from './components/DoctorCard';
import { UploadZone } from './components/UploadZone';
import { DiagnosisBubble } from './components/DiagnosisBubble';
import { TreatmentBubble } from './components/TreatmentBubble';
import { LocationPanel } from './components/LocationPanel';
import { BookingBubble } from './components/BookingBubble';
import { MsgRow } from './components/MsgRow';
import './style.css';

const API = import.meta.env.VITE_API_URL;

/* ════════════════════════════════════════════════════════════════════════════
   APP
   ════════════════════════════════════════════════════════════════════════════ */
export default function App() {
  /* ── state ─────────────────────────────────────────────────────────────── */
  const [phase, setPhase]           = useState('idle');
  // 'idle' | 'uploading' | 'diagnosed' | 'awaiting_treatment' | 'treating'
  // | 'treatment_done' | 'locating' | 'doctors' | 'done'

  const [messages, setMessages]     = useState([{
    role:'assistant', type:'text',
    text:"Hello! I'm ACDSS — your AI-powered clinical assistant.\n\nUpload an image of your lab report and I'll walk you through the diagnosis step by step.",
    instant: true,
  }]);

  const [diagnosisData, setDiagData] = useState(null);  // stored for treatment call
  const [treatmentData, setTreatData]= useState(null);
  const [doctors, setDoctors]        = useState([]);
  const [patient, setPatient]        = useState({ name:'', age:'', gender:'', phone:'' });
  const [input, setInput]            = useState('');

  const [uploadLoading, setUpload]   = useState(false);
  const [treatLoading, setTreat]     = useState(false);
  const [docLoading, setDocLoad]     = useState(false);
  const [chatLoading, setChatLoad]   = useState(false);
  const [backendOk, setBackendOk]    = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef    = useRef(null);
  const composerFileRef = useRef(null);   // paperclip image upload in the composer
  const [pendingImage, setPendingImage] = useState(null);  // staged {file, preview} until Send

  /* ── scroll ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [messages, phase, doctors]);

  /* ── auto-resize textarea ───────────────────────────────────────────────── */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [input]);

  /* ── health check ───────────────────────────────────────────────────────── */
  useEffect(() => {
    fetch(`${API}/`).then(r => setBackendOk(r.ok)).catch(() => setBackendOk(false));
  }, []);

  /* ── helpers ────────────────────────────────────────────────────────────── */
  function addMsg(msg) { setMessages(prev => [...prev, msg]); }

  /* ════════════════════════════════════════════════════════════════════════
     STEP 1 — Upload → Diagnosis only
     ════════════════════════════════════════════════════════════════════════ */
  async function handleAnalyze(file, notes, previewSrc = null) {
    setUpload(true);

    // Show the uploaded image inline in the chat (ChatGPT-style).
    const showImage = (src) => addMsg({
      role:'user', type:'image', src, name:file.name, notes, instant:true,
    });
    if (previewSrc) {
      showImage(previewSrc);
    } else {
      const reader = new FileReader();
      reader.onload = e => showImage(e.target.result);
      reader.readAsDataURL(file);
    }
    addMsg({ role:'assistant', type:'text', text:'Analysing your lab report… this may take a moment.', instant:false });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('doctor_notes', notes || '');
    formData.append('patient_name', patient.name || 'Guest');

    try {
      const res = await fetch(`${API}/diagnose`, { method:'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setDiagData(data);
      setPhase('diagnosed');
      setBackendOk(true);

      // Show diagnosis bubble
      addMsg({ role:'assistant', type:'diagnosis', data });

      // After a short pause, add a follow-up prompt
      setTimeout(() => {
        addMsg({
          role:'assistant', type:'text',
          text:"I've completed the diagnosis above. Would you like me to build a personalised treatment plan? If so, describe any symptoms you're currently experiencing — or just say \"yes, show treatment\".",
          instant: false,
        });
      }, 800);

    } catch (err) {
      addMsg({ role:'assistant', type:'text', text:`Analysis failed: ${err.message}`, instant:true });
      setPhase('idle');
      setBackendOk(false);
    }
    setUpload(false);
  }

  /* ════════════════════════════════════════════════════════════════════════
     STEP 2 — Treatment (triggered from chat or button)
     ════════════════════════════════════════════════════════════════════════ */
  async function requestTreatment(symptoms = '') {
    if (!diagnosisData) return;
    setTreat(true);
    setPhase('treating');

    if (symptoms) {
      addMsg({ role:'user', type:'text', text: symptoms, instant:true });
    }
    addMsg({ role:'assistant', type:'text', text:'Generating your personalised treatment plan…', instant:false });

    try {
      const res = await fetch(`${API}/treatment`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          primary_hypothesis:   diagnosisData.primary_hypothesis,
          extracted_lab_values: diagnosisData.extracted_lab_values,
          detailed_analysis:    diagnosisData.detailed_analysis,
          patient_symptoms:     symptoms,
          patient_name:         patient.name || 'Guest',
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setTreatData(data);
      setPhase('treatment_done');

      // Show treatment bubble with the discovered problem for the summary
      addMsg({
        role:'assistant', type:'treatment', data,
        problem: {
          hypothesis: diagnosisData?.primary_hypothesis,
          findings:   diagnosisData?.key_abnormalities,
          plain:      diagnosisData?.simple_explanation,
        },
      });

    } catch (err) {
      const network = err?.name === 'TypeError' || /failed to fetch/i.test(err?.message || '');
      addMsg({
        role:'assistant', type:'text',
        text: network
          ? "I couldn't reach the server to build your treatment plan — the backend may have restarted or stopped. Make sure it's running on port 8000, then click \"Get Treatment Plan\" again to retry (your diagnosis is still saved)."
          : `Treatment planning couldn't be completed (${err.message}). Please click "Get Treatment Plan" to try again.`,
        instant:true,
      });
      setPhase('diagnosed');   // keep the diagnosis so the user can retry
    }
    setTreat(false);
  }

  /* ════════════════════════════════════════════════════════════════════════
     STEP 3 — Fetch doctors
     ════════════════════════════════════════════════════════════════════════ */
  async function fetchDoctors(city) {
    setDocLoad(true);
    const spec = diagnosisData?.recommended_specialization || 'General Physician';
    addMsg({ role:'user', type:'text', text:`Looking for ${spec} in ${city}…`, instant:true });

    try {
      const res = await fetch(`${API}/doctors?specialization=${encodeURIComponent(spec)}&location=${encodeURIComponent(city)}`);
      const data = await res.json();
      if (!data.length) {
        const fb = await fetch(`${API}/doctors?specialization=${encodeURIComponent(spec)}`);
        const fbData = await fb.json();
        setDoctors(fbData);
        addMsg({ role:'assistant', type:'text', text:`Couldn't find ${spec}s in "${city}", showing nearest available. Select a slot to book.`, instant:false });
      } else {
        setDoctors(data);
        addMsg({ role:'assistant', type:'text', text:`Found ${data.length} ${spec}(s) in ${city}. Select a time slot to book your appointment.`, instant:false });
      }
      setPhase('doctors');
    } catch {
      addMsg({ role:'assistant', type:'text', text:'Could not fetch doctors. Please try again.', instant:true });
    }
    setDocLoad(false);
  }

  /* ── Book appointment ─────────────────────────────────────────────────── */
  async function bookAppointment(doctor, slot) {
    try {
      const res = await fetch(`${API}/appointments`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          patient_name: patient.name || 'Guest',
          age:    Number(patient.age) || null,
          gender: patient.gender || null,
          phone:  patient.phone  || null,
          doctor_id: doctor.id, slot,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      addMsg({ role:'assistant', type:'booking', data, instant:true });
      setDoctors([]);
      setPhase('done');
    } catch {
      addMsg({ role:'assistant', type:'text', text:'Booking failed. Please try again.', instant:true });
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     Smart chat — detects intent for treatment or general conversation
     ════════════════════════════════════════════════════════════════════════ */
  async function sendChat() {
    const text = input.trim();
    if (chatLoading || uploadLoading || treatLoading) return;

    // A staged image takes priority: analyse it on Send (with any typed note).
    if (pendingImage) {
      const img = pendingImage;
      setPendingImage(null);
      setInput('');
      await handleAnalyze(img.file, text, img.preview);
      return;
    }

    if (!text) return;
    setInput('');

    // If diagnosis is done and user is asking about treatment
    if (phase === 'diagnosed' || phase === 'treatment_done') {
      const lower = text.toLowerCase();
      const treatmentKeywords = [
        'treatment','treat','medicine','medication','drug','therapy',
        'plan','suggest','recommend','yes','show','what should i',
        'how to','cure','manage','help me','what can i do',
      ];
      const wantsTreatment = treatmentKeywords.some(k => lower.includes(k));

      if (wantsTreatment && phase === 'diagnosed') {
        requestTreatment(text);
        return;
      }
    }

    // General conversation via /chat endpoint
    setChatLoad(true);
    addMsg({ role:'user', type:'text', text, instant:true });

    // Build chat history excluding the new message and system welcome
    const history = messages
      .filter(m => m.type === 'text' && !m.instant && m.text !== "Hello! I'm ACDSS — your AI-powered clinical assistant.\n\nUpload an image of your lab report and I'll walk you through the diagnosis step by step.")
      .map(m => ({ role: m.role, content: m.text }));

    try {
      const res = await fetch(`${API}/chat`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          message: text,
          chat_history: history.slice(-6), // Send last 6 messages for context
          // Round-trip the dual-agent state so the agent can summarise it accurately
          primary_hypothesis: diagnosisData?.primary_hypothesis || null,
          extracted_lab_values: diagnosisData?.extracted_lab_values || null,
          detailed_analysis: diagnosisData?.detailed_analysis || null,
          diagnosis: diagnosisData || null,
          treatment: treatmentData || null,
          patient_name: patient.name || 'Guest',
          age:    Number(patient.age) || null,
          gender: patient.gender || null,
          phone:  patient.phone  || null,
        }),
      });
      const data = await res.json();

      // Build reply — only mention specialist if one was actually found
      let reply = data.reply;
      if (data.possible_issue && data.possible_issue !== 'General health concern') {
        reply += `\n\nPossible concern: ${data.possible_issue}`;
      }
      if (data.recommended_specialization && data.recommended_specialization !== '') {
        reply += `\nRecommended specialist: ${data.recommended_specialization}`;
      }

      addMsg({ role:'assistant', type:'text', text: reply, instant:false });

      // Show a diagnosis card ONLY the first time (no duplicates on later chats)
      if (data.diagnosis && !diagnosisData) {
        setDiagData(prev => ({ ...(prev || {}), ...data.diagnosis }));
        addMsg({ role:'assistant', type:'diagnosis', data: data.diagnosis });
        setPhase('diagnosed');
      }

      // Show a treatment card ONLY the first time (no duplicates on later chats)
      if (data.treatment && !treatmentData) {
        const dx = data.diagnosis || diagnosisData;
        setTreatData(data.treatment);
        addMsg({
          role:'assistant', type:'treatment', data: data.treatment,
          problem: {
            hypothesis: dx?.primary_hypothesis,
            findings:   dx?.key_abnormalities,
            plain:      dx?.simple_explanation,
          },
        });
        setPhase('treatment_done');
      }

      // If the agent booked an appointment, render the confirmation bubble
      if (data.booking) {
        addMsg({ role:'assistant', type:'booking', data: data.booking, instant:true });
        setDoctors([]);
        setPhase('done');
      }

      // Only show doctors if the agent agreed to suggest them (ask-first flow)
      else if (data.doctors?.length > 0 && data.ask_booking) {
        setDoctors(data.doctors);
        setPhase('doctors');
      }
    } catch {
      addMsg({ role:'assistant', type:'text',
        text:'Backend not reachable. Please start the FastAPI server on port 8000.', instant:true });
    }
    setChatLoad(false);
  }

  /* ── New session ──────────────────────────────────────────────────────── */
  function newSession() {
    setMessages([{ role:'assistant', type:'text',
      text:'New session started. Upload a lab report or describe your symptoms.', instant:true }]);
    setDiagData(null); setTreatData(null); setDoctors([]);
    setInput(''); setPhase('idle');
  }

  /* ── Phase steps ──────────────────────────────────────────────────────── */
  const STEPS = [
    { key:'idle',            label:'Upload Report' },
    { key:'diagnosed',       label:'AI Diagnosis'  },
    { key:'treatment_done',  label:'Treatment Plan' },
    { key:'done',            label:'Appointment'    },
  ];
  const phaseOrder = ['idle','uploading','diagnosed','awaiting_treatment',
                      'treating','treatment_done','locating','doctors','done'];
  const currentIdx = phaseOrder.indexOf(phase);

  const isLoading = uploadLoading || treatLoading || docLoading || chatLoading;

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="app">
      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon"><Stethoscope size={20} color="white" /></div>
          <div className="brand-text">
            <h2>ACDSS</h2>
            <span>Clinical AI System</span>
          </div>
        </div>

        <button id="new-chat-btn" className="new-chat-btn" onClick={newSession}>
          <Plus size={14} /> New Session
        </button>

        {/* Step progress */}
        <div className="phase-stepper">
          {STEPS.map((s, i) => {
            let active = false;
            let done = false;

            if (i === 0) { // Upload Report
              if (currentIdx === 0) active = true;
              else done = true;
            } else if (i === 1) { // AI Diagnosis
              if (currentIdx === 1) active = true;
              else if (currentIdx > 1) done = true;
            } else if (i === 2) { // Treatment Plan
              if (currentIdx === 4) active = true;
              else if (currentIdx > 4) done = true;
            } else if (i === 3) { // Appointment
              if (currentIdx === 6 || currentIdx === 7) active = true;
              else if (currentIdx >= 8) done = true;
            }

            return (
              <div key={s.key} className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                <div className="step-dot">{done ? '✓' : i + 1}</div>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Patient info */}
        <div className="patient-section">
          <div className="section-label">Patient Info</div>
          <div className="patient-form">
            <div className="form-field">
              <label htmlFor="pat-name">Full Name</label>
              <input id="pat-name" placeholder="e.g. John Doe"
                value={patient.name} onChange={e => setPatient(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="form-field">
              <label htmlFor="pat-age">Age</label>
              <input id="pat-age" type="number" placeholder="Years"
                value={patient.age} onChange={e => setPatient(p => ({ ...p, age: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>Gender</label>
              <div className="gender-row">
                {['Male','Female','Other'].map(g => (
                  <button key={g} id={`gender-${g.toLowerCase()}`}
                    className={`gender-chip${patient.gender === g ? ' active' : ''}`}
                    onClick={() => setPatient(p => ({ ...p, gender: g }))}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="pat-phone">Phone</label>
              <input id="pat-phone" placeholder="+91 XXXXX XXXXX"
                value={patient.phone} onChange={e => setPatient(p => ({ ...p, phone: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="status-badge" style={backendOk === false
          ? { background:'rgba(239,68,68,0.08)', borderColor:'rgba(239,68,68,0.2)', color:'var(--danger)' } : {}}>
          <div className="status-dot" style={backendOk === false ? { background:'var(--danger)' } : {}} />
          {backendOk === null ? 'Connecting…' : backendOk ? 'Backend Connected' : 'Backend Offline'}
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────────────────── */}
      <main className="chat-area">
        {/* Header */}
        <header className="chat-header">
          <div className="header-text">
            <h1>Autonomous Clinical Decision Support</h1>
            <p>Step 1: Diagnosis → Step 2: Treatment Plan → Step 3: Book Specialist</p>
          </div>
          <div className="header-tags">
            <span className="tag">🧬 RAG Diagnosis</span>
            <span className="tag">⚖ Evaluator Nodes</span>
            <span className="tag">💊 Treatment Plan</span>
            <span className="tag">📅 Booking</span>
          </div>
        </header>

        {/* ── Messages feed ─────────────────────────────────────────────── */}
        <section className="messages" id="message-feed">
          {messages.map((m, i) => {
            if (m.role === 'user' && m.type === 'image') return (
              <MsgRow key={i} role="user">
                <div className="msg-bubble user image">
                  <img src={m.src} alt={m.name || 'upload'} className="chat-image" />
                  {m.notes ? <div className="chat-image-note">{m.notes}</div> : null}
                </div>
              </MsgRow>
            );

            if (m.role === 'user') return (
              <MsgRow key={i} role="user">
                <div className="msg-bubble user">{m.text}</div>
              </MsgRow>
            );

            if (m.type === 'diagnosis') return (
              <MsgRow key={i} role="assistant">
                <DiagnosisBubble
                  data={m.data}
                  onWantTreatment={() => requestTreatment('')}
                  onWantDoctors={() => setPhase('locating')}
                />
              </MsgRow>
            );

            if (m.type === 'treatment') return (
              <MsgRow key={i} role="assistant">
                <TreatmentBubble data={m.data} problem={m.problem} />
              </MsgRow>
            );

            if (m.type === 'booking') return (
              <MsgRow key={i} role="assistant">
                <BookingBubble data={m.data} />
              </MsgRow>
            );

            // Plain text — typewriter unless instant
            return (
              <MsgRow key={i} role="assistant">
                {m.instant
                  ? <div className="msg-bubble assistant">{m.text}</div>
                  : <TypewriterBubble text={m.text} />
                }
              </MsgRow>
            );
          })}

          {/* Thinking dots */}
          {isLoading && (
            <MsgRow role="assistant">
              <div className="thinking">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
            </MsgRow>
          )}

          <div ref={messagesEndRef} />
        </section>

        {/* Upload now lives as a paperclip in the composer (ChatGPT-style). */}

        {/* ── Location panel ────────────────────────────────────────────── */}
        {phase === 'locating' && (
          <section className="action-panel">
            <LocationPanel onConfirm={fetchDoctors} loading={docLoading} />
          </section>
        )}

        {/* ── Doctor grid ───────────────────────────────────────────────── */}
        {doctors.length > 0 && (
          <section className="doctor-panel">
            <div className="doctor-panel-header">
              <CalendarCheck size={15} color="var(--text-secondary)" />
              <h2>Recommended Specialists</h2>
              <span className="count-badge">{doctors.length}</span>
            </div>
            <div className="doctor-grid">
              {doctors.map(d => <DoctorCard key={d.id} doctor={d} onBook={bookAppointment} />)}
            </div>
          </section>
        )}

        {/* ── Composer (always visible) ──────────────────────────────────── */}
        <footer className="composer">
          {/* Staged image preview — appears after picking, sent only on Send */}
          {pendingImage && (
            <div className="pending-attach">
              <img src={pendingImage.preview} alt="attachment" className="pending-thumb" />
              <span className="pending-name">{pendingImage.file.name}</span>
              <span className="pending-hint">Press Send to analyse</span>
              <button className="pending-remove" title="Remove"
                onClick={() => setPendingImage(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          <div className="composer-inner">
            {/* Hidden file input driven by the paperclip button */}
            <input
              ref={composerFileRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg,image/bmp,image/tiff"
              style={{ display:'none' }}
              onChange={e => {
                const f = e.target.files[0];
                e.target.value = '';            // allow re-uploading the same file
                if (!f) return;
                const reader = new FileReader();
                reader.onload = ev => setPendingImage({ file: f, preview: ev.target.result });
                reader.readAsDataURL(f);
              }}
            />
            <button
              type="button"
              className="attach-btn"
              title="Attach a lab report image"
              disabled={uploadLoading}
              onClick={() => composerFileRef.current?.click()}
            >
              <Paperclip size={18} />
            </button>

            <textarea ref={textareaRef} id="symptom-input" rows={1}
              placeholder={
                pendingImage
                  ? 'Add a note (optional) and press Send to analyse…'
                  : phase === 'diagnosed'
                  ? 'Describe your symptoms or say "yes, show treatment plan"…'
                  : phase === 'treatment_done'
                  ? 'Ask a follow-up question or find a specialist…'
                  : 'Attach a report 📎 or type symptoms / questions here…'
              }
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            />
            <button id="send-btn" className="send-btn"
              onClick={sendChat}
              disabled={(!input.trim() && !pendingImage) || isLoading}>
              <Send size={16} />
            </button>
          </div>
          <p className="composer-hint">
            {phase === 'idle'
              ? 'Upload a report above for full AI analysis · or type symptoms for quick triage'
              : phase === 'diagnosed'
              ? 'Ask for treatment plan or describe your symptoms for personalised advice'
              : 'Ask follow-up questions or use buttons above to book a specialist'
            }
          </p>
        </footer>
      </main>
    </div>
  );
}
