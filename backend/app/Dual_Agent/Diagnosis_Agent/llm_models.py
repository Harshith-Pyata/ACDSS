"""
llm_models.py
=============
LLM, Embeddings, ChromaDB, and Retriever setup for the Diagnosis Agent.
Loaded once at import time; all other Diagnosis Agent modules import from here.
"""

import os
from langchain_groq import ChatGroq
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from dotenv import load_dotenv

load_dotenv()

# ── Groq LLM ─────────────────────────────────────────────────────────────────
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0,
    max_tokens=900,
    timeout=None,
    max_retries=2,
)

# ── ChromaDB (Diagnosis knowledge base) ──────────────────────────────────────
_CHROMA_PATH = os.getenv(
    "CHROMA_DIAGNOSIS_DB_PATH",
    r"C:\Users\harsh\Desktop\Python\Projects\acdss_fullstack\backend\app\Diagnosis_db\chroma_db",
)

print(f"[DiagnosisAgent] Connecting to Diagnosis knowledge base at: {_CHROMA_PATH}")

embeddings  = GoogleGenerativeAIEmbeddings(model="gemini-embedding-2-preview")
vectorstore = Chroma(
    persist_directory=_CHROMA_PATH,
    embedding_function=embeddings,
    collection_name="Diagnosis_guidelines",
)
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})