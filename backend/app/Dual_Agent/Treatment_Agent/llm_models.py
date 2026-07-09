
import os
from pathlib import Path
from langchain_groq import ChatGroq
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from dotenv import load_dotenv

load_dotenv()

llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0,
    max_tokens=900,
    max_retries=2,
)

# Resolve relative to this file so it works on both Windows (local) and Linux (Render)
_DEFAULT_CHROMA_PATH = str(Path(__file__).resolve().parent.parent / "Treatment_db" / "chroma_db")
_CHROMA_PATH = os.getenv("CHROMA_TREATMENT_DB_PATH", _DEFAULT_CHROMA_PATH)

print(f"[TreatmentAgent] Connecting to Treatment knowledge base at: {_CHROMA_PATH}")

embeddings  = GoogleGenerativeAIEmbeddings(model="gemini-embedding-2-preview")
vectorstore = Chroma(
    persist_directory=_CHROMA_PATH,
    embedding_function=embeddings,
    collection_name="Treatment_guidelines",
)
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})
