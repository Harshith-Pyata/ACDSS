import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Send, Stethoscope, CalendarCheck, UserRound, Plus,
  Clock, MapPin, AlertTriangle, Activity, Upload,
  FileText, CheckCircle, ChevronRight, Zap, Heart,
  Brain, Eye, Bone, Smile, Navigation, RefreshCw, X,
  Sparkles, Shield, TrendingUp, Info, ChevronDown, Paperclip,
} from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/* ══════════════════════════════════════════════════════════════════════════
   TYPEWRITER HOOK
   Streams text word-by-word with a realistic variable speed.
   ══════════════════════════════════════════════════════════════════════════ */
function useTypewriter(text, { speed = 38, onDone } = {}) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone]           = useState(false);
  const rafRef                    = useRef(null);
  const indexRef                  = useRef(0);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    indexRef.current = 0;

    if (!text) { setDone(true); return; }

    const words = text.split(' ');

    function tick() {
      if (indexRef.current >= words.length) {
        setDone(true);
        onDone?.();
        return;
      }
      setDisplayed(words.slice(0, indexRef.current + 1).join(' '));
      indexRef.current += 1;
      // Slight jitter makes it feel natural
      const delay = speed + Math.random() * 18 - 9;
      rafRef.current = setTimeout(tick, delay);
    }

    rafRef.current = setTimeout(tick, speed);
    return () => clearTimeout(rafRef.current);
  }, [text]);          // intentionally omit speed/onDone to avoid re-runs

  return { displayed, done };
}

/* ══════════════════════════════════════════════════════════════════════════
   TypewriterBubble — assistant text bubble with live typing
   ══════════════════════════════════════════════════════════════════════════ */
function TypewriterBubble({ text, onDone, instant = false }) {
  const { displayed, done } = useTypewriter(instant ? '' : text, { onDone });
  const content = instant ? text : displayed;

  return (
    <div className="msg-bubble assistant">
      {content}
      {!done && !instant && <span className="typing-cursor">▋</span>}
    </div>
  );
}

/* ── Specialization icons ─────────────────────────────────────────────────── */
const SPEC_ICONS = {
  'Cardiologist':       <Heart size={16} />,
  'Neurologist':        <Brain size={16} />,
  'Ophthalmologist':    <Eye size={16} />,
  'Orthopedic':         <Bone size={16} />,
  'Dermatologist':      <Zap size={16} />,
  'Gastroenterologist': <Activity size={16} />,
  'Psychiatrist':       <Smile size={16} />,
  'Endocrinologist':    <Activity size={16} />,
  'Nephrologist':       <Activity size={16} />,
  'Pulmonologist':      <Activity size={16} />,
  'General Physician':  <Stethoscope size={16} />,
};

/* ── Status helpers ───────────────────────────────────────────────────────── */
function statusClass(s = '') {
  const v = s.toLowerCase();
  if (v === 'high')       return 'flag-high';
  if (v === 'low')        return 'flag-low';
  if (v === 'borderline') return 'flag-borderline';
  if (v === 'normal')     return 'flag-normal';
  return 'flag-unknown';
}
function statusEmoji(s = '') {
  const v = s.toLowerCase();
  if (v === 'high')       return '▲';
  if (v === 'low')        return '▼';
  if (v === 'borderline') return '◆';
  if (v === 'normal')     return '●';
  return '○';
}

/* ── Severity colours ─────────────────────────────────────────────────────── */
const SEVERITY_STYLE = {
  mild:     { color: '#86efac', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.22)'   },
  moderate: { color: '#fde047', bg: 'rgba(234,179,8,0.08)',   border: 'rgba(234,179,8,0.22)'   },
  severe:   { color: '#fca5a5', bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.30)'   },
  critical: { color: '#f87171', bg: 'rgba(239,68,68,0.16)',   border: 'rgba(239,68,68,0.45)'   },
};

