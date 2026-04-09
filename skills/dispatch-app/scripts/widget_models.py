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
# progress_tracker widget type
# ---------------------------------------------------------------------------


class ProgressStep(BaseModel):
    label: str
    status: Literal["pending", "in_progress", "complete", "error"] = "pending"
    detail: str | None = None


class ProgressTrackerWidget(BaseModel):
    v: Literal[1] = 1
    type: Literal["progress_tracker"] = "progress_tracker"
    title: str | None = None
    steps: list[ProgressStep] = Field(min_length=1, max_length=10)


class ProgressTrackerDescriptor(WidgetDescriptor):
    widget_model = ProgressTrackerWidget
    response_model = BaseModel  # No response — display-only widget

    def cross_validate(self, widget: BaseModel, response: BaseModel) -> str | None:
        return None  # Display-only, no response validation

    def format_content(self, widget_data: dict) -> str:
        parts = []
        if widget_data.get("title"):
            parts.append(widget_data["title"])
        status_icons = {"pending": "⬜", "in_progress": "⏳", "complete": "✅", "error": "❌"}
        for step in widget_data["steps"]:
            icon = status_icons.get(step.get("status", "pending"), "⬜")
            line = f"{icon} {step['label']}"
            if step.get("detail"):
                line += f" — {step['detail']}"
            parts.append(line)
        return "\n".join(parts)

    def format_response(self, widget_data: dict, response: dict, message_id: str) -> str:
        # Display-only — should never be called, but handle gracefully
        return f"[Widget {message_id}] Progress tracker (display-only)"


# ---------------------------------------------------------------------------
# map_pin widget type
# ---------------------------------------------------------------------------


class MapPin(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str | None = None


class MapPinWidget(BaseModel):
    v: Literal[1] = 1
    type: Literal["map_pin"] = "map_pin"
    pins: list[MapPin] = Field(min_length=1, max_length=10)
    zoom: float = Field(default=14, ge=1, le=20)
    title: str | None = None


class MapPinDescriptor(WidgetDescriptor):
    widget_model = MapPinWidget
    response_model = BaseModel  # No response — display-only widget

    def cross_validate(self, widget: BaseModel, response: BaseModel) -> str | None:
        return None  # Display-only, no response validation

    def format_content(self, widget_data: dict) -> str:
        parts = []
        if widget_data.get("title"):
            parts.append(widget_data["title"])
        for pin in widget_data["pins"]:
            line = f"📍 {pin.get('label', 'Location')}: {pin['latitude']}, {pin['longitude']}"
            parts.append(line)
        return "\n".join(parts)

    def format_response(self, widget_data: dict, response: dict, message_id: str) -> str:
        # Display-only — should never be called, but handle gracefully
        return f"[Widget {message_id}] Map pin (display-only)"


# ---------------------------------------------------------------------------
# cooking_timeline widget type
# ---------------------------------------------------------------------------


class CookingDish(BaseModel):
    id: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=50)
    emoji: str = Field(min_length=1, max_length=4)


class CookingStep(BaseModel):
    id: str = Field(min_length=1, max_length=30)
    dish_id: str
    offset_min: int = Field(ge=0)
    action: str = Field(min_length=1, max_length=200)
    detail: str | None = Field(None, max_length=500)
    duration_min: int | None = Field(None, ge=1, le=480)
    type: Literal["active", "passive"]
    timer: bool | None = None
    checkpoint: str | None = Field(None, max_length=200)
    appliance: str | None = Field(None, max_length=30)

    def model_post_init(self, __context: object) -> None:
        # Auto-set timer=True for passive steps with duration
        if self.timer is None and self.type == "passive" and self.duration_min is not None:
            self.timer = True
        # Normalize appliance strings
        if self.appliance is not None:
            self.appliance = self.appliance.lower().strip().replace(" ", "")


