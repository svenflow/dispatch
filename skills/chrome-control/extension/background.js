// Chrome Control - Background Service Worker
// Native messaging bridge for local automation
// Full feature parity with Claude Chrome MCP

const NATIVE_HOST_NAME = 'com.dispatch.chrome_control';
let port = null;
let reconnectTimeout = null;

// Track managed tabs and console/network data
const managedTabs = new Map();
const consoleMessages = new Map(); // tabId -> messages[]
const networkRequests = new Map(); // tabId -> requests[]

// Connect to native messaging host
function connectNativeHost() {
  if (port) return;

  console.log('[ChromeControl] Connecting to native host:', NATIVE_HOST_NAME);

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    port.onMessage.addListener(async (message) => {
      console.log('[ChromeControl] Received:', message);

      if (message.type === 'ready') {
        console.log('[ChromeControl] Native host ready');

        // Get or create a unique profile ID (stored per-profile in chrome.storage.local)
        const getOrCreateProfileId = async () => {
          const result = await chrome.storage.local.get(['profileId']);
          if (result.profileId) {
            return result.profileId;
          }
          // Generate new UUID for this profile
          const newId = crypto.randomUUID();
          await chrome.storage.local.set({ profileId: newId });
          return newId;
        };

        // Get profile name from identity API, with fallback
        const getProfileName = () => new Promise((resolve) => {
          try {
            chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
              if (chrome.runtime.lastError || !userInfo?.email) {
                resolve(null);
              } else {
                resolve(userInfo.email.split('@')[0]);
              }
            });
          } catch (e) {
            resolve(null);
          }
        });

        // Send ready with unique profile ID
        Promise.all([getOrCreateProfileId(), getProfileName()]).then(([profileId, profileName]) => {
          console.log('[ChromeControl] Registering with profileId:', profileId, 'name:', profileName);
          port.postMessage({
            type: 'extension_ready',
            extensionId: profileId,  // Use unique per-profile ID instead of chrome.runtime.id
            profileName: profileName,
            tabs: Array.from(managedTabs.entries()).map(([id, info]) => ({ id, ...info }))
          });
        });
        return;
      }

      if (message.type === 'reload') {
        console.log('[ChromeControl] Reload requested by native host - reloading extension');
        chrome.runtime.reload();
        return;
      }

      if (message.command) {
        try {
          const result = await handleCommand(message);
          if (message.id) {
            port.postMessage({ type: 'response', id: message.id, result });
          }
        } catch (error) {
          console.error('[ChromeControl] Error:', error);
          if (message.id) {
            port.postMessage({ type: 'response', id: message.id, error: error.message });
          }
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[ChromeControl] Disconnected:', chrome.runtime.lastError?.message);
      port = null;
      scheduleReconnect();
    });

  } catch (error) {
    console.error('[ChromeControl] Connection failed:', error);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimeout) {
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connectNativeHost();
    }, 5000);
  }
}

