import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { branding } from "../config/branding";
import { suggestChatTitles } from "../api/chats";
import { impactLight } from "../utils/haptics";

interface RenameModalProps {
  visible: boolean;
  chatId: string;
  currentTitle: string;
  onSave: (title: string) => void;
  onClose: () => void;
}

export function RenameModal({
  visible,
  chatId,
  currentTitle,
  onSave,
  onClose,
}: RenameModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setTitle(currentTitle);
      setSuggestions([]);
      setSuggestionError(null);
      setShowModal(true);

      // Animate in
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 65,
            friction: 11,
          }),
          Animated.timing(backdropAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Focus input after animation
          inputRef.current?.focus();
        });
      });

      // Start fetching suggestions
      fetchSuggestions();
    } else {
      // Animate out
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 300,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setShowModal(false));
    }
  }, [visible]);

  const fetchSuggestions = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const result = await suggestChatTitles(chatId);
      if (result.titles?.length) {
        setSuggestions(result.titles);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate suggestions";
      setSuggestionError(msg.includes("timed out") ? "Timed out" : "Failed to suggest");
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [chatId]);

  const handleSave = useCallback(() => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== currentTitle) {
      onSave(trimmed);
    }
    onClose();
  }, [title, currentTitle, onSave, onClose]);

  const handleUseSuggestion = useCallback((suggestion: string) => {
    Keyboard.dismiss();
    impactLight();
    if (suggestion !== currentTitle) {
      onSave(suggestion);
    }
    onClose();
  }, [currentTitle, onSave, onClose]);

  if (!showModal) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Backdrop */}
        <Animated.View
          style={[styles.backdrop, { opacity: backdropAnim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        {/* Modal content */}
        <Animated.View
          style={[
            styles.content,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Text style={styles.title}>Rename Chat</Text>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Chat title..."
            placeholderTextColor="#71717a"
            selectionColor={branding.accentColor}
            autoFocus={false}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          {/* Suggestion chips — onStartShouldSetResponder prevents keyboard dismiss from eating the tap */}
          <View
            style={styles.suggestionRow}
            onStartShouldSetResponder={() => true}
          >
            {isLoadingSuggestions ? (
              <View style={styles.suggestionLoading}>
                <ActivityIndicator size="small" color="#71717a" />
                <Text style={styles.suggestionLoadingText}>
                  Generating suggestions...
                </Text>
              </View>
            ) : suggestions.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={styles.chipsContainer}
              >
                {suggestions.map((suggestion, index) => (
                  <Pressable
                    key={index}
                    style={({ pressed }) => [
                      styles.suggestionChip,
                      title === suggestion && styles.suggestionChipSelected,
                      pressed && styles.suggestionChipPressed,
                    ]}
                    onPress={() => handleUseSuggestion(suggestion)}
                  >
                    <Text
                      style={[
                        styles.suggestionChipText,
                        title === suggestion && styles.suggestionChipTextSelected,
                      ]}
                    >
                      {suggestion}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : suggestionError ? (
              <Text style={styles.suggestionErrorText}>{suggestionError}</Text>
            ) : null}
          </View>

          {/* Buttons */}
          <View style={styles.buttons}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onClose}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.saveButton,
                pressed && styles.saveButtonPressed,
              ]}
              onPress={handleSave}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  content: {
    backgroundColor: "#18181b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    color: "#fafafa",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#27272a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fafafa",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  suggestionRow: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: 8,
  },
  suggestionLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  suggestionLoadingText: {
    color: "#71717a",
    fontSize: 14,
  },
  suggestionErrorText: {
    color: "#ef4444",
    fontSize: 14,
    paddingVertical: 8,
  },
  chipsContainer: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#27272a",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#3f3f46",
  },
  suggestionChipSelected: {
    borderColor: branding.accentColor,
    backgroundColor: `${branding.accentColor}20`,
  },
  suggestionChipPressed: {
    backgroundColor: "#3f3f46",
  },
  suggestionChipText: {
    color: "#a1a1aa",
    fontSize: 14,
    fontWeight: "500",
  },
  suggestionChipTextSelected: {
    color: "#fafafa",
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cancelButton: {
    backgroundColor: "#27272a",
  },
  saveButton: {
    backgroundColor: branding.accentColor,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  cancelText: {
    color: "#a1a1aa",
    fontSize: 16,
    fontWeight: "600",
  },
  saveText: {
    color: "#fafafa",
    fontSize: 16,
    fontWeight: "600",
  },
});