class CookingTimelineWidget(BaseModel):
    v: Literal[1] = 1
    type: Literal["cooking_timeline"] = "cooking_timeline"
    title: str = Field(min_length=1, max_length=100)
    target_time: str | None = None
    total_duration_min: int = Field(ge=1, le=720)
    dishes: list[CookingDish] = Field(min_length=1, max_length=6)
    steps: list[CookingStep] = Field(min_length=1, max_length=40)

    def model_post_init(self, __context: object) -> None:
        dish_ids = {d.id for d in self.dishes}
        for step in self.steps:
            if step.dish_id not in dish_ids:
                raise ValueError(f"Step '{step.id}' references unknown dish '{step.dish_id}'")

        # Verify chronological ordering
        offsets = [s.offset_min for s in self.steps]
        if offsets != sorted(offsets):
            raise ValueError("Steps must be ordered by offset_min")

        # total_duration_min must be >= last step's offset_min
        max_offset = max(s.offset_min for s in self.steps)
        if self.total_duration_min < max_offset:
            raise ValueError(
                f"total_duration_min ({self.total_duration_min}) must be >= "
                f"last step offset ({max_offset})"
            )

        # No step end should exceed total_duration_min (with 5-min tolerance)
        for s in self.steps:
            if s.duration_min and (s.offset_min + s.duration_min) > self.total_duration_min + 5:
                raise ValueError(
                    f"Step '{s.id}' ends at T+{s.offset_min + s.duration_min} but "
                    f"total_duration is {self.total_duration_min}min"
                )

        # No overlapping active steps (two-hands constraint)
        active_steps = [
            (s.offset_min, s.offset_min + (s.duration_min or 1), s.id)
            for s in self.steps
            if s.type == "active"
        ]
        for i, (start_a, end_a, id_a) in enumerate(active_steps):
            for start_b, _end_b, id_b in active_steps[i + 1 :]:
                if start_b < end_a:
                    raise ValueError(
                        f"Active steps '{id_a}' (T+{start_a}-{end_a}) and '{id_b}' (T+{start_b}) "
                        f"overlap. A cook can't do two active things at once."
                    )

        # Appliance conflict check
        appliance_steps = [
            (s.offset_min, s.offset_min + (s.duration_min or 0), s.appliance, s.id)
            for s in self.steps
            if s.appliance and s.duration_min
        ]
        for i, (start_a, end_a, app_a, id_a) in enumerate(appliance_steps):
            for start_b, end_b, app_b, id_b in appliance_steps[i + 1 :]:
                if app_a == app_b and start_b < end_a:
                    raise ValueError(
                        f"Appliance conflict: '{id_a}' and '{id_b}' both use '{app_a}' "
                        f"at overlapping times (T+{start_a}-{end_a} vs T+{start_b}-{end_b}). "
                        f"Stagger timing or note shared usage in detail."
                    )


class CookingTimelineDescriptor(WidgetDescriptor):
    widget_model = CookingTimelineWidget
    response_model = BaseModel  # Display-only widget

    def cross_validate(self, widget: BaseModel, response: BaseModel) -> str | None:
        return None  # Display-only, no response validation

    def format_content(self, widget_data: dict) -> str:
        parts = []
        title = widget_data.get("title", "Cooking Timeline")
        total = widget_data.get("total_duration_min", "?")
        parts.append(f"🍽 {title} (~{total} min)")
        if widget_data.get("target_time"):
            parts.append(f"Target: {widget_data['target_time']}")
        dishes = {d["id"]: d for d in widget_data.get("dishes", [])}
        for step in widget_data.get("steps", []):
            dish = dishes.get(step["dish_id"], {})
            emoji = dish.get("emoji", "•")
            t = step.get("offset_min", 0)
            line = f"T+{t}: {emoji} {step['action']}"
            dur = step.get("duration_min")
            if dur:
                line += f" ({dur} min, {step.get('type', 'active')})"
            if step.get("checkpoint"):
                line += f" 📍 {step['checkpoint']}"
            parts.append(line)
        return "\n".join(parts)

    def format_response(self, widget_data: dict, response: dict, message_id: str) -> str:
        return f"[Widget {message_id}] Cooking timeline (display-only)"


# ---------------------------------------------------------------------------
# Registry - single registration point for all widget types
# ---------------------------------------------------------------------------

WIDGET_REGISTRY: dict[str, WidgetDescriptor] = {
    "ask_question": AskQuestionDescriptor(),
    "progress_tracker": ProgressTrackerDescriptor(),
    "map_pin": MapPinDescriptor(),
    "cooking_timeline": CookingTimelineDescriptor(),
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


def validate_and_dump_widget(widget_type: str, payload: dict) -> tuple[str | None, dict]:
    """Validate a widget payload and return (error, dumped_data).

    Unlike validate_widget, this returns the model's serialized dict which
    includes defaults and post_init mutations (e.g. timer=True on passive steps).
    """
    descriptor = WIDGET_REGISTRY.get(widget_type)
    if not descriptor:
        return f"Unknown widget type: {widget_type}", payload
    try:
        model = descriptor.widget_model(**payload)
    except ValidationError as e:
        return str(e), payload
    return None, model.model_dump()


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