// Command handler - Full MCP parity
async function handleCommand(message) {
  const { command, params } = message;

  switch (command) {
    // Basic
    case 'ping':
      return { pong: true, timestamp: Date.now() };

    case 'profile_info':
      return await (async () => {
        const stored = await chrome.storage.local.get(['profileId']);
        return new Promise((resolve) => {
          chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (userInfo) => {
            resolve({
              email: userInfo?.email || null,
              googleId: userInfo?.id || null,
              profileId: stored.profileId || null,
              extensionId: chrome.runtime.id,
              error: chrome.runtime.lastError?.message || null
            });
          });
        });
      })();

    // Tab management
    case 'tabs_context':
      return await getTabsContext();

    case 'tabs_create':
      return await createTab(params?.url);

    case 'open_tab':
      return await openTab(params.url);

    case 'close_tab':
      return await closeTab(params.tabId);

    case 'list_tabs':
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title })) };

    // Navigation
    case 'navigate':
      return await navigateTab(params.tabId, params.url);

    // Page reading
    case 'read_page':
      return await readPage(params.tabId, params.filter, params.depth, params.ref_id);

    case 'find':
      return await findElements(params.tabId, params.query);

    case 'get_page_text':
      return await executeScript(params.tabId, 'document.body.innerText');

    case 'get_page_html':
      return await executeScript(params.tabId, 'document.documentElement.outerHTML');

    // Interaction
    case 'click':
      return await executeInTab(params.tabId, 'click', params);

    case 'click_ref':
      return await clickByRef(params.tabId, params.ref);

    case 'click_at':
      return await clickAtCoordinates(params.tabId, params.x, params.y);

    case 'double_click':
      return await doubleClickAt(params.tabId, params.x, params.y);

    case 'type':
      return await executeInTab(params.tabId, 'type', params);

    case 'key':
      return await sendKey(params.tabId, params.key, params.modifiers);

    case 'insert_text':
      return await insertText(params.tabId, params.text);

    case 'iframe_click':
      return await iframeClick(params.tabId, params.selector);

    case 'iframe_type':
      return await iframeType(params.tabId, params.text);

    case 'iframe_debug':
      return await iframeDebug(params.tabId);

    case 'form_input':
      return await setFormValue(params.tabId, params.ref, params.value);

    case 'scroll':
      return await scroll(params.tabId, params.direction, params.amount, params.x, params.y);

    case 'scroll_to':
      return await scrollToElement(params.tabId, params.ref);

    case 'hover':
      return await hoverAt(params.tabId, params.x, params.y);

    // Screenshots
    case 'screenshot':
      return await takeScreenshot(params.tabId, message.id);

    case 'zoom':
      return await zoomScreenshot(params.tabId, params.region, message.id);

    // JavaScript execution
    case 'eval':
    case 'javascript':
      return await executeScript(params.tabId, params.code || params.text);

    // Window management
    case 'resize_window':
      return await resizeWindow(params.tabId, params.width, params.height);

    case 'focus_tab':
      return await focusTab(params.tabId);

    // Console and Network
    case 'read_console':
      return await readConsole(params.tabId, params.pattern, params.limit, params.clear);

    case 'read_network':
      return await readNetwork(params.tabId, params.urlPattern, params.limit, params.clear);

    // Advanced - Debugger based
    case 'get_accessibility_tree':
      return await getAccessibilityTree(params.tabId);

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Tab management
async function getTabsContext() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return {
    tabs: tabs.map(t => ({
      tabId: t.id,
      title: t.title,
      url: t.url,
      active: t.active
    }))
  };
}

async function createTab(url) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  return { tabId: tab.id, url: tab.url };
}

async function openTab(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  managedTabs.set(tab.id, { url, status: 'loading' });

  return new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        managedTabs.set(tab.id, { url, status: 'ready' });
        resolve({ tabId: tab.id, url, status: 'ready' });
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ tabId: tab.id, url, status: 'timeout' });
    }, 30000);
  });
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  managedTabs.delete(tabId);
  consoleMessages.delete(tabId);
  networkRequests.delete(tabId);
  return { closed: true };
}

async function navigateTab(tabId, url) {
  if (url === 'back') {
    await chrome.tabs.goBack(tabId);
  } else if (url === 'forward') {
    await chrome.tabs.goForward(tabId);
  } else {
    await chrome.tabs.update(tabId, { url });
  }
  return { navigated: true, url };
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { focused: true };
}

// Page reading
async function readPage(tabId, filter = 'all', depth = 15, refId = null) {
  const result = await executeInTab(tabId, 'get_elements', { filter, depth, refId });
  return result;
}

async function findElements(tabId, query) {
  const result = await executeInTab(tabId, 'find', { query });
  return result;
}

// Execute in content script
async function executeInTab(tabId, action, params) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action, params });
    if (response.success) {
      return response.result;
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    // Content script might not be loaded, inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 100));
    const response = await chrome.tabs.sendMessage(tabId, { action, params });
    if (response.success) {
      return response.result;
    }
    throw new Error(response.error);
  }
}

