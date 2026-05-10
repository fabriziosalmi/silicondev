"""Message-content helpers for the MLX engine.

Pure functions that parse OpenAI-style chat messages with multipart content
(text + image) into the formats the MLX-LM and MLX-VLM generation paths
expect. No engine state is required.
"""
from __future__ import annotations

import base64
import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def save_base64_image(data_url: str) -> str | None:
    """Decode a data: URL to a temp file, return the file path."""
    try:
        header, b64data = data_url.split(",", 1)
        # Extract extension from mime type: "data:image/png;base64" → "png"
        mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        ext = mime.split("/")[1] if "/" in mime else "png"
        if ext not in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
            ext = "png"

        img_bytes = base64.b64decode(b64data)
        fd, path = tempfile.mkstemp(suffix=f".{ext}", prefix="silicon_vlm_")
        with os.fdopen(fd, "wb") as f:
            f.write(img_bytes)
        return path
    except (ValueError, OSError) as e:
        logger.error(f"Failed to decode base64 image: {e}")
        return None


def extract_vision_content(messages: list) -> tuple[list[str], list[dict]]:
    """Parse messages with OpenAI-style content parts.

    Returns (image_file_paths, text_messages).

    Handles both:
    - content: str  (text only, legacy)
    - content: list[{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
    """
    image_paths: list[str] = []
    text_messages: list[dict] = []

    for msg in messages:
        content = msg.get("content", "")
        role = msg.get("role", "user")

        if isinstance(content, str):
            text_messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            msg_text = ""
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        msg_text += part.get("text", "")
                    elif part.get("type") == "image_url":
                        url = ""
                        image_url = part.get("image_url")
                        if isinstance(image_url, dict):
                            url = image_url.get("url", "")
                        elif isinstance(image_url, str):
                            url = image_url
                        if url.startswith("data:"):
                            path = save_base64_image(url)
                            if path:
                                image_paths.append(path)
            text_messages.append({"role": role, "content": msg_text})
        else:
            text_messages.append({"role": role, "content": str(content)})

    return image_paths, text_messages


def flatten_messages_to_text(messages: list) -> list[dict]:
    """Ensure all message content is plain strings.

    Extracts text from multipart content, ignores images.
    """
    flat: list[dict] = []
    for msg in messages:
        content = msg.get("content", "")
        role = msg.get("role", "user")
        if isinstance(content, str):
            flat.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts: list[str] = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
            flat.append({"role": role, "content": " ".join(text_parts)})
        else:
            flat.append({"role": role, "content": str(content)})
    return flat
