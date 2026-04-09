import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  AskQuestionWidgetData,
  FormResponse,
  QuestionAnswer,
} from "../api/types";
import { branding } from "../config/branding";
import { useWidgetState, clearWidgetState } from "../hooks/useWidgetState";

type WidgetState = "unanswered" | "pending" | "answered";

/** Per-question answer state */
interface QuestionState {
  selected: Set<string>;
  otherText: string;
}

/** Serializable draft state for persistence */
interface DraftState {
  answers: Array<{ selected: string[]; otherText: string }>;
}

function draftFromQuestionStates(states: QuestionState[]): DraftState {
  return { answers: states.map((s) => ({ selected: Array.from(s.selected), otherText: s.otherText })) };
}

function questionStatesFromDraft(draft: DraftState): QuestionState[] {
  return draft.answers.map((a) => ({ selected: new Set(a.selected), otherText: a.otherText }));
}

interface AskQuestionWidgetProps {
  data: AskQuestionWidgetData;
  messageId: string;
  chatId: string;
  response: FormResponse | null;
  onRespond: (response: FormResponse) => Promise<void>;
}

/** Rebuild QuestionState array from a saved FormResponse */
function stateFromResponse(
  data: AskQuestionWidgetData,
  response: FormResponse,
): QuestionState[] {
  const states: QuestionState[] = data.questions.map(() => ({
    selected: new Set<string>(),
    otherText: "",
  }));
  for (const answer of response.answers ?? []) {
    if (answer.question_index < states.length) {
      states[answer.question_index] = {
        selected: new Set(answer.selected),
        otherText: answer.other_text ?? "",
      };
    }
  }
  return states;
}

