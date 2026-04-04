import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Animated,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,

  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  chatAdapter,
  useMessages,
  type DisplayMessage,
} from "@/src/hooks/useMessages";
import { MessageBubble } from "@/src/components/MessageBubble";
import { InputBar } from "@/src/components/InputBar";
import { DraftBubble } from "@/src/components/DraftBubble";
import { ThinkingIndicator } from "@/src/components/ThinkingIndicator";
import { EmptyState } from "@/src/components/EmptyState";
import { useAudioPlayer } from "@/src/hooks/useAudioPlayer";
import { useVoiceConversation } from "@/src/hooks/useVoiceConversation";
import { useSdkEvents } from "@/src/hooks/useSdkEvents";
import { updateChat, markChatAsOpened, forkChat, deleteChat, generateChatImage, restartSession, setChatModel, reactToMessage } from "@/src/api/chats";
import { ApiError } from "@/src/api/client";
import { startDebugSession } from "@/src/utils/debugSession";
import { screenStyles } from "@/src/styles/shared";
import { showPrompt, showAlert, showDestructiveConfirm } from "@/src/utils/alert";
import { branding, sessionPrefix } from "@/src/config/branding";
import { markChatAsRead } from "@/src/hooks/useChatList";
import { setActiveChatId, dismissNotificationsForChat } from "@/src/hooks/usePushNotifications";
import { impactMedium } from "@/src/utils/haptics";
import { BubbleMenu, type BubbleMenuItem } from "@/src/components/BubbleMenu";
import { Toast } from "@/src/components/Toast";
import { RenameModal } from "@/src/components/RenameModal";

