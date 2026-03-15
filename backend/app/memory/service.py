import sqlite3
import json
import time
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class KnowledgeGraph:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = str(Path.home() / ".silicon-studio" / "knowledge_graph.db")
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initializes the SQLite schema for the Agentic Knowledge Graph."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            # Nodes Table: Conversations, Files, Decisions, Tags, Bugs
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    label TEXT NOT NULL,
                    content TEXT,
                    metadata TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)
            # Edges Table: Relationships between nodes
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS edges (
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    metadata TEXT,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (source, target, relation),
                    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
                    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
                )
            """)
            # Full-text search for fast content retrieval
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)")
            conn.commit()

    def add_node(self, node_id: str, node_type: str, label: str, content: str = "", metadata: Dict[str, Any] = None):
        """Adds or updates a node in the graph."""
        now = time.time()
        metadata_json = json.dumps(metadata or {})
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO nodes (id, type, label, content, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    label=excluded.label,
                    content=excluded.content,
                    metadata=excluded.metadata,
                    updated_at=excluded.updated_at
            """, (node_id, node_type, label, content, metadata_json, now, now))
            conn.commit()

    def add_edge(self, source: str, target: str, relation: str, metadata: Dict[str, Any] = None):
        """Links two nodes with a typed relationship."""
        now = time.time()
        metadata_json = json.dumps(metadata or {})
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT OR IGNORE INTO edges (source, target, relation, metadata, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (source, target, relation, metadata_json, now))
                conn.commit()
        except sqlite3.IntegrityError as e:
            logger.error(f"Failed to link nodes {source} -> {target}: {e}")

    def query_related(self, node_id: str, relation: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves nodes related to the given node."""
        query = """
            SELECT n.*, e.relation FROM nodes n
            JOIN edges e ON (e.target = n.id OR e.source = n.id)
            WHERE (e.source = ? OR e.target = ?)
        """
        params = [node_id, node_id]
        if relation:
            query += " AND e.relation = ?"
            params.append(relation)

        results = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query, params)
            for row in cursor.fetchall():
                node = dict(row)
                if node["id"] == node_id: # We want the OTHER side of the edge
                    # This query is a bit simplified, in a real graph we'd handle directionality better
                    pass 
                node["metadata"] = json.loads(node["metadata"])
                results.append(node)
        return results

    def get_all_nodes(self) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM nodes")
            return [dict(row) for row in cursor.fetchall()]

    def get_all_edges(self) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM edges")
            return [dict(row) for row in cursor.fetchall()]

# Global instance
memory_graph = KnowledgeGraph()
