"""Widget system models and validation for dispatch-app.

Shared between reply-widget CLI and dispatch-api server.
Each widget type is a self-contained descriptor with models, validation, and formatting.
Adding a new type = one new descriptor class + one WIDGET_REGISTRY entry.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Literal

from pydantic import BaseModel, Field, ValidationError


# ---------------------------------------------------------------------------
# Protocol: every widget type implements this
# ---------------------------------------------------------------------------


class WidgetDescriptor(ABC):
    """Base class for widget type descriptors."""

    widget_model: type[BaseModel]
    response_model: type[BaseModel]

    @abstractmethod
    def cross_validate(self, widget: BaseModel, response: BaseModel) -> str | None:
        """Type-specific validation beyond pydantic. Returns error or None."""
        ...

    @abstractmethod
    def format_content(self, widget_data: dict) -> str:
        """Plain-text fallback for old clients (stored in content column)."""
        ...

    @abstractmethod
    def format_response(self, widget_data: dict, response: dict, message_id: str) -> str:
        """Deterministic text injected into agent session."""
        ...


# ---------------------------------------------------------------------------
# ask_question widget type
# ---------------------------------------------------------------------------


class QuestionOption(BaseModel):
    label: str
    description: str | None = None


class Question(BaseModel):
    question: str
    options: list[QuestionOption] = Field(min_length=2, max_length=4)
    multi_select: bool = False
    include_other: bool = True


class AskQuestionWidget(BaseModel):
    v: Literal[1] = 1
    type: Literal["ask_question"] = "ask_question"
    questions: list[Question] = Field(min_length=1, max_length=4)


class QuestionAnswer(BaseModel):
    question_index: int = Field(ge=0)
    selected: list[str] = Field(min_length=1)
    other_text: str | None = Field(None, max_length=500)


class FormResponse(BaseModel):
    answers: list[QuestionAnswer] = Field(min_length=1)


class AskQuestionDescriptor(WidgetDescriptor):
    widget_model = AskQuestionWidget
    response_model = FormResponse

    def cross_validate(self, widget: AskQuestionWidget, response: FormResponse) -> str | None:
        # Must have one answer per question
        answered_indices = {a.question_index for a in response.answers}
        expected_indices = set(range(len(widget.questions)))
        missing = expected_indices - answered_indices
        if missing:
            return f"Missing answers for question(s): {sorted(missing)}"
        extra = answered_indices - expected_indices
        if extra:
            return f"Invalid question_index(es): {sorted(extra)}"

        for answer in response.answers:
            question = widget.questions[answer.question_index]
            valid_labels = {o.label for o in question.options}
            # "Other" is valid when include_other is true
            if question.include_other:
                valid_labels.add("Other")
            invalid = set(answer.selected) - valid_labels
            if invalid:
                return f"Invalid selections for question {answer.question_index}: {invalid}"
            if not question.multi_select and len(answer.selected) > 1:
                return f"Question {answer.question_index} does not allow multi-select, got {len(answer.selected)} selections"
            # Require non-empty other_text when "Other" is selected
            if "Other" in answer.selected:
                if not answer.other_text or not answer.other_text.strip():
                    return f"Question {answer.question_index}: 'Other' selected but no text provided"
            # Disallow other_text when "Other" is not selected
            if "Other" not in answer.selected and answer.other_text:
                return f"Question {answer.question_index}: other_text provided but 'Other' not selected"
        return None

    def format_content(self, widget_data: dict) -> str:
        parts = []
        for q in widget_data["questions"]:
            parts.append(q["question"])
            for opt in q["options"]:
                line = f"- {opt['label']}"
                if opt.get("description"):
                    line += f": {opt['description']}"
                parts.append(line)
            if q.get("include_other", True):
                parts.append("- Other (free text)")
        return "\n".join(parts)

    def format_response(self, widget_data: dict, response: dict, message_id: str) -> str:
        lines = [f"[Widget Response {message_id}]"]
        for answer in response["answers"]:
            q = widget_data["questions"][answer["question_index"]]
            selected = answer["selected"]
            parts = []
            for s in selected:
                if s == "Other" and answer.get("other_text"):
                    parts.append(f'Other: "{answer["other_text"].strip()}"')
                else:
                    parts.append(s)
            lines.append(f'Q: "{q["question"]}" \u2192 {", ".join(parts)}')
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Registry - single registration point for all widget types
# ---------------------------------------------------------------------------

WIDGET_REGISTRY: dict[str, WidgetDescriptor] = {
    "ask_question": AskQuestionDescriptor(),
}


# ---------------------------------------------------------------------------
# Generic functions - dispatch to descriptors, no type-specific code
# ---------------------------------------------------------------------------


def validate_response(widget_data: dict, response: dict) -> str | None:
    """Validate a widget response against its widget data. Returns error or None."""
    wtype = widget_data.get("type")
    descriptor = WIDGET_REGISTRY.get(wtype)
    if not descriptor:
        return f"Unknown widget type: {wtype}"
    try:
        widget = descriptor.widget_model(**widget_data)
        resp = descriptor.response_model(**response)
    except ValidationError as e:
        return str(e)
    return descriptor.cross_validate(widget, resp)


def validate_widget(widget_type: str, payload: dict) -> str | None:
    """Validate a widget payload. Returns error or None."""
    descriptor = WIDGET_REGISTRY.get(widget_type)
    if not descriptor:
        return f"Unknown widget type: {widget_type}"
    try:
        descriptor.widget_model(**payload)
    except ValidationError as e:
        return str(e)
    return None


def format_widget_content(widget_data: dict) -> str:
    """Generate plain-text fallback content for a widget."""
    descriptor = WIDGET_REGISTRY.get(widget_data.get("type"))
    if not descriptor:
        return f"[Widget: {widget_data.get('type')}]"
    return descriptor.format_content(widget_data)


def format_widget_response(widget_data: dict, response: dict, message_id: str) -> str:
    """Generate deterministic injection text for a widget response."""
    descriptor = WIDGET_REGISTRY.get(widget_data.get("type"))
    if not descriptor:
        return f'[Widget Response {message_id}] Response received for {widget_data.get("type")}'
    return descriptor.format_response(widget_data, response, message_id)