/* ════════════════════════════════════════════════════════════════════════════
   DoctorCard
   ════════════════════════════════════════════════════════════════════════════ */
function DoctorCard({ doctor, onBook }) {
  return (
    <div className="doctor-card">
      <div className="doctor-card-top">
        <div className="doctor-avatar">
          {SPEC_ICONS[doctor.specialization] || <UserRound size={16} />}
        </div>
        <div className="doctor-info">
          <h3 title={doctor.name}>{doctor.name}</h3>
          <div className="doctor-meta">
            <span className="spec-tag">{doctor.specialization}</span>
            <span>{doctor.hospital}</span>
            <span style={{ display:'flex', alignItems:'center', gap:3 }}>
              <MapPin size={10} /> {doctor.location}
            </span>
          </div>
        </div>
      </div>
      <div className="doctor-stats">
        <span className="stat-pill rating">⭐ {doctor.rating}</span>
        <span className="stat-pill exp">{doctor.experience_years} yrs exp</span>
      </div>
      <div className="slots-label">Available Slots</div>
      <div className="slots">
        {doctor.available_slots.length > 0
          ? doctor.available_slots.map(slot => (
            <button key={slot} className="slot-btn" onClick={() => onBook(doctor, slot)}>
              <Clock size={10} style={{ marginRight:2 }} />{slot}
            </button>
          ))
          : <span style={{ fontSize:11, color:'var(--text-muted)' }}>No slots</span>
        }
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   UploadZone
   ════════════════════════════════════════════════════════════════════════════ */
function UploadZone({ onAnalyze, loading }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [notes, setNotes]       = useState('');
  const fileInputRef            = useRef(null);

  function handleFile(f) {
    if (!f) return;
    const allowed = ['image/jpeg','image/png','image/jpg','image/bmp','image/tiff'];
    if (!allowed.includes(f.type)) {
      alert('Please upload a JPG or PNG image of your lab report.');
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }

  return (
    <div className="upload-zone-wrapper">
      <div
        className={`upload-zone${dragOver ? ' drag-over' : ''}${file ? ' has-file' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => !file && fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/jpg,image/bmp"
          style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />

        {!file ? (
          <div className="upload-prompt">
            <div className="upload-icon-ring">
              <Upload size={26} color="var(--text-secondary)" />
            </div>
            <p className="upload-title">Upload your Lab Report</p>
            <p className="upload-sub">Drag & drop or <span className="upload-link">browse files</span></p>
            <p className="upload-hint">JPG · PNG · Max 10 MB</p>
          </div>
        ) : (
          <div className="upload-preview">
            <img src={preview} alt="Report preview" className="report-thumb" />
            <div className="file-info">
              <FileText size={14} color="var(--text-secondary)" />
              <span>{file.name}</span>
              <button className="remove-file"
                onClick={e => { e.stopPropagation(); setFile(null); setPreview(null); }}>
                <X size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      <textarea className="notes-input"
        placeholder="Optional: Add clinical context (e.g. 'Patient has diabetes history'…)"
        value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

      <button className="analyze-btn" disabled={!file || loading}
        onClick={() => onAnalyze(file, notes)}>
        {loading
          ? <><RefreshCw size={16} className="spin" /> Analysing…</>
          : <><Sparkles size={16} /> Run AI Diagnosis</>
        }
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   DiagnosisBubble — shows ONLY diagnosis (no treatment yet)
   ════════════════════════════════════════════════════════════════════════════ */
function DiagnosisBubble({ data, onWantTreatment, onWantDoctors }) {
  const [typingDone, setTypingDone] = useState(false);

  const conf    = data.confidence_score ?? 75;
  const confClr = conf >= 80 ? '#86efac' : conf >= 60 ? '#fde047' : '#fca5a5';

  return (
    <div className="analysis-bubble">
      {/* Header */}
      <div className="analysis-header">
        <div className="analysis-icon"><Activity size={17} color="white" /></div>
        <div style={{ flex:1 }}>
          <div className="analysis-title">Diagnosis Complete</div>
          <div className="analysis-hyp">{data.primary_hypothesis}</div>
        </div>
        {/* Confidence badge */}
        <div className="conf-badge" style={{ color: confClr, borderColor: confClr }}>
          {conf}% confidence
        </div>
      </div>

      {/* ── Diagnosis summary — what we found, in plain English ── */}
      {(data.primary_hypothesis || data.simple_explanation) && (
        <div className="plain-english-card">
          <div className="pe-label">
            <span className="pe-icon">📋</span> Diagnosis summary
          </div>
          <p className="pe-text">
            From your report, the most likely issue is{' '}
            <strong>{data.primary_hypothesis || 'a general health concern'}</strong>.
            {data.simple_explanation ? ' ' + data.simple_explanation : ''}
          </p>
        </div>
      )}

      {/* Evaluator key abnormalities */}
      {data.key_abnormalities?.length > 0 && (
        <div className="key-flags">
          <span className="kf-label">⚠ Key findings:</span>
          {data.key_abnormalities.map((k, i) => (
            <span key={i} className="kf-chip">{k}</span>
          ))}
        </div>
      )}

      {/* Lab table */}
      {data.detailed_analysis?.length > 0 && (
        <div className="lab-table-wrapper">
          <table className="lab-table">
            <thead>
              <tr><th>Test</th><th>Value</th><th>Reference</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.detailed_analysis.map((row, i) => (
                <tr key={i}>
                  <td className="test-name">{row.test_name}</td>
                  <td className="test-value">{row.patient_value}</td>
                  <td className="test-ref">{row.reference_range || '—'}</td>
                  <td>
                    <span className={`status-flag ${statusClass(row.status)}`}>
                      {statusEmoji(row.status)} {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Evaluator notes */}
      {data.evaluation_notes && (
        <div className="eval-notes">
          <Info size={12} style={{ flexShrink:0, marginTop:2 }} />
          <span>{data.evaluation_notes}</span>
        </div>
      )}

      {/* CTA row */}
      <div className="analysis-cta" style={{ flexWrap:'wrap', gap:8 }}>
        <span style={{ fontSize:13, color:'var(--text-secondary)' }}>
          Specialist: <strong style={{ color:'var(--text-primary)' }}>
            {data.recommended_specialization}
          </strong>
        </span>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="find-doctors-btn" onClick={onWantDoctors}>
            <MapPin size={14} /> Find Specialist
          </button>
          <button className="find-doctors-btn" style={{ background:'rgba(255,255,255,0.08)', color:'#e2e2e2', boxShadow:'none', border:'1px solid rgba(255,255,255,0.12)' }}
            onClick={onWantTreatment}>
            <CalendarCheck size={14} /> Get Treatment Plan
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   TreatmentBubble — shown after user asks for treatment
   ════════════════════════════════════════════════════════════════════════════ */
function TreatmentBubble({ data, problem, onDone }) {
  const [showSteps, setShowSteps] = useState(false);
  const sev   = (data.severity_level || 'moderate').toLowerCase();
  const style = SEVERITY_STYLE[sev] || SEVERITY_STYLE.moderate;
  const steps = data.treatment_plan || [];

  return (
    <div className="analysis-bubble" style={{ borderTop:`2px solid ${style.border}` }}>
      {/* Severity header */}
      <div className="analysis-header" style={{ background:`linear-gradient(135deg, ${style.bg}, transparent)` }}>
        <div className="analysis-icon" style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)' }}>
          <TrendingUp size={17} color={style.color} />
        </div>
        <div style={{ flex:1 }}>
          <div className="analysis-title">Treatment Plan</div>
          <div className="analysis-hyp">{data.disease_explanation}</div>
        </div>
        <div className="sev-badge" style={{ color: style.color, borderColor: style.border, background: style.bg }}>
          {sev.toUpperCase()}
        </div>
      </div>

      {/* ── Summary: what we discovered + how it's treated (always visible) ── */}
      <div className="tx-summary">
        <div className="txs-block">
          <div className="txs-label">🔍 What we found in your report</div>
          <p className="txs-text">
            {problem?.hypothesis ? <><strong>{problem.hypothesis}</strong>. </> : null}
            {data.disease_explanation || problem?.plain || 'See the diagnosis above for details.'}
          </p>
          {problem?.findings?.length > 0 && (
            <div className="txs-findings">Key findings: {problem.findings.join(', ')}</div>
          )}
        </div>

        <div className="txs-block">
          <div className="txs-label">💊 How it's treated</div>
          {steps.length > 0 ? (
            <ul className="txs-list">
              {steps.slice(0, 4).map((s, i) => (
                <li key={i}>
                  <strong>{s.medication_or_action}</strong>
                  {s.dosage_or_detail ? ` — ${s.dosage_or_detail}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="txs-text">A personalised plan is outlined below.</p>
          )}
          {data.prognosis && (
            <p className="txs-outlook">📈 Outlook: {data.prognosis}</p>
          )}
        </div>
      </div>

      {/* Treatment steps accordion (full detail with rationale) */}
      {data.treatment_plan?.length > 0 && (
        <div className="treatment-section">
          <button className="treatment-toggle" onClick={() => setShowSteps(v => !v)}>
            <CalendarCheck size={14} />
            Full treatment details with rationale ({data.treatment_plan.length} items)
            <ChevronDown size={14} className={`chevron ${showSteps ? 'open' : ''}`} />
          </button>
          {showSteps && (
            <div className="treatment-cards">
              {data.treatment_plan.map((step, i) => (
                <div className="treatment-card" key={i}>
                  <div className="tc-action">{step.medication_or_action}</div>
                  <div className="tc-detail">{step.dosage_or_detail}</div>
                  <div className="tc-rationale">{step.rationale}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prognosis + follow-up */}
      <div className="prognosis-row">
        {data.prognosis  && <div className="prog-chip prog-ok"><TrendingUp size={13} style={{ marginRight:6, display:'inline' }}/>{data.prognosis}</div>}
        {data.follow_up  && <div className="prog-chip prog-info">🗓 {data.follow_up}</div>}
      </div>

      {/* Meta Evaluation (Call 3 Auditor) */}
      {data.meta_evaluation && (
        <div className="meta-eval-section">
          <div className="me-header">
            <Shield size={14} /> AI Clinical Audit Report
          </div>
          <div className="me-grid">
            <div className="me-stat">
              <span className="me-label">Quality Score</span>
              <span className="me-val">{data.meta_evaluation.overall_quality_score}%</span>
            </div>
            <div className="me-stat">
              <span className="me-label">Safety</span>
              <span className={`me-val me-${data.meta_evaluation.safety_verdict.replace(/_/g, '-')}`}>
                {data.meta_evaluation.safety_verdict.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
          </div>
          {data.meta_evaluation.safety_flags?.length > 0 && (
            <div className="me-flags">
              <strong>⚠ Flags:</strong> {data.meta_evaluation.safety_flags.join(', ')}
            </div>
          )}
          <p className="me-summary"><strong>Summary:</strong> {data.meta_evaluation.clinical_summary}</p>
          <p className="me-recs"><strong>Recommendations:</strong> {data.meta_evaluation.pipeline_recommendations}</p>
        </div>
      )}

      {/* Evaluator follow-up question (calls onDone to add as next AI message) */}
      <div className="followup-cta" style={{ borderColor: style.border, background: style.bg }}>
        <span style={{ color: style.color, fontSize:13, fontWeight:600 }}>
          💬 {data.follow_up_question}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   LocationPanel
   ════════════════════════════════════════════════════════════════════════════ */
function LocationPanel({ onConfirm, loading }) {
  const [city, setCity]     = useState('');
  const [geoErr, setGeoErr] = useState('');
  const [geo, setGeo]       = useState(false);

  function detectGeo() {
    if (!navigator.geolocation) { setGeoErr('Geolocation not supported.'); return; }
    setGeo(true); setGeoErr('');
    navigator.geolocation.getCurrentPosition(
      () => { setGeo(false); setGeoErr('Auto-detected. Type your city name below.'); },
      () => { setGeo(false); setGeoErr('Access denied. Please type your city.'); },
      { timeout: 8000 },
    );
  }

  return (
    <div className="location-panel">
      <div className="loc-header">
        <MapPin size={16} color="var(--text-secondary)" />
        <span>Where should I find specialists?</span>
      </div>
      <div className="loc-row">
        <input className="loc-input"
          placeholder="Type your city (e.g. Hyderabad, Chennai…)"
          value={city} onChange={e => setCity(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && city.trim() && onConfirm(city.trim())} />
        <button className="loc-geo-btn" onClick={detectGeo} disabled={geo} title="Use my location">
          <Navigation size={15} />
        </button>
        <button className="loc-confirm-btn"
          disabled={!city.trim() || loading}
          onClick={() => onConfirm(city.trim())}>
          {loading ? <RefreshCw size={14} className="spin" /> : <ChevronRight size={14} />}
          Search
        </button>
      </div>
      {geoErr && <p className="loc-error">{geoErr}</p>}
      <p className="loc-hint">Available cities: Vijayawada · Hyderabad · Chennai · Bangalore</p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   BookingBubble
   ════════════════════════════════════════════════════════════════════════════ */
function BookingBubble({ data }) {
  return (
    <div className="booking-confirm">
      <CheckCircle size={20} color="var(--success)" style={{ flexShrink:0, marginTop:1 }} />
      <div>
        <div className="booking-title">Appointment Confirmed ✅</div>
        <div className="booking-detail">
          <span>Doctor: <strong>{data.doctor_name}</strong></span>
          <span>Patient: <strong>{data.patient_name}</strong></span>
          <span>Slot: <strong>{data.slot}</strong></span>
          <span>Status: <strong style={{ textTransform:'capitalize' }}>{data.status}</strong></span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Message row wrapper
   ════════════════════════════════════════════════════════════════════════════ */
function MsgRow({ role, children }) {
  return (
    <div className={`msg-wrapper ${role}`}>
      <div className={`msg-avatar ${role}`}>
        {role === 'assistant'
          ? <Stethoscope size={14} color="white" />
          : <UserRound size={15} />}
      </div>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   APP
   ════════════════════════════════════════════════════════════════════════════ */
function App() {
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
      addMsg({ role:'assistant', type:'text', text:`Treatment planning failed: ${err.message}`, instant:true });
      setPhase('diagnosed');
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
          // Round-trip the dual-agent state so the agent's tools can reuse it
          primary_hypothesis: diagnosisData?.primary_hypothesis || null,
          extracted_lab_values: diagnosisData?.extracted_lab_values || null,
          detailed_analysis: diagnosisData?.detailed_analysis || null,
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

      // If the agent ran its diagnosis tool, store + render the diagnosis card
      if (data.diagnosis) {
        setDiagData(prev => ({ ...(prev || {}), ...data.diagnosis }));
        addMsg({ role:'assistant', type:'diagnosis', data: data.diagnosis });
        setPhase('diagnosed');
      }

      // If the agent ran its treatment tool, store + render the treatment card
      if (data.treatment) {
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
            const stepIdx = phaseOrder.indexOf(s.key);
            const done    = currentIdx > stepIdx;
            const active  = !done && phaseOrder.indexOf(phase) >= stepIdx - 1
                            && phaseOrder.indexOf(phase) <= stepIdx + 1;
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

createRoot(document.getElementById('root')).render(<App />);
