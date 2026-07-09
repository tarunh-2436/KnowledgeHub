import io
import os

import nltk
import yake

from datetime import datetime, timezone

from docx import Document
from pypdf import PdfReader

from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lsa import LsaSummarizer

# ------------------------------------------------------------------
# Configure NLTK
# ------------------------------------------------------------------

nltk.data.path = [
    os.path.join(
        os.path.dirname(__file__),
        "tokenizers",
    )
]


# ------------------------------------------------------------------
# Text Extraction
# ------------------------------------------------------------------


def extract_pdf_text(file_bytes):
    """
    Extract text from a PDF document.
    """

    reader = PdfReader(io.BytesIO(file_bytes))

    pages = []

    for page in reader.pages:

        text = page.extract_text()

        if text:

            pages.append(text)

    return "\n".join(pages).strip()


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
    Extract text from TXT / Markdown.
    """

    return file_bytes.decode(
        "utf-8",
        errors="ignore",
    )


# ------------------------------------------------------------------
# Cleaning
# ------------------------------------------------------------------


def normalize_text(text):
    """
    Normalize extracted document text.
    """

    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    lines = []

    for line in text.splitlines():

        line = line.strip()

        if not line:
            continue

        lines.append(line)

    return "\n".join(lines)


# ------------------------------------------------------------------
# Summarization
# ------------------------------------------------------------------


def summarize_text(
    text,
    sentence_count=5,
):
    """
    Generate document summary using Sumy's LSA summarizer.
    """

    if not text.strip():
        return ""

    parser = PlaintextParser.from_string(
        text,
        Tokenizer("english"),
    )

    summarizer = LsaSummarizer()

    summary = summarizer(
        parser.document,
        sentence_count,
    )

    return " ".join(str(sentence) for sentence in summary)


# ------------------------------------------------------------------
# Keywords
# ------------------------------------------------------------------


def generate_keywords(
    text,
    max_keywords=10,
):
    """
    Generate keywords using YAKE.
    """

    if not text.strip():
        return []

    extractor = yake.KeywordExtractor(
        lan="en",
        n=2,
        top=max_keywords,
        dedupLim=0.9,
    )

    return [keyword for keyword, _ in extractor.extract_keywords(text)]


# ------------------------------------------------------------------
# Timestamp
# ------------------------------------------------------------------


def get_current_timestamp():
    return datetime.now(
        timezone.utc,
    ).isoformat()
