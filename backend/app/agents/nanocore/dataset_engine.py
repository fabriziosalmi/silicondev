"""Engine for capturing and formatting local session data for fine-tuning."""

import json
import os
import time
from pathlib import Path
from typing import List, Dict, Any

class DatasetEngine:
    def __init__(self, storage_dir: str = None):
        if storage_dir is None:
            # Default to a local 'data' folder in the backend
            self.storage_dir = Path(__file__).parent.parent.parent.parent / "data" / "training"
        else:
            self.storage_dir = Path(storage_dir)
            
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.current_session_file = self.storage_dir / f"session_{int(time.time())}.jsonl"

    def log_interaction(self, messages: List[Dict[str, str]], metadata: Dict[str, Any] = None):
        """Logs a successful interaction turn to a jsonl file.
        
        Format: {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
        This matches the expected format for mlx-lm fine-tuning.
        """
        if not messages:
            return

        entry = {
            "timestamp": time.time(),
            "messages": messages,
            "metadata": metadata or {}
        }
        
        try:
            with open(self.current_session_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception as e:
            # Non-critical, don't break the agent if logging fails
            pass

    def log_rejected_interaction(self, messages: List[Dict[str, str]], reason: str = None):
        """Logs a failed or rejected interaction for later DPO tuning."""
        if not messages:
            return
        
        entry = {
            "timestamp": time.time(),
            "messages": messages,
            "status": "rejected",
            "reason": reason
        }
        
        try:
            rejected_file = self.storage_dir / "rejected_interactions.jsonl"
            with open(rejected_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

    def prepare_training_package(self, min_samples: int = 50) -> Dict[str, Any]:
        """Checks if enough samples are available and prepares a training config."""
        output_file = self.storage_dir / "dataset_latest.jsonl"
        self.export_for_training()
        
        if not output_file.exists():
            return {"ready": False, "count": 0}
            
        count = 0
        with open(output_file, "r") as f:
            count = sum(1 for _ in f)
            
        if count < min_samples:
            return {"ready": False, "count": count, "threshold": min_samples}
            
        # Prepare mlx-lm compatible directory structure
        train_dir = self.storage_dir / "mlx_train_ready"
        train_dir.mkdir(exist_ok=True)
        
        # mlx-lm expects train.jsonl, valid.jsonl, test.jsonl
        # For simplicity in local dev, we use the same for all (or simple split)
        import shutil
        shutil.copy(output_file, train_dir / "train.jsonl")
        shutil.copy(output_file, train_dir / "valid.jsonl")
        
        return {
            "ready": True, 
            "count": count, 
            "path": str(train_dir),
            "command": f"python -m mlx_lm.tuner.train --data {train_dir} --model <model_path> --iters 100 --adapter-file {self.storage_dir}/adapter.safetensors"
        }

    def export_for_training(self) -> str:
        """Consolidates session data into a single training file."""
        output_file = self.storage_dir / "dataset_latest.jsonl"
        count = 0
        try:
            with open(output_file, "w", encoding="utf-8") as out_f:
                for session_file in self.storage_dir.glob("session_*.jsonl"):
                    with open(session_file, "r", encoding="utf-8") as in_f:
                        for line in in_f:
                            # Verify valid json and extract messages
                            data = json.loads(line)
                            if "messages" in data:
                                out_f.write(json.dumps({"messages": data["messages"]}) + "\n")
                                count += 1
            return f"Exported {count} samples to {output_file}"
        except Exception as e:
            return f"Export failed: {e}"

# Global instance for high-performance shared logging
dataset_engine = DatasetEngine()
