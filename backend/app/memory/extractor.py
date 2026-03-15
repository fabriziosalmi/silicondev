import json
import logging
from typing import List, Dict, Any
from app.memory.service import memory_graph

logger = logging.getLogger(__name__)

class KnowledgeExtractor:
    """Analyzes conversation turns to extract nodes and edges for the Knowledge Graph."""
    
    def __init__(self, engine_service=None):
        self.engine_service = engine_service

    async def process_interaction(self, conversation_id: str, prompt: str, response: str):
        """Extracts facts, decisions, and file links from a conversation turn."""
        if not self.engine_service:
            # If no engine provided, we might skip or use a default internal one
            return

        # 1. Register the conversation node
        memory_graph.add_node(
            node_id=conversation_id,
            node_type="conversation",
            label=f"Conversation: {conversation_id[:8]}",
            metadata={"last_prompt": prompt[:100]}
        )

        # 2. Extract facts via LLM (Asynchronous background task)
        # We use a small model or a specialized prompt for high speed extraction
        extraction_prompt = f"""
Analyze the following interaction and extract key technical facts, architectural decisions, and mentioned files.
Format as JSON: {{"nodes": [{{"id": "...", "type": "...", "label": "...", "content": "..."}}], "edges": [{{"source": "...", "target": "...", "relation": "..."}}]}}

Input:
User: {prompt}
Assistant: {response}
"""
        
        try:
            # We use the internal generate_response from engine_service
            # Note: We should probably use a faster model for this
            result = await self.engine_service.generate_response(
                model_id=self.engine_service.active_model_id or "default",
                messages=[{"role": "user", "content": extraction_prompt}],
                max_tokens=512,
                temperature=0.1
            )
            
            extracted = self._parse_json_safely(result.get("text", ""))
            if extracted:
                for node in extracted.get("nodes", []):
                    memory_graph.add_node(
                        node_id=node["id"],
                        node_type=node["type"],
                        label=node["label"],
                        content=node.get("content", "")
                    )
                    # Link to conversation
                    memory_graph.add_edge(conversation_id, node["id"], "contains")
                
                for edge in extracted.get("edges", []):
                    memory_graph.add_edge(edge["source"], edge["target"], edge["relation"])
                    
        except Exception as e:
            logger.error(f"Knowledge extraction failed: {e}")

    def _parse_json_safely(self, text: str) -> Dict[str, Any]:
        try:
            # Find json block if wrapped in markdown
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            return json.loads(text)
        except Exception:
            return {}
