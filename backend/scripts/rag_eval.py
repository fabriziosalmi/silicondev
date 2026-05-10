import sys
import os
import tempfile
import time
from pathlib import Path

# Ensure backend module can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.rag.service import RagService

# Synthetic Evaluation Dataset
DOCUMENTS = {
    "doc1.md": "The SiliconDev project aims to provide local-first, offline-first LLM capabilities. It relies heavily on MLX for native Apple Silicon acceleration, avoiding external opaque frameworks.",
    "doc2.md": "Deployment of the Native API Runtime involves replacing the mlx_lm.server subprocess with a native FastAPI implementation that directly accesses the MLXEngineService.",
    "doc3.md": "Agent Workflows in Silicon-Studio use a DAG execution engine. Nodes represent steps like tool execution or LLM inference, and edges define the topological order, including conditional routing.",
    "doc4.md": "RAG completion requires a robust retrieval quality setup. It combines BM25 for keyword search and HNSW-accelerated vector search using either MLX embeddings or ONNX fallback for reciprocal rank fusion.",
    "doc5.md": "The codebase UI allows semantic search and indexing. When a user requests to search the codebase, it converts code files into vector embeddings using the Nomic v1.5 model."
}

EVAL_QUERIES = [
    {"query": "What is the primary goal of SiliconDev?", "expected_file": "doc1.md"},
    {"query": "How does the native API runtime avoid mlx_lm.server?", "expected_file": "doc2.md"},
    {"query": "What defines the order of execution in agent workflows?", "expected_file": "doc3.md"},
    {"query": "Which embedding model is used for the ONNX fallback in RAG?", "expected_file": "doc4.md"},
    {"query": "Which model is used to convert code files to vector embeddings?", "expected_file": "doc5.md"},
    {"query": "BM25 keyword search", "expected_file": "doc4.md"},
    {"query": "DAG execution engine condition node", "expected_file": "doc3.md"},
]

def run_eval():
    print("=== SiliconDev RAG Quality Evaluation ===")
    service = RagService()
    
    # 1. Setup Eval Collection
    col_name = f"eval_collection_{int(time.time())}"
    col = service.create_collection(col_name)
    col_id = col["id"]
    print(f"[*] Created evaluation collection: {col_name} ({col_id})")
    
    # 2. Write synthetic docs to disk
    with tempfile.TemporaryDirectory() as tmpdir:
        files_to_ingest = []
        for filename, content in DOCUMENTS.items():
            path = os.path.join(tmpdir, filename)
            with open(path, "w") as f:
                f.write(content)
            files_to_ingest.append(path)
            
        print("[*] Ingesting evaluation documents...")
        start_ingest = time.time()
        service.ingest_files(col_id, files_to_ingest, chunk_size=512, overlap=50)
        print(f"[*] Ingestion complete in {time.time() - start_ingest:.2f}s")
        
        # 3. Run evaluation queries
        print("\n[*] Running Evaluation Queries...")
        
        # To test the impact of RRF/Hybrid vs Pure Vector or Pure BM25, 
        # we will test the standard hybrid path.
        
        hits = 0
        mrr_sum = 0.0
        
        for q in EVAL_QUERIES:
            query_text = q["query"]
            expected = q["expected_file"]
            expected_content = DOCUMENTS[expected]
            
            # Request top 3
            results = service.query(col_id, query_text, n_results=3)
            
            rank = 0
            for i, res in enumerate(results):
                # Our simple chunks match the exact document content
                if expected_content in res["text"] or res["text"] in expected_content:
                    rank = i + 1
                    break
            
            if rank > 0:
                hits += 1
                mrr_sum += 1.0 / rank
                print(f"  [+] '{query_text}' -> HIT at rank {rank} (Score: {results[rank-1].get('score', 0):.4f})")
            else:
                print(f"  [-] '{query_text}' -> MISS (Expected {expected} not in top 3)")
                
        total = len(EVAL_QUERIES)
        mrr = mrr_sum / total
        hit_rate = hits / total
        
        print("\n=== Evaluation Results ===")
        print(f"Total Queries: {total}")
        print(f"Hit Rate (@3): {hit_rate:.2%} ({hits}/{total})")
        print(f"MRR (@3):      {mrr:.4f}")
        
        # Determine success
        if mrr > 0.8:
            print("Status: PASSED (MRR > 0.8 baseline)")
        else:
            print("Status: FAILED (MRR below 0.8 baseline)")
            
    # Cleanup
    service.delete_collection(col_id)
    print(f"[*] Cleaned up evaluation collection {col_id}")

if __name__ == "__main__":
    run_eval()