export function AskQuestionWidget({
  data,
  messageId,
  chatId,
  response,
  onRespond,
}: AskQuestionWidgetProps) {
  const [widgetState, setWidgetState] = useState<WidgetState>(
    response ? "answered" : "unanswered",
  );

  // Draft persistence — only used when unanswered (no server response yet)
  const emptyDraft: DraftState = {
    answers: data.questions.map(() => ({ selected: [], otherText: "" })),
  };
  const [draft, setDraft, draftLoaded] = useWidgetState<DraftState>(
    messageId,
    "ask_question",
    emptyDraft,
  );

  const [answers, setAnswers] = useState<QuestionState[]>(() =>
    response
      ? stateFromResponse(data, response)
      : data.questions.map(() => ({ selected: new Set<string>(), otherText: "" })),
  );

  // Restore draft on load (only if not already answered)
  useEffect(() => {
    if (!draftLoaded || response) return;
    // Check if draft has any selections
    const hasSelections = draft.answers.some((a) => a.selected.length > 0);
    if (hasSelections) {
      setAnswers(questionStatesFromDraft(draft));
    }
  }, [draftLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const isAnswered = widgetState === "answered";
  const isPending = widgetState === "pending";

  // Check if all questions have at least one selection
  const allAnswered = answers.every((a) => a.selected.size > 0);
  // Check if any question selected "Other" but has empty text
  const hasIncompleteOther = answers.some(
    (a, i) =>
      a.selected.has("Other") &&
      (data.questions[i]?.include_other ?? true) &&
      !a.otherText.trim(),
  );
  const canSave = allAnswered && !hasIncompleteOther;

  // Persist draft whenever answers change (debounced by the hook)
  const persistDraft = useCallback(
    (states: QuestionState[]) => {
      if (!response) {
        setDraft(draftFromQuestionStates(states));
      }
    },
    [response, setDraft],
  );

  const handleOptionPress = useCallback(
    (questionIndex: number, label: string) => {
      if (isAnswered || isPending) return;
      setError(null);

      setAnswers((prev) => {
        const next = [...prev];
        const q = data.questions[questionIndex];
        const isMulti = q?.multi_select ?? false;
        const current = next[questionIndex];

        if (isMulti) {
          // Toggle selection
          const newSelected = new Set(current.selected);
          if (newSelected.has(label)) {
            newSelected.delete(label);
          } else {
            newSelected.add(label);
          }
          next[questionIndex] = { ...current, selected: newSelected };
        } else {
          // Single-select: replace selection (radio behavior)
          const newSelected = new Set([label]);
          // Clear otherText if deselecting Other
          const otherText = label === "Other" ? current.otherText : "";
          next[questionIndex] = { ...current, selected: newSelected, otherText };
        }
        persistDraft(next);
        return next;
      });
    },
    [isAnswered, isPending, data.questions, persistDraft],
  );

  const handleOtherTextChange = useCallback(
    (questionIndex: number, text: string) => {
      if (isAnswered || isPending) return;
      setAnswers((prev) => {
        const next = [...prev];
        next[questionIndex] = { ...next[questionIndex], otherText: text };
        persistDraft(next);
        return next;
      });
    },
    [isAnswered, isPending, persistDraft],
  );

  const handleSave = useCallback(async () => {
    if (!canSave || isPending || isAnswered) return;
    setWidgetState("pending");
    setError(null);

    const formAnswers: QuestionAnswer[] = answers.map((a, i) => ({
      question_index: i,
      selected: Array.from(a.selected),
      other_text: a.selected.has("Other") ? a.otherText.trim() : undefined,
    }));

    try {
      await onRespond({ answers: formAnswers });
      setWidgetState("answered");
      // Clear persisted draft after successful submission
      clearWidgetState("ask_question", messageId);
    } catch {
      setWidgetState("unanswered");
      setError("Failed to send. Tap Save to retry.");
    }
  }, [canSave, isPending, isAnswered, answers, onRespond]);

  return (
    <View style={styles.container}>
      {data.questions.map((question, qIdx) => {
        const qState = answers[qIdx];
        const isMulti = question.multi_select ?? false;
        const showOther = question.include_other ?? true;

        return (
          <View key={qIdx} style={styles.questionBlock}>
            <Text style={styles.question}>{question.question}</Text>
            <View style={styles.options}>
              {question.options.map((option) => {
                const isSelected = qState.selected.has(option.label);
                const isCorrectAnswer = isAnswered && isSelected;

                return (
                  <Pressable
                    key={option.label}
                    onPress={() => handleOptionPress(qIdx, option.label)}
                    disabled={isAnswered || isPending}
                    style={[
                      styles.option,
                      isSelected && !isAnswered && styles.optionSelected,
                      isCorrectAnswer && styles.optionAnswered,
                      (isAnswered || isPending) && !isSelected && styles.optionDisabled,
                    ]}
                  >
                    <View style={styles.optionContent}>
                      <View style={styles.optionHeader}>
                        {isMulti ? (
                          <View
                            style={[
                              styles.checkbox,
                              isSelected && styles.checkboxChecked,
                            ]}
                          >
                            {isSelected && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.radio,
                              isSelected && styles.radioSelected,
                            ]}
                          >
                            {isSelected && <View style={styles.radioDot} />}
                          </View>
                        )}
                        <Text
                          style={[
                            styles.optionLabel,
                            isCorrectAnswer && styles.optionLabelAnswered,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </View>
                      {option.description ? (
                        <Text style={styles.optionDescription}>
                          {option.description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}

              {/* "Other" option */}
              {showOther && (
                <>
                  <Pressable
                    onPress={() => handleOptionPress(qIdx, "Other")}
                    disabled={isAnswered || isPending}
                    style={[
                      styles.option,
                      qState.selected.has("Other") && !isAnswered && styles.optionSelected,
                      isAnswered && qState.selected.has("Other") && styles.optionAnswered,
                      (isAnswered || isPending) && !qState.selected.has("Other") && styles.optionDisabled,
                    ]}
                  >
                    <View style={styles.optionContent}>
                      <View style={styles.optionHeader}>
                        {isMulti ? (
                          <View
                            style={[
                              styles.checkbox,
                              qState.selected.has("Other") && styles.checkboxChecked,
                            ]}
                          >
                            {qState.selected.has("Other") && (
                              <Text style={styles.checkmark}>✓</Text>
                            )}
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.radio,
                              qState.selected.has("Other") && styles.radioSelected,
                            ]}
                          >
                            {qState.selected.has("Other") && (
                              <View style={styles.radioDot} />
                            )}
                          </View>
                        )}
                        <Text
                          style={[
                            styles.optionLabel,
                            isAnswered && qState.selected.has("Other") && styles.optionLabelAnswered,
                          ]}
                        >
                          Other
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                  {/* Text input shown when "Other" is selected */}
                  {qState.selected.has("Other") && (
                    <View style={styles.otherInputContainer}>
                      {isAnswered ? (
                        <Text style={styles.otherAnsweredText}>
                          {qState.otherText}
                        </Text>
                      ) : (
                        <TextInput
                          style={styles.otherInput}
                          placeholder="Please specify..."
                          placeholderTextColor="#71717a"
                          value={qState.otherText}
                          onChangeText={(text) => handleOtherTextChange(qIdx, text)}
                          editable={!isAnswered && !isPending}
                          maxLength={500}
                          returnKeyType="done"
                          blurOnSubmit
                        />
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        );
      })}

      {/* Save button — always visible when unanswered */}
      {!isAnswered && (
        <Pressable
          onPress={handleSave}
          disabled={!canSave || isPending}
          style={[
            styles.saveButton,
            (!canSave || isPending) && styles.saveButtonDisabled,
          ]}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </Pressable>
      )}

      {error && (
        <Pressable onPress={() => setError(null)}>
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      )}

      {isAnswered && (
        <Text style={styles.answeredLabel}>✓ Answered</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    gap: 12,
  },
  questionBlock: {
    gap: 8,
  },
  question: {
    color: "#e4e4e7",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  options: {
    gap: 6,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  optionSelected: {
    borderColor: branding.accentColor,
    backgroundColor: "#3f3f46",
  },
  optionAnswered: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34, 197, 94, 0.1)",
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionContent: {
    flex: 1,
    gap: 2,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#71717a",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: branding.accentColor,
    borderColor: branding.accentColor,
  },
  checkmark: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: -1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#71717a",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: branding.accentColor,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: branding.accentColor,
  },
  optionLabel: {
    color: "#e4e4e7",
    fontSize: 15,
    fontWeight: "500",
  },
  optionLabelAnswered: {
    color: "#22c55e",
  },
  optionDescription: {
    color: "#a1a1aa",
    fontSize: 13,
    marginLeft: 26,
    lineHeight: 18,
  },
  otherInputContainer: {
    marginLeft: 12,
    marginRight: 4,
  },
  otherInput: {
    backgroundColor: "#27272a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#52525b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#e4e4e7",
    fontSize: 14,
  },
  otherAnsweredText: {
    color: "#22c55e",
    fontSize: 14,
    fontStyle: "italic",
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  saveButton: {
    backgroundColor: branding.accentColor,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    textAlign: "center",
  },
  answeredLabel: {
    color: "#22c55e",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 2,
  },
});