// Execute arbitrary script
async function executeScript(tabId, code) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (code) => {
      try {
        return eval(code);
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [code],
    world: 'MAIN'
  });
  return results?.[0]?.result;
}

// Click by element ref
async function clickByRef(tabId, ref) {
  return await executeInTab(tabId, 'click', { selector: ref });
}

// Click at coordinates using debugger
async function clickAtCoordinates(tabId, x, y) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });

    await chrome.debugger.detach({ tabId });
    return { clicked: true, x, y };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { clicked: false, error: error.message };
  }
}

async function doubleClickAt(tabId, x, y) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 2
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 2
    });

    await chrome.debugger.detach({ tabId });
    return { clicked: true, x, y, double: true };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { clicked: false, error: error.message };
  }
}

async function hoverAt(tabId, x, y) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y
    });

    await chrome.debugger.detach({ tabId });
    return { hovered: true, x, y };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { hovered: false, error: error.message };
  }
}

// Keyboard
async function sendKey(tabId, key, modifiers) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    const keyEvent = {
      type: 'keyDown',
      key: key,
      code: key,
      modifiers: 0
    };

    if (modifiers) {
      if (modifiers.includes('ctrl')) keyEvent.modifiers |= 2;
      if (modifiers.includes('alt')) keyEvent.modifiers |= 1;
      if (modifiers.includes('shift')) keyEvent.modifiers |= 8;
      if (modifiers.includes('meta') || modifiers.includes('cmd')) keyEvent.modifiers |= 4;
    }

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', keyEvent);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...keyEvent, type: 'keyUp' });

    await chrome.debugger.detach({ tabId });
    return { sent: true, key };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { sent: false, error: error.message };
  }
}

// Insert text via debugger using Page.getFrameTree to find iframes
async function insertText(tabId, text) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    // Enable Page domain to access frame tree
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

    // Get frame tree
    const frameTree = await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree');
    console.log('[ChromeControl] Frame tree:', JSON.stringify(frameTree, null, 2));

    // Find iframe with Apple sign-in
    let targetFrameId = null;
    const findFrame = (frame) => {
      const url = frame.frame?.url || '';
      console.log('[ChromeControl] Checking frame:', url);
      if (url.includes('idmsa.apple.com') || url.includes('signin.apple.com')) {
        targetFrameId = frame.frame?.id;
        console.log('[ChromeControl] Found Apple auth frame:', targetFrameId);
        return true;
      }
      if (frame.childFrames) {
        for (const child of frame.childFrames) {
          if (findFrame(child)) return true;
        }
      }
      return false;
    };
    findFrame(frameTree.frameTree);

    // For typing, we need to use a different approach:
    // Create an isolated world in the iframe and execute JS there
    if (targetFrameId) {
      // Create isolated world in the iframe
      const isolatedWorld = await chrome.debugger.sendCommand({ tabId }, 'Page.createIsolatedWorld', {
        frameId: targetFrameId,
        worldName: 'chromeControlWorld',
        grantUniveralAccess: true
      });
      const executionContextId = isolatedWorld.executionContextId;
      console.log('[ChromeControl] Created isolated world:', executionContextId);

      // Execute JS to type into the focused input
      // Handle both single inputs and multi-input 2FA code fields
      const script = `
        // Check for multi-input 2FA code fields first
        const allInputs = document.querySelectorAll('input');
        const codeInputs = document.querySelectorAll('input.form-security-code-input, input[type="tel"], input.code-input');
        const textToType = '${text.replace(/'/g, "\\'")}';

        // Debug info
        const debugInfo = {
          totalInputs: allInputs.length,
          codeInputs: codeInputs.length,
          inputClasses: Array.from(allInputs).map(i => i.className).join(', ')
        };

        if (codeInputs.length >= 6) {
          // Multi-input 2FA field - fill each input with one character
          const digits = textToType.split('');
          let filled = 0;
          Array.from(codeInputs).slice(0, digits.length).forEach((input, i) => {
            input.focus();
            // Use proper event simulation for React components
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, digits[i]);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Also try KeyboardEvent
            input.dispatchEvent(new KeyboardEvent('keydown', { key: digits[i], bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keypress', { key: digits[i], bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: digits[i], bubbles: true }));
            filled++;
          });
          JSON.stringify({ result: 'filled ' + filled + ' code inputs', ...debugInfo });
        } else if (codeInputs.length === 1) {
          // Single code input field (accepts all digits)
          const input = codeInputs[0];
          input.focus();
          input.value = textToType;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          JSON.stringify({ result: 'typed into single code input', ...debugInfo });
        } else {
          // Generic input field
          const input = document.activeElement || document.querySelector('input[type="text"], input[type="email"], input:not([type])');
          if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) {
            input.focus();
            input.value = textToType;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            JSON.stringify({ result: 'typed into generic input', className: input.className, ...debugInfo });
          } else {
            JSON.stringify({ result: 'no input found', activeElement: document.activeElement?.tagName, ...debugInfo });
          }
        }
      `;

      const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: script,
        contextId: executionContextId,
        returnByValue: true
      });
      console.log('[ChromeControl] Eval result:', result);

      await chrome.debugger.detach({ tabId });
      return { inserted: true, text, frameId: targetFrameId, evalResult: result?.result?.value };
    } else {
      // No iframe found, type directly using Input.dispatchKeyEvent on main page
      for (const char of text) {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
          key: char
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char
        });
        await new Promise(r => setTimeout(r, 10));
      }
      await chrome.debugger.detach({ tabId });
      return { inserted: true, text, frameId: null, note: 'no iframe found, used main page' };
    }
  } catch (error) {
    console.error('[ChromeControl] insertText error:', error);
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { inserted: false, error: error.message };
  }
}

