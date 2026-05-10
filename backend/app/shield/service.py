"""
PIIShieldService — wraps Microsoft Presidio for PII detection and anonymization.

NOTE: presidio_analyzer and presidio_anonymizer depend on Pydantic V1 which is
incompatible with Python 3.14+. All imports are guarded so the service degrades
gracefully (available = False) rather than crashing at startup or build time.
"""
import asyncio
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Optional heavy deps — may be unavailable on Python ≥ 3.14 ──────────────
try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
    _PRESIDIO_AVAILABLE = True
except Exception as _presidio_err:
    logger.warning(
        "presidio is not available (likely Pydantic V1 / Python 3.14 incompatibility): %s. "
        "PII Shield will be disabled.",
        _presidio_err,
    )
    _PRESIDIO_AVAILABLE = False

try:
    import spacy as _spacy
    _SPACY_AVAILABLE = True
except Exception as _spacy_err:
    logger.warning("spacy not available: %s", _spacy_err)
    _SPACY_AVAILABLE = False


class PIIShieldService:
    """Detects and anonymizes PII using Presidio + spaCy en_core_web_sm."""

    def __init__(self) -> None:
        self.available = False
        self.analyzer: Optional[object] = None
        self.anonymizer: Optional[object] = None

        if not _PRESIDIO_AVAILABLE:
            logger.warning("PIIShieldService: presidio unavailable — service disabled.")
            return

        logger.info("Initializing PIIShieldService...")
        try:
            nlp = self._load_spacy_model()
            self.analyzer = self._build_analyzer(nlp)
            self.anonymizer = AnonymizerEngine()
            self.available = True
            logger.info("PIIShieldService fully initialized.")
        except Exception as exc:
            logger.error("Failed to initialize PIIShieldService: %s", exc, exc_info=True)

    # ── Private helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _load_spacy_model():
        """Attempt to load en_core_web_sm via multiple strategies. Returns nlp or None."""
        if not _SPACY_AVAILABLE:
            return None

        import sys, os

        # Strategy 1: direct module import (fastest, works when installed as a package)
        try:
            import en_core_web_sm
            nlp = en_core_web_sm.load()
            logger.debug("spaCy model loaded via module import.")
            return nlp
        except Exception as e1:
            logger.debug("Module import failed: %s", e1)

        # Strategy 2: frozen bundle path (PyInstaller)
        if getattr(sys, "frozen", False):
            try:
                model_path = os.path.join(sys._MEIPASS, "en_core_web_sm")
                if os.path.exists(model_path):
                    nlp = _spacy.load(model_path)
                    logger.debug("spaCy model loaded from frozen path: %s", model_path)
                    return nlp
            except Exception as e2:
                logger.debug("Frozen path load failed: %s", e2)

        # Strategy 3: spacy.load by name (works when model is in site-packages)
        try:
            nlp = _spacy.load("en_core_web_sm")
            logger.debug("spaCy model loaded via spacy.load('en_core_web_sm').")
            return nlp
        except Exception as e3:
            logger.warning("All spaCy load strategies failed. Last error: %s", e3)

        return None

    @staticmethod
    def _build_analyzer(nlp) -> "AnalyzerEngine":
        """Build AnalyzerEngine, optionally wiring the provided spaCy NLP model."""
        if nlp is not None:
            try:
                from presidio_analyzer.nlp_engine import NlpEngineProvider
                provider = NlpEngineProvider(nlp_configuration={
                    "nlp_engine_name": "spacy",
                    "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
                })
                engine = provider.create_engine()
                logger.info("AnalyzerEngine initialized with spaCy NLP engine.")
                return AnalyzerEngine(nlp_engine=engine)
            except Exception as exc:
                logger.warning("Could not wire spaCy to AnalyzerEngine: %s — using default.", exc)

        logger.warning("AnalyzerEngine initialized without custom NLP engine (reduced accuracy).")
        return AnalyzerEngine()

    # ── Public API ──────────────────────────────────────────────────────────

    def analyze_text(self, text: str, entities: List[str] = None) -> List[dict]:
        """Analyze text for PII entities (sync, CPU-heavy)."""
        if not self.available or not self.analyzer:
            raise RuntimeError("PII Shield is not available on this Python version.")
        results = self.analyzer.analyze(text=text, entities=entities, language="en")
        return [r.to_dict() for r in results]

    async def analyze_text_async(self, text: str, entities: List[str] = None) -> List[dict]:
        """Async wrapper — runs analysis in a thread to avoid blocking the event loop."""
        return await asyncio.to_thread(self.analyze_text, text, entities)

    def anonymize_text(self, text: str, entities: List[str] = None) -> dict:
        """Redact PII from text (sync, CPU-heavy). Returns original text if unavailable."""
        if not self.available or not self.analyzer or not self.anonymizer:
            return {"text": text, "items": []}

        analyzer_results = self.analyzer.analyze(text=text, entities=entities, language="en")
        anonymized = self.anonymizer.anonymize(text=text, analyzer_results=analyzer_results)
        return {
            "text": anonymized.text,
            "items": [
                {
                    "start": item.start,
                    "end": item.end,
                    "entity_type": item.entity_type,
                    "text": getattr(item, "text", None),
                    "operator": item.operator,
                }
                for item in anonymized.items
            ],
        }

    async def anonymize_text_async(self, text: str, entities: List[str] = None) -> dict:
        """Async wrapper — runs anonymization in a thread to avoid blocking the event loop."""
        return await asyncio.to_thread(self.anonymize_text, text, entities)
