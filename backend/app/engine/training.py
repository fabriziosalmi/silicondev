import os
import subprocess
import logging
import json
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

class TrainingOrchestrator:
    """Orchestrates local fine-tuning using mlx-lm or similar tools."""
    
    def __init__(self, training_data_dir: str):
        self.training_data_dir = training_data_dir
        self.active_job_id: Optional[str] = None

    async def start_finetune(self, model_path: str, dataset_path: str, iterations: int = 100):
        """Triggers the fine-tuning process via subprocess."""
        if self.active_job_id:
            return {"error": "A training job is already running."}

        # Ensure dataset exist
        if not os.path.exists(dataset_path):
             return {"error": f"Dataset not found at {dataset_path}"}

        # mlx-lm fine-tuning command (example)
        # Note: In a real system, we'd use mlx_lm.lora.train() directly if possible,
        # but a subprocess is safer to avoid blocking the main backend or leaking memory.
        job_id = f"job_{int(os.path.getmtime(dataset_path))}"
        self.active_job_id = job_id
        
        output_adapter = os.path.join(os.path.dirname(dataset_path), "adapters")
        
        cmd = [
            "python", "-m", "mlx_lm.lora",
            "--model", model_path,
            "--train",
            "--data", dataset_path,
            "--iters", str(iterations),
            "--adapter-path", output_adapter
        ]
        
        logger.info(f"Starting Fine-Tune Job {job_id}: {' '.join(cmd)}")
        
        try:
            # We run it detached or in a background thread to not block the API
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # For this MVP, we just return that it started. 
            # In a full impl, we'd track the process handle and log output.
            return {
                "status": "started",
                "job_id": job_id,
                "output_adapter": output_adapter
            }
        except Exception as e:
            self.active_job_id = None
            logger.error(f"Failed to start training: {e}")
            return {"error": str(e)}

    def get_status(self):
        return {"active_job": self.active_job_id}

# Global orchestrator instance
training_orchestrator = TrainingOrchestrator(
    training_data_dir=str(Path.home() / ".silicon-studio" / "training_data")
)