// Debug iframe contents
async function iframeDebug(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

    const frameTree = await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree');

    let targetFrameId = null;
    const findFrame = (frame) => {
      const url = frame.frame?.url || '';
      if (url.includes('idmsa.apple.com') || url.includes('signin.apple.com')) {
        targetFrameId = frame.frame?.id;
        return true;
      }
      if (frame.childFrames) {
        for (const child of frame.childFrames) {
          if (findFrame(child)) return true;
        }
      }
      return false;
    };
    findFrame(frameTree.frameTree);

    if (targetFrameId) {
      const isolatedWorld = await chrome.debugger.sendCommand({ tabId }, 'Page.createIsolatedWorld', {
        frameId: targetFrameId,
        worldName: 'chromeControlDebug',
        grantUniveralAccess: true
      });

      const script = `
        const allInputs = document.querySelectorAll('input');
        const result = {
          totalInputs: allInputs.length,
          inputs: Array.from(allInputs).map(i => ({
            type: i.type,
            name: i.name,
            id: i.id,
            className: i.className,
            maxLength: i.maxLength,
            value: i.value
          }))
        };
        JSON.stringify(result, null, 2);
      `;

      const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: script,
        contextId: isolatedWorld.executionContextId,
        returnByValue: true
      });

      await chrome.debugger.detach({ tabId });
      return { debug: JSON.parse(result?.result?.value || '{}') };
    } else {
      await chrome.debugger.detach({ tabId });
      return { error: 'iframe not found' };
    }
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { error: error.message };
  }
}

// Type into iframe using debugger key events
async function iframeType(tabId, text) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    // Type each character using Input.dispatchKeyEvent
    for (const char of text) {
      // Key down with text
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: char,
        text: char,
        unmodifiedText: char,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      // Char event
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'char',
        key: char,
        text: char,
        unmodifiedText: char
      });
      // Key up
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: char.charCodeAt(0)
      });
      await new Promise(r => setTimeout(r, 50));
    }

    await chrome.debugger.detach({ tabId });
    return { typed: true, text };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { typed: false, error: error.message };
  }
}

