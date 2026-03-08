import logging
import numpy as np
import os
from typing import List, Optional

logger = logging.getLogger(__name__)

# Default shared model for MLX embeddings
MLX_MODEL_REPO = os.getenv("SILICONDEV_MLX_EMBEDDINGS_REPO", "mlx-community/nomic-embed-text-v1.5-mlx")
ONNX_MODEL_REPO = os.getenv("SILICONDEV_ONNX_EMBEDDINGS_REPO", "sentence-transformers/all-MiniLM-L6-v2")
MAX_SEQ_LEN = 512

class MLXEmbedder:
    """Native MLX embedder for high-performance retrieval on Apple Silicon."""
    
    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._available = None

    @property
    def available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            import mlx.core as mx
            from mlx_lm import load
            self._available = True
        except ImportError:
            self._available = False
        return self._available

    def _ensure_loaded(self):
        if self._model is not None:
            return

        from mlx_lm import load
        logger.info("Loading MLX embedding model: %s", MLX_MODEL_REPO)
        
        # Load via mlx-lm — works for most transformer-based embedders
        try:
            self._model, self._tokenizer = load(MLX_MODEL_REPO)
            logger.info("MLX Embedding model loaded (Zero-Copy ready).")
        except Exception as e:
            logger.warning("Failed to load MLX embedder from %s: %s. Falling back to ONNX/CPU.", MLX_MODEL_REPO, e)
            self._available = False
            raise

    def embed(self, texts: List[str], batch_size: int = 32, is_query: bool = False) -> np.ndarray:
        self._ensure_loaded()
        import mlx.core as mx
        
        # Nomic v1.5 specific prefix
        prefix = "search_document: "
        if is_query:
            prefix = "search_query: "
            
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = [prefix + t for t in texts[i : i + batch_size]]
            
            # Use self._model.model to get to the base transformer if checking for hidden states
            # For nomic-embed models loaded via mlx-lm, the forward pass usually returns hidden states
            encoded = [self._tokenizer.encode(t) for t in batch]
            max_len = max(len(e) for e in encoded)
            input_ids = np.zeros((len(batch), max_len), dtype=np.int32)
            for j, ids in enumerate(encoded):
                input_ids[j, :len(ids)] = ids
            
            inputs = mx.array(input_ids)
            # Forward pass: mlx-lm models return (hidden_states, logits) or just logits
            # We want the hidden states. Some models need output_hidden_states=True
            output = self._model(inputs)
            
            # Generic hidden state extraction from MLX LM output
            if isinstance(output, tuple):
                hidden_states = output[0]
            else:
                hidden_states = output

            # Mean pooling over non-zero tokens
            mask = (inputs != 0)[:, :, None].astype(mx.float32)
            summed = mx.sum(hidden_states * mask, axis=1)
            counts = mx.maximum(mx.sum(mask, axis=1), 1e-9)
            embs = summed / counts
            
            # L2 Normalize
            norms = mx.linalg.norm(embs, axis=1, keepdims=True)
            embs = embs / mx.maximum(norms, 1e-9)
            
            all_embeddings.append(np.array(embs))
            
        return np.vstack(all_embeddings) if all_embeddings else np.empty((0, self._model.config.hidden_size))

    def similarity(self, query_emb: np.ndarray, chunk_embs: np.ndarray) -> np.ndarray:
        return (chunk_embs @ query_emb.T).flatten()

class LocalEmbedder:
    """Lightweight sentence embedder backed by ONNX Runtime."""

    def __init__(self):
        self._session = None
        self._tokenizer = None

    def _ensure_loaded(self):
        if self._session is not None:
            return

        from huggingface_hub import hf_hub_download
        import onnxruntime as ort
        from tokenizers import Tokenizer

        logger.info("Loading embedding model %s (ONNX)...", ONNX_MODEL_REPO)

        model_path = hf_hub_download(repo_id=ONNX_MODEL_REPO, filename="onnx/model.onnx")
        tokenizer_path = hf_hub_download(repo_id=ONNX_MODEL_REPO, filename="tokenizer.json")

        self._session = ort.InferenceSession(
            model_path,
            providers=["CoreMLExecutionProvider", "CPUExecutionProvider"],
        )
        self._tokenizer = Tokenizer.from_file(tokenizer_path)
        self._tokenizer.enable_truncation(max_length=MAX_SEQ_LEN)
        self._tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")

        logger.info("Embedding model loaded.")

    @property
    def available(self) -> bool:
        try:
            import onnxruntime
            import tokenizers
            return True
        except ImportError:
            return False

    def embed(self, texts: List[str], batch_size: int = 64, is_query: bool = False) -> np.ndarray:
        self._ensure_loaded()

        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            encodings = self._tokenizer.encode_batch(batch)

            input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
            attention_mask = np.array(
                [e.attention_mask for e in encodings], dtype=np.int64
            )
            token_type_ids = np.zeros_like(input_ids)

            outputs = self._session.run(
                None,
                {
                    "input_ids": input_ids,
                    "attention_mask": attention_mask,
                    "token_type_ids": token_type_ids,
                },
            )

            token_embs = outputs[0]
            mask = attention_mask[:, :, np.newaxis].astype(np.float32)
            summed = np.sum(token_embs * mask, axis=1)
            counts = np.clip(mask.sum(axis=1), a_min=1e-9, a_max=None)
            embs = summed / counts

            norms = np.linalg.norm(embs, axis=1, keepdims=True)
            embs = embs / np.clip(norms, 1e-9, None)

            all_embeddings.append(embs)

        return np.vstack(all_embeddings) if all_embeddings else np.empty((0, 384))

    def similarity(self, query_emb: np.ndarray, chunk_embs: np.ndarray) -> np.ndarray:
        return (chunk_embs @ query_emb.T).flatten()

# Switchable embedder
_mlx_embedder = MLXEmbedder()
_onnx_embedder = LocalEmbedder()

class UnifiedEmbedder:
    @property
    def available(self) -> bool:
        return _mlx_embedder.available or _onnx_embedder.available
    
    def embed(self, texts: List[str], batch_size: int = 32, is_query: bool = False) -> np.ndarray:
        if _mlx_embedder.available:
            try:
                return _mlx_embedder.embed(texts, batch_size, is_query)
            except Exception as exc:
                logger.warning("MLX embedding path unavailable, retrying with ONNX fallback: %s", exc)

        if _onnx_embedder.available:
            return _onnx_embedder.embed(texts, batch_size, is_query)

        raise RuntimeError("No embedding backend available")

    def similarity(self, query_emb: np.ndarray, chunk_embs: np.ndarray) -> np.ndarray:
        if _mlx_embedder.available:
            return _mlx_embedder.similarity(query_emb, chunk_embs)
        return _onnx_embedder.similarity(query_emb, chunk_embs)

embedder = UnifiedEmbedder()
