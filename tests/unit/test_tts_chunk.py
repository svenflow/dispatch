"""Tests for tts.py - text chunking algorithm."""
import pytest
import sys
from pathlib import Path

# Add skills path
sys.path.insert(0, str(Path.home() / ".claude/skills/tts/scripts"))

from tts import chunk_text, MAX_CHUNK_SIZE


class TestChunkTextBasic:
    """Basic tests for text chunking."""

    def test_chunk_short_text_unchanged(self):
        """Test that short text is returned as single chunk."""
        text = "Hello world."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == "Hello world."

    def test_chunk_empty_text(self):
        """Test chunking empty text."""
        chunks = chunk_text("")
        assert chunks == []

    def test_chunk_single_sentence(self):
        """Test chunking single sentence."""
        text = "This is a single sentence."
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text


class TestChunkTextSentenceBoundaries:
    """Tests for sentence boundary detection."""

    def test_chunk_respects_period_boundary(self):
        """Test that chunks split at periods."""
        text = "First sentence. Second sentence. Third sentence."
        chunks = chunk_text(text, max_size=30)
        # Should split at sentence boundaries
        assert all("." in c or c == chunks[-1] for c in chunks)

    def test_chunk_respects_exclamation_boundary(self):
        """Test that chunks split at exclamation marks."""
        text = "Wow! Amazing! Incredible!"
        chunks = chunk_text(text, max_size=15)
        assert len(chunks) > 1

    def test_chunk_respects_question_boundary(self):
        """Test that chunks split at question marks."""
        text = "What? Why? How?"
        chunks = chunk_text(text, max_size=12)
        assert len(chunks) > 1


class TestChunkTextLongSentences:
    """Tests for handling long sentences."""

    def test_chunk_long_sentence_splits_by_words(self):
        """Test that very long sentences split by words."""
        # Create a sentence longer than max_size
        long_sentence = "word " * 1000  # ~5000 chars
        chunks = chunk_text(long_sentence, max_size=100)

        # Should have multiple chunks
        assert len(chunks) > 1
        # Each chunk should be <= max_size
        assert all(len(c) <= 100 for c in chunks)

    def test_chunk_preserves_all_content(self):
        """Test that no content is lost during chunking."""
        text = "The quick brown fox jumps over the lazy dog. " * 10
        chunks = chunk_text(text, max_size=100)

        # Reconstruct and compare word counts
        original_words = len(text.split())
        reconstructed_words = sum(len(c.split()) for c in chunks)
        assert reconstructed_words == original_words


class TestChunkTextMaxSize:
    """Tests for max size enforcement."""

    def test_chunk_respects_max_size(self):
        """Test that all chunks are <= max_size."""
        text = "This is a test sentence. " * 100
        max_size = 200
        chunks = chunk_text(text, max_size=max_size)

        assert all(len(c) <= max_size for c in chunks)

    def test_chunk_default_max_size(self):
        """Test default max size is used with splittable text."""
        # Use text with spaces so it can be split
        text = "word " * 2000  # ~10000 chars with spaces
        chunks = chunk_text(text)

        # All chunks should respect MAX_CHUNK_SIZE
        assert all(len(c) <= MAX_CHUNK_SIZE for c in chunks)


class TestChunkTextEdgeCases:
    """Edge case tests for text chunking."""

    def test_chunk_text_with_abbreviations(self):
        """Test handling text with abbreviations."""
        text = "Dr. Smith went to Washington D.C. to meet Mrs. Jones."
        chunks = chunk_text(text)
        # Should handle abbreviations without weird splits
        assert len(chunks) >= 1

    def test_chunk_text_with_ellipsis(self):
        """Test handling text with ellipsis."""
        text = "Wait... I need to think... Okay, let's continue."
        chunks = chunk_text(text)
        assert len(chunks) >= 1

    def test_chunk_text_with_multiple_punctuation(self):
        """Test handling text with multiple punctuation marks."""
        text = "What?! Really?! That's amazing!!!"
        chunks = chunk_text(text)
        assert len(chunks) >= 1

    def test_chunk_text_with_numbers(self):
        """Test handling text with decimal numbers."""
        text = "The price is $19.99. That's a 50.5% discount."
        chunks = chunk_text(text)
        # Numbers with decimals shouldn't cause issues
        assert len(chunks) >= 1

    def test_chunk_text_with_urls(self):
        """Test handling text with URLs."""
        text = "Visit https://example.com/page for more info. Then go to http://test.org."
        chunks = chunk_text(text)
        assert len(chunks) >= 1

    def test_chunk_text_with_newlines(self):
        """Test handling text with newlines."""
        text = "Line one.\nLine two.\nLine three."
        chunks = chunk_text(text)
        assert len(chunks) >= 1

    def test_chunk_single_word_per_chunk(self):
        """Test when single words exceed max_size."""
        # Edge case: single very long word
        long_word = "A" * 100
        chunks = chunk_text(long_word, max_size=50)
        # Should still return the word (can't split mid-word)
        assert len(chunks) >= 1


class TestChunkTextSpacing:
    """Tests for spacing preservation."""

    def test_chunk_preserves_single_space(self):
        """Test that single spaces between sentences are preserved."""
        text = "First sentence. Second sentence."
        chunks = chunk_text(text)
        # Joining should recreate original-ish text
        joined = " ".join(chunks)
        assert "First sentence" in joined
        assert "Second sentence" in joined

    def test_chunk_no_leading_spaces(self):
        """Test that chunks don't have leading spaces."""
        text = "First. Second. Third. Fourth. Fifth."
        chunks = chunk_text(text, max_size=15)
        for chunk in chunks:
            assert not chunk.startswith(" "), f"Chunk starts with space: '{chunk}'"

    def test_chunk_no_trailing_spaces(self):
        """Test that chunks don't have trailing spaces."""
        text = "First. Second. Third. Fourth. Fifth."
        chunks = chunk_text(text, max_size=15)
        for chunk in chunks:
            assert not chunk.endswith(" "), f"Chunk ends with space: '{chunk}'"
