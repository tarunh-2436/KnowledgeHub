import io
import os
import re
from collections import Counter

from docx import Document
from pypdf import PdfReader

from datetime import datetime, timezone

STOP_WORDS = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "this",
    "that",
    "it",
    "as",
    "by",
    "at",
    "from",
    "into",
    "have",
    "has",
    "had",
    "will",
    "would",
    "can",
    "could",
}


def extract_pdf_text(file_bytes):
    """
    Extract text from a PDF document.
    """

    reader = PdfReader(io.BytesIO(file_bytes))

    text = []

    for page in reader.pages:

        page_text = page.extract_text()

        if page_text:

            text.append(page_text)

    return "\n".join(text).strip()


def extract_docx_text(file_bytes):
    """
    Extract text from a DOCX document.
    """

    document = Document(io.BytesIO(file_bytes))

    return "\n".join(
        paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()
    )


def extract_plain_text(file_bytes):
    """
    Extract text from TXT and Markdown documents.
    """

    return file_bytes.decode(
        "utf-8",
        errors="ignore",
    )


def normalize_text(text):
    """
    Normalize extracted document text.
    """

    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    text = re.sub(
        r"\n+",
        "\n",
        text,
    )

    text = re.sub(
        r"[ \t]+",
        " ",
        text,
    )

    return text.strip()


def summarize_text(text, max_sentences=5):

    if not text:
        return ""

    text = re.sub(r"\s+", " ", text)

    sentences = re.split(r"(?<=[.!?])\s+", text)

    if len(sentences) <= max_sentences:
        return text

    words = re.findall(r"[A-Za-z]+", text.lower())

    frequencies = Counter(word for word in words if word not in STOP_WORDS)

    scored = []

    for index, sentence in enumerate(sentences):

        score = sum(
            frequencies[word] for word in re.findall(r"[A-Za-z]+", sentence.lower())
        )

        scored.append(
            (
                index,
                score,
                sentence,
            )
        )

    best = sorted(
        scored,
        key=lambda x: x[1],
        reverse=True,
    )[:max_sentences]

    best.sort(key=lambda x: x[0])

    return " ".join(sentence for _, _, sentence in best)


def generate_keywords(text, max_keywords=10):
    """
    Generate keywords using simple word frequency.
    """

    words = re.findall(r"[A-Za-z]{3,}", text.lower())

    frequencies = Counter(word for word in words if word not in STOP_WORDS)

    return [word for word, _ in frequencies.most_common(max_keywords)]


def get_current_timestamp():
    return datetime.now(timezone.utc).isoformat()