// Click element in iframe via isolated world
async function iframeClick(tabId, selector) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

    const frameTree = await chrome.debugger.sendCommand({ tabId }, 'Page.getFrameTree');

    // Find Apple auth iframe
    let targetFrameId = null;
    const findFrame = (frame) => {
      const url = frame.frame?.url || '';
      if (url.includes('idmsa.apple.com') || url.includes('signin.apple.com')) {
        targetFrameId = frame.frame?.id;
        return true;
      }
      if (frame.childFrames) {
        for (const child of frame.childFrames) {
          if (findFrame(child)) return true;
        }
      }
      return false;
    };
    findFrame(frameTree.frameTree);

    if (targetFrameId) {
      const isolatedWorld = await chrome.debugger.sendCommand({ tabId }, 'Page.createIsolatedWorld', {
        frameId: targetFrameId,
        worldName: 'chromeControlClickWorld',
        grantUniveralAccess: true
      });

      // More robust click: dispatch full mouse event sequence + focus + click
      // Also supports text:XXX selector to click by text content
      const script = `
        const selector = '${selector.replace(/'/g, "\\'")}';
        let el = null;

        // Check if it's a text selector
        if (selector.startsWith('text:')) {
          const searchText = selector.substring(5).toLowerCase();
          const allClickable = document.querySelectorAll('button, [role="button"], input[type="submit"], a, [onclick]');
          for (const candidate of allClickable) {
            const text = (candidate.textContent || candidate.value || '').toLowerCase().trim();
            if (text.includes(searchText)) {
              el = candidate;
              break;
            }
          }
        } else {
          el = document.querySelector(selector);
        }

        if (el) {
          // Focus first
          el.focus();

          // Get element center for coordinates
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          // Create proper mouse event options
          const eventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1
          };

          // Dispatch full mouse event sequence
          el.dispatchEvent(new MouseEvent('mouseenter', eventInit));
          el.dispatchEvent(new MouseEvent('mouseover', eventInit));
          el.dispatchEvent(new MouseEvent('mousemove', eventInit));
          el.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, buttons: 1 }));
          el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));

          // Also try the native click as backup
          el.click();

          JSON.stringify({
            success: true,
            text: el.textContent.trim().substring(0, 50),
            tagName: el.tagName,
            type: el.type || null,
            id: el.id || null,
            className: el.className || null
          });
        } else {
          // Try to find buttons with similar text
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a'));
          const buttonTexts = allButtons.map(b => b.textContent?.trim().substring(0, 30) || b.value || '').filter(t => t);
          JSON.stringify({
            success: false,
            error: 'element not found: ' + selector,
            availableButtons: buttonTexts.slice(0, 10)
          });
        }
      `;

      const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: script,
        contextId: isolatedWorld.executionContextId,
        returnByValue: true
      });

      await chrome.debugger.detach({ tabId });

      let parsedResult;
      try {
        parsedResult = JSON.parse(result?.result?.value || '{}');
      } catch {
        parsedResult = { raw: result?.result?.value };
      }

      return { clicked: parsedResult.success !== false, result: parsedResult };
    } else {
      await chrome.debugger.detach({ tabId });
      return { clicked: false, error: 'iframe not found' };
    }
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { clicked: false, error: error.message };
  }
}

// Form input
async function setFormValue(tabId, ref, value) {
  return await executeInTab(tabId, 'set_value', { selector: ref, value });
}

// Scrolling
async function scroll(tabId, direction, amount = 3, x, y) {
  const scrollAmount = amount * 100;
  let deltaX = 0, deltaY = 0;

  switch (direction) {
    case 'up': deltaY = -scrollAmount; break;
    case 'down': deltaY = scrollAmount; break;
    case 'left': deltaX = -scrollAmount; break;
    case 'right': deltaX = scrollAmount; break;
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: x || 400,
      y: y || 400,
      deltaX,
      deltaY
    });

    await chrome.debugger.detach({ tabId });
    return { scrolled: true, direction, amount };
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { scrolled: false, error: error.message };
  }
}