export default function ChatDetailScreen() {
  const { id, chatTitle, chatModel } = useLocalSearchParams<{
    id: string;
    chatTitle?: string;
    chatModel?: string;
  }>();

  const [currentTitle, setCurrentTitle] = useState(chatTitle || id || "Chat");
  const [currentModel, setCurrentModel] = useState(chatModel || "opus");
  const modelLabel = currentModel || null;
  const adapter = useMemo(() => chatAdapter(id ?? ""), [id]);
  const { messages, isLoading, error, isThinking, sendMessage, sendMessageWithImage, retryMessage, toggleReaction } =
    useMessages(adapter, id ? `chat:${id}` : undefined);

  const audioPlayer = useAudioPlayer();
  const clearInputTextRef = useRef<(() => void) | null>(null);
  const voiceConversation = useVoiceConversation({
    chatId: id ?? "",
    onSend: sendMessage,
    messages,
    onClearText: () => clearInputTextRef.current?.(),
  });

  const [imageSendError, setImageSendError] = useState<string | null>(null);
  const [dictationDraft, setDictationDraft] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isCreatingDebugSession, setIsCreatingDebugSession] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const menuButtonRef = useRef<View>(null);

  // Message context menu (long-press)
  const [menuState, setMenuState] = useState<{ items: BubbleMenuItem[]; anchorY: number } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Optimistically mark as read, persist to server, and track active chat for push suppression
  useEffect(() => {
    if (id) {
      markChatAsRead(id);
      markChatAsOpened(id).catch(() => {}); // fire-and-forget server update
      setActiveChatId(id);
      dismissNotificationsForChat(id).catch(() => {});
    }
    return () => setActiveChatId(null);
  }, [id]);

  // Poll SDK events when thinking to show tool info
  // Use {sessionPrefix}:{chatId} format for the session_id so the server resolves the right session_name
  const sdkSessionId = useMemo(() => `${sessionPrefix}:${id ?? ""}`, [id]);

  const { events: sdkEvents, isComplete: sdkComplete } = useSdkEvents(sdkSessionId, isThinking);

  // Let server-driven isThinking control visibility — don't use sdkComplete.
  // sdkComplete was added speculatively (83d9a55) to hide the indicator faster,
  // but it races: SDK events poll (1000ms) detects turn completion before message
  // poll (1500ms) delivers the reply, causing ~500ms flicker.
  // INVARIANT: reply-app stores message (synchronous SQLite commit) before
  // ResultMessage triggers set_session_busy(False). Any poll reading
  // is_thinking=false will also see the reply. See sdk_session.py _receive_loop()
  // ResultMessage handler.
  const showThinking = isThinking;

  // Dev warning: detect stuck thinking indicator (isThinking true for >60s)
  useEffect(() => {
    if (!isThinking || !__DEV__) return;
    const timer = setTimeout(() => {
      console.warn("[thinking] indicator visible for 60s — possible stuck state");
    }, 60_000);
    return () => clearTimeout(timer);
  }, [isThinking]);


  // Inverted FlatList: data is reversed so newest messages appear at the bottom.
  // FlatList with inverted=true renders from the bottom up, so we reverse the array.
  const invertedMessages = useMemo(
    () => [...messages].reverse(),
    [messages],
  );

  const handleSend = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  const handleSendWithImage = useCallback(
    async (text: string, imageUri: string) => {
      setImageSendError(null);
      try {
        await sendMessageWithImage(text, imageUri, id ?? "voice");
      } catch (err) {
        setImageSendError(
          err instanceof Error ? err.message : "Failed to send image",
        );
      }
    },
    [id, sendMessageWithImage],
  );

  const handleRename = useCallback(() => {
    setRenameModalVisible(true);
  }, []);

  const handleRenameSave = useCallback(async (newTitle: string) => {
    try {
      await updateChat(id ?? "", newTitle);
      setCurrentTitle(newTitle);
    } catch (err) {
      showAlert("Error", err instanceof Error ? err.message : "Failed to rename chat");
    }
  }, [id]);

  const handleFork = useCallback(async () => {
    const forkTitle = await showPrompt("Fork Chat", "Title for the forked chat:", `${currentTitle} (fork)`);
    if (!forkTitle) return;
    setIsForking(true);
    try {
      const forked = await forkChat(id ?? "", forkTitle);
      router.push({
        pathname: "/chat/[id]",
        params: { id: forked.id, chatTitle: forked.title },
      });
    } catch (err) {
      showAlert("Error", err instanceof Error ? err.message : "Failed to fork chat");
    } finally {
      setIsForking(false);
    }
  }, [id, currentTitle]);

  const handleDebugChat = useCallback(async () => {
    const context = await showPrompt(
      "Debug Chat",
      "Describe the issue you're seeing:",
    );
    if (!context?.trim()) return;
    setIsCreatingDebugSession(true);
    try {
      const result = await startDebugSession(id ?? "", currentTitle, context.trim());
      router.push({
        pathname: "/agents/[id]",
        params: {
          id: result.id,
          sessionName: result.name,
          sessionSource: "dispatch-api",
          sessionType: "dispatch-api",
          backTitle: "Chat",
        },
      });
      if (result.warning) {
        // Show non-blocking warning after navigation settles
        InteractionManager.runAfterInteractions(() =>
          showAlert("Warning", result.warning!),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showAlert("Error", `Failed to create debug session: ${msg}`);
    } finally {
      setIsCreatingDebugSession(false);
    }
  }, [id, currentTitle]);

  const handleRestartSession = useCallback(async () => {
    const confirmed = await showDestructiveConfirm(
      "Restart Session",
      "Restart the Claude session? It will pick up context from the conversation history.",
      "Restart",
    );
    if (!confirmed) return;
    try {
      await restartSession(id ?? "voice");
      showAlert("Success", "Session restarted.");
    } catch {
      showAlert("Error", "Failed to restart session.");
    }
  }, [id]);

  const handleChangeModel = useCallback(() => {
    const models = ["opus", "sonnet", "haiku"];
    const options = [...models.map(m => m === currentModel ? `${m} ✓` : m), "Cancel"];
    const cancelIndex = options.length - 1;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, title: "Change Model" },
        async (index) => {
          if (index === cancelIndex) return;
          const selected = models[index];
          if (selected === currentModel) return;
          try {
            await setChatModel(id ?? "", selected);
            setCurrentModel(selected);
            showAlert("Model Changed", `Switched to ${selected}. Session will restart.`);
          } catch {
            showAlert("Error", "Failed to change model.");
          }
        },
      );
    }
  }, [id, currentModel]);

  const handleDelete = useCallback(async () => {
    const confirmed = await showDestructiveConfirm(
      "Delete Chat",
      `Delete "${currentTitle}" and all its messages? This can't be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteChat(id ?? "");
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    } catch (err) {
      showAlert("Error", err instanceof Error ? err.message : "Failed to delete chat");
    }
  }, [id, currentTitle]);

  const handleGenerateImage = useCallback(async () => {
    try {
      await generateChatImage(id ?? "");
      showAlert("Generating", "Creating a cover image for this chat. This usually takes 30-60 seconds — it will appear in the chat list when ready.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        showAlert("Please Wait", "Server is busy, please try again in a moment");
      } else if (err instanceof ApiError && err.status === 400) {
        showAlert("Error", "This chat needs messages before generating an image");
      } else {
        showAlert("Error", err instanceof Error ? err.message : "Failed to start image generation");
      }
    }
  }, [id]);

  const handleMessageLongPress = useCallback(
    (items: BubbleMenuItem[], pageY: number) => {
      impactMedium();
      // Wrap "Copy" actions to show toast
      const wrappedItems = items.map((item) =>
        item.label === "Copy"
          ? { ...item, onPress: () => { item.onPress(); setToastMsg("Copied!"); } }
          : item,
      );
      setMenuState({ items: wrappedItems, anchorY: pageY });
    },
    [],
  );

  // Old handleCopyMessage removed — copy is now handled by BubbleMenu items

  const handleMenuPress = useCallback(() => {
    menuButtonRef.current?.measureInWindow((x, y, width, height) => {
      setMenuPosition({ x: x + width - 160, y: y + height + 8 });
      setMenuVisible(true);
    });
  }, []);

  const headerRight = useCallback(
    () => (
      <Pressable
        ref={menuButtonRef}
        onPress={handleMenuPress}
        hitSlop={8}
        style={localStyles.menuButton}
      >
        <SymbolView
          name={{ ios: "ellipsis.circle", android: "more_vert", web: "more_vert" }}
          tintColor={branding.accentColor}
          size={22}
          weight="medium"
        />
      </Pressable>
    ),
    [handleMenuPress],
  );

  // Find last delivered user message to show "Delivered" indicator (like iMessage)
  const lastDeliveredUserMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user" && !m.isPending && !m.sendFailed) return m.id;
    }
    return null;
  }, [messages]);

  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      // Optimistic UI update — instant feedback
      toggleReaction(messageId, emoji);
      try {
        await reactToMessage(messageId, emoji);
      } catch {
        // Revert on failure
        toggleReaction(messageId, emoji);
      }
    },
    [toggleReaction],
  );

  const renderItem = useCallback(
    ({ item }: { item: DisplayMessage }) => (
      <MessageBubble
        message={item}
        chatId={id}
        audioState={audioPlayer}
        onRetry={retryMessage}
        onLongPress={handleMessageLongPress}
        onReact={handleReact}
        showDelivered={item.id === lastDeliveredUserMsgId}
      />
    ),
    [audioPlayer, retryMessage, handleMessageLongPress, handleReact, lastDeliveredUserMsgId],
  );

  const keyExtractor = useCallback((item: DisplayMessage) => item.id, []);


  return (
    <>
      <Stack.Screen
        options={{
          title: currentTitle,
          headerTitle: () => (
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fafafa", fontSize: 17, fontWeight: "600" }} numberOfLines={1}>
                {currentTitle}
              </Text>
              {modelLabel ? (
                <Text style={{ color: "#71717a", fontSize: 12, marginTop: 1 }}>
                  {modelLabel}
                </Text>
              ) : null}
            </View>
          ),
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(tabs)");
                }
              }}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", marginLeft: 0, paddingHorizontal: 4, gap: 4 }}
            >
              <SymbolView
                name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
                tintColor="#3b82f6"
                size={18}
                weight="semibold"
                style={{ width: 12, height: 20 }}
              />
              <Text style={{ color: "#3b82f6", fontSize: 17 }}>Chats</Text>
            </Pressable>
          ),
          headerStyle: { backgroundColor: "#09090b" },
          headerTintColor: "#fafafa",
          headerShadowVisible: false,
          headerRight,
        }}
      />
      <KeyboardAvoidingView
        style={screenStyles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >

        {/* Show transient errors (image send failures, connection issues) */}
        {(imageSendError || (error && messages.length > 0)) ? (
          <View style={screenStyles.errorBanner}>
            <Text style={screenStyles.errorBannerText}>
              {imageSendError || error}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={screenStyles.loadingContainer}>
            <ActivityIndicator color="#71717a" size="small" />
          </View>
        ) : error && messages.length === 0 ? (
          <View style={screenStyles.errorContainer}>
            <Text style={screenStyles.errorText}>{error}</Text>
          </View>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            subtitle="Send a message to start the conversation"
          />
        ) : (
          <FlatList
            data={invertedMessages}
            inverted
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={screenStyles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={showThinking ? <ThinkingIndicator events={sdkEvents} visible={showThinking} /> : null}
          />
        )}
        {dictationDraft !== null && <DraftBubble text={dictationDraft} />}
        {voiceConversation.isActive && voiceConversation.voiceState === "LISTENING" && voiceConversation.sttPartial ? (
          <DraftBubble text={voiceConversation.sttPartial} />
        ) : null}
        <InputBar
          onSend={handleSend}
          onSendWithImage={handleSendWithImage}
          chatId={`${sessionPrefix}:${id}`}
          voiceConversation={voiceConversation}
          clearTextRef={clearInputTextRef}
          onDictationDraft={setDictationDraft}
        />
      </KeyboardAvoidingView>

      {/* Dropdown menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={localStyles.menuOverlay}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={[
              localStyles.menuDropdown,
              { top: menuPosition.y, left: menuPosition.x },
            ]}
          >
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                // Short delay for menu dismiss animation before showing rename modal
                setTimeout(handleRename, 200);
              }}
            >
              <SymbolView
                name={{ ios: "pencil", android: "edit", web: "edit" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Rename</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed, (isForking || messages.length === 0) && { opacity: 0.5 }]}
              disabled={isForking || messages.length === 0}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(handleFork, 600);
              }}
            >
              <SymbolView
                name={{ ios: "arrow.triangle.branch", android: "fork_right", web: "fork_right" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>{isForking ? "Forking..." : "Fork"}</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                router.push({
                  pathname: "/chat/notes",
                  params: { id, chatTitle: currentTitle },
                });
              }}
            >
              <SymbolView
                name={{ ios: "note.text", android: "description", web: "description" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Notes</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                InteractionManager.runAfterInteractions(handleGenerateImage);
              }}
            >
              <SymbolView
                name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Generate Chat Image</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed, isCreatingDebugSession && { opacity: 0.5 }]}
              disabled={isCreatingDebugSession}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(handleDebugChat, 600);
              }}
            >
              <SymbolView
                name={{ ios: "ant", android: "bug_report", web: "bug_report" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Debug Chat</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(handleRestartSession, 400);
              }}
            >
              <SymbolView
                name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Restart Session</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(handleChangeModel, 400);
              }}
            >
              <SymbolView
                name={{ ios: "cpu", android: "memory", web: "memory" }}
                tintColor="#fafafa"
                size={16}
              />
              <Text style={localStyles.menuItemText}>Model: {currentModel}</Text>
            </Pressable>
            <View style={localStyles.menuDivider} />
            <Pressable
              style={({ pressed }) => [localStyles.menuItem, pressed && localStyles.menuItemPressed]}
              onPress={() => {
                setMenuVisible(false);
                InteractionManager.runAfterInteractions(handleDelete);
              }}
            >
              <SymbolView
                name={{ ios: "trash", android: "delete", web: "delete" }}
                tintColor="#ef4444"
                size={16}
              />
              <Text style={[localStyles.menuItemText, { color: "#ef4444" }]}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Inline bubble context menu (long-press) */}
      {menuState && (
        <BubbleMenu
          items={menuState.items}
          anchorY={menuState.anchorY}
          onClose={() => setMenuState(null)}
        />
      )}
      <Toast
        message={toastMsg || ""}
        icon="checkmark"
        visible={!!toastMsg}
        onHide={() => setToastMsg(null)}
      />

      <RenameModal
        visible={renameModalVisible}
        chatId={id ?? ""}
        currentTitle={currentTitle}
        onSave={handleRenameSave}
        onClose={() => setRenameModalVisible(false)}
      />

      {isCreatingDebugSession && (
        <View style={localStyles.debugLoadingOverlay}>
          <View style={localStyles.debugLoadingBox}>
            <ActivityIndicator color="#007AFF" size="small" />
            <Text style={localStyles.debugLoadingText}>Creating debug session…</Text>
          </View>
        </View>
      )}
    </>
  );
}

const localStyles = StyleSheet.create({
  menuButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  menuOverlay: {
    flex: 1,
  },
  menuDropdown: {
    position: "absolute",
    width: 160,
    backgroundColor: "#2a2a2e",
    borderRadius: 12,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  contextMenu: {
    position: "absolute",
    alignSelf: "center",
    left: "50%",
    marginLeft: -80,
    width: 160,
    backgroundColor: "#2a2a2e",
    borderRadius: 12,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemPressed: {
    backgroundColor: "#3f3f46",
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#3f3f46",
    marginHorizontal: 12,
  },
  menuItemText: {
    color: "#fafafa",
    fontSize: 16,
  },
  copiedToast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1c1c1e",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#34d39940",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  copiedToastText: {
    color: "#fafafa",
    fontSize: 15,
    fontWeight: "600",
  },
  debugLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  debugLoadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#2a2a2e",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
  },
  debugLoadingText: {
    color: "#fafafa",
    fontSize: 15,
  },
});
