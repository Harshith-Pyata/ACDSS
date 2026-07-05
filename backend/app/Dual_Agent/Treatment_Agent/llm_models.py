
import os
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

_CHROMA_PATH = os.getenv(
    "CHROMA_TREATMENT_DB_PATH",
    r"C:\Users\harsh\Desktop\Python\Projects\acdss_fullstack\backend\app\Treatment_db\chroma_db",
)

print(f"[TreatmentAgent] Connecting to Treatment knowledge base at: {_CHROMA_PATH}")

embeddings  = GoogleGenerativeAIEmbeddings(model="gemini-embedding-2-preview")
vectorstore = Chroma(
    persist_directory=_CHROMA_PATH,
    embedding_function=embeddings,
    collection_name="Treatment_guidelines",
)
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})