async function scrollToElement(tabId, ref) {
  return await executeInTab(tabId, 'scroll_to', { selector: ref });
}

// Screenshot
async function takeScreenshot(tabId, requestId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await new Promise(r => setTimeout(r, 100));

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });

  const base64Data = dataUrl.split(',')[1];

  // Use larger chunks (200KB) and add delays to prevent service worker suspension
  const CHUNK_SIZE = 200000;
  const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);

  console.log(`[ChromeControl] Sending ${totalChunks} screenshot chunks`);

  for (let i = 0; i < totalChunks; i++) {
    // Check port is still valid
    if (!port) {
      throw new Error('Native host disconnected during screenshot');
    }

    const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    try {
      port.postMessage({
        type: 'screenshot_chunk',
        requestId,
        index: i,
        total: totalChunks,
        data: chunk,
        format: 'jpeg'
      });
      console.log(`[ChromeControl] Sent chunk ${i + 1}/${totalChunks}`);
    } catch (e) {
      console.error(`[ChromeControl] Failed to send chunk ${i + 1}:`, e);
      throw e;
    }

    // Small delay between chunks to prevent overwhelming native messaging
    if (i < totalChunks - 1) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  console.log('[ChromeControl] All chunks sent');
  return { screenshotChunked: true, chunks: totalChunks };
}

async function zoomScreenshot(tabId, region, requestId) {
  // For zoom, we capture full and crop on client side
  // Just return the region info with screenshot
  const result = await takeScreenshot(tabId, requestId);
  result.region = region;
  return result;
}

// Window resize
async function resizeWindow(tabId, width, height) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { width, height });
  return { resized: true, width, height };
}

// Console and Network monitoring
async function readConsole(tabId, pattern, limit = 100, clear = false) {
  const messages = consoleMessages.get(tabId) || [];
  let filtered = messages;

  if (pattern) {
    const regex = new RegExp(pattern, 'i');
    filtered = messages.filter(m => regex.test(m.text));
  }

  if (limit) {
    filtered = filtered.slice(-limit);
  }

  if (clear) {
    consoleMessages.set(tabId, []);
  }

  return { messages: filtered };
}

async function readNetwork(tabId, urlPattern, limit = 100, clear = false) {
  const requests = networkRequests.get(tabId) || [];
  let filtered = requests;

  if (urlPattern) {
    filtered = requests.filter(r => r.url.includes(urlPattern));
  }

  if (limit) {
    filtered = filtered.slice(-limit);
  }

  if (clear) {
    networkRequests.set(tabId, []);
  }

  return { requests: filtered };
}

// Accessibility tree via debugger
async function getAccessibilityTree(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    const tree = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
    await chrome.debugger.detach({ tabId });
    return tree;
  } catch (error) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { error: error.message };
  }
}

// Initialize
connectNativeHost();

// Set up keepalive alarm to prevent service worker suspension
function setupKeepaliveAlarm() {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // ~24 seconds
}

chrome.runtime.onStartup.addListener(() => {
  connectNativeHost();
  setupKeepaliveAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  connectNativeHost();
  setupKeepaliveAlarm();
});

// Handle keepalive alarm - prevents service worker termination
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (port) {
      try {
        port.postMessage({ type: 'heartbeat' });
        console.log('[ChromeControl] Keepalive heartbeat sent');
      } catch (e) {
        console.log('[ChromeControl] Heartbeat failed, reconnecting');
        port = null;
        connectNativeHost();
      }
    } else {
      console.log('[ChromeControl] No port, reconnecting');
      connectNativeHost();
    }
  }
});

// Initial alarm setup
setupKeepaliveAlarm();

// Listen for console messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'console_message' && sender.tab) {
    const tabId = sender.tab.id;
    if (!consoleMessages.has(tabId)) {
      consoleMessages.set(tabId, []);
    }
    consoleMessages.get(tabId).push(message.data);
  }
});
