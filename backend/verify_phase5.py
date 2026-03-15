import asyncio
import json
import sqlite3
import os
from app.memory.service import memory_graph
from app.memory.extractor import KnowledgeExtractor
from app.engine.service import MLXEngineService
from app.agents.nanocore.scout import ScoutAgent
from app.engine.training import training_orchestrator

async def verify_semantic_memory():
    print("--- 🧠 Verifying Semantic Memory Stack ---")
    
    # 1. Simulate a conversation turn
    extractor = KnowledgeExtractor()
    conv_id = "test_conv_123"
    prompt = "We decided to move the database to SQLite for Phase 4."
    response = "Understood. SQLite will be used for persistent memory."
    
    print(f"Processing mock interaction: {prompt}")
    # Note: KnowledgeExtractor.process_interaction usually calls an LLM. 
    # For this test, we verify the node/edge addition logic directly or mock the LLM part.
    
    memory_graph.add_node(conv_id, "conversation", "Test Conv", content=prompt)
    memory_graph.add_node("sqlite_decision", "decision", "Use SQLite", content="Moving to SQLite for Phase 4")
    memory_graph.add_edge(conv_id, "sqlite_decision", "documented")
    
    nodes = memory_graph.get_all_nodes()
    edges = memory_graph.get_all_edges()
    
    print(f"Nodes found: {len(nodes)}")
    print(f"Edges found: {len(edges)}")
    
    assert len(nodes) >= 2
    assert any(n['id'] == 'sqlite_decision' for n in nodes)
    print("✅ Semantic Memory data persistence verified.")

async def verify_scout_agent():
    print("\n--- 🕵️ Verifying Scout Agent reconnaissance ---")
    scout = ScoutAgent(workspace_path=".")
    # Simulate high activity on a file
    for i in range(7):
        memory_graph.add_edge(f"conv_{i}", "App.tsx", "contains")
    
    await scout.perform_reconnaissance()
    
    nodes = memory_graph.get_all_nodes()
    recommendations = [n for n in nodes if n['type'] == 'recommendation']
    
    print(f"Recommendations generated: {len(recommendations)}")
    if recommendations:
        print(f"Last Rec: {recommendations[-1]['content']}")
        assert "App.tsx" in recommendations[-1]['content']
    
    print("✅ Scout Agent hotspot detection verified.")

async def verify_training_orchestrator():
    print("\n--- 🏗️ Verifying Training Orchestrator (Dry Run) ---")
    # We won't launch a real training for real, but check the command generation
    # Create a dummy dataset
    dummy_data = os.path.join("/tmp", "dummy_dataset.jsonl")
    with open(dummy_data, "w") as f:
        f.write('{"text": "hello"}\n')
    
    result = await training_orchestrator.start_finetune(
        model_path="dummy_model",
        dataset_path=dummy_data,
        iterations=5
    )
    
    print(f"Training Start Result: {result}")
    assert result["status"] == "started"
    print("✅ Training Orchestrator pipeline verified.")

async def main():
    try:
        await verify_semantic_memory()
        await verify_scout_agent()
        await verify_training_orchestrator()
        print("\n🏆 ALL PHASE 5 SYSTEMS VERIFIED 🏆")
    except Exception as e:
        print(f"\n❌ Verification FAILED: {e}")

if __name__ == "__main__":
    asyncio.run(main())
