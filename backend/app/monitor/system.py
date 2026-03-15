import logging
import subprocess
import re
import psutil
import platform
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Prime the psutil CPU counter at import time so the first
# interval=None call returns a real delta instead of 0 or 100.
psutil.cpu_percent(interval=None)


class SystemMonitor:
    @staticmethod
    def get_system_stats():
        mem = psutil.virtual_memory()
        du = shutil.disk_usage(str(Path.home()))
        # interval=None returns usage since the last call (primed above)
        cpu_percent = psutil.cpu_percent(interval=None)

        gpu = SystemMonitor._get_gpu_stats()
        
        # Phase 5: Scout recommendations count
        try:
            from app.memory.service import memory_graph
            nodes = memory_graph.get_all_nodes()
            rec_count = len([n for n in nodes if n["type"] == "recommendation"])
        except Exception:
            rec_count = 0
            
        return {
            "memory": {
                "total": mem.total,
                "available": mem.available,
                "used": mem.used,
                "percent": round((mem.used / mem.total) * 100),
            },
            "disk": {
                "total": du.total,
                "free": du.free,
                "used": du.used,
                "percent": (du.used / du.total) * 100,
            },
            "cpu": {
                "percent": cpu_percent,
                "cores": psutil.cpu_count(logical=True),
            },
            "gpu": gpu,
            "scout_recommendations": rec_count,
            "platform": {
                "system": platform.system(),
                "processor": platform.processor(),
                "release": platform.release(),
            },
        }

    @staticmethod
    def _get_gpu_stats() -> dict:
        """Query Apple GPU stats via ioreg (Metal/AGX accelerator)."""
        if platform.system() != "Darwin":
            return {"available": False}

        try:
            result = subprocess.run(
                ["ioreg", "-r", "-d", "1", "-c", "IOAccelerator"],
                capture_output=True, text=True, timeout=2,
            )
            text = result.stdout

            gpu_info: dict = {"available": True}

            # Model name (e.g. "Apple M4")
            m = re.search(r'"model"\s*=\s*"([^"]+)"', text)
            if m:
                gpu_info["model"] = m.group(1)

            # GPU core count
            m = re.search(r'"gpu-core-count"\s*=\s*(\d+)', text)
            if m:
                gpu_info["cores"] = int(m.group(1))

            # Device utilization %
            m = re.search(r'"Device Utilization %"\s*=\s*(\d+)', text)
            if m:
                gpu_info["utilization"] = int(m.group(1))

            # In-use system memory (GPU-allocated, bytes)
            m = re.search(r'"In use system memory"\s*=\s*(\d+)', text)
            if m:
                gpu_info["memory_in_use"] = int(m.group(1))

            # Total allocated system memory (bytes)
            m = re.search(r'"Alloc system memory"\s*=\s*(\d+)', text)
            if m:
                gpu_info["memory_allocated"] = int(m.group(1))

            return gpu_info
        except Exception as e:
            logger.debug(f"GPU stats unavailable: {e}")
            return {"available": False}
