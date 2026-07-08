import io
import os
import re

import nltk
import yake

from docx import Document
from pypdf import PdfReader

from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lsa import LsaSummarizer

nltk.data.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "tokenizers",
    ),
)


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


def generate_summary(
    text,
    sentence_count=3,
):
    """
    Generate an extractive summary using Sumy's
    LSA summarizer.
    """

    if not text.strip():
        return ""

    if len(text.split()) < 50:
        return text.strip()

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


def generate_keywords(
    text,
    max_keywords=10,
):
    """
    Generate document keywords using YAKE.
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


def get_current_timestamp():
    return datetime.now(timezone.utc).isoformat()
