// Chrome Control - Content Script
// Element discovery and interaction with full MCP parity

console.log('[ChromeControl] Content script loaded:', window.location.href);

const elementMap = new Map();
let elementCounter = 0;

// Generate accessibility tree
function generateElementTree(filter = 'interactive', maxDepth = 15, rootRefId = null) {
  elementMap.clear();
  elementCounter = 0;
  const results = [];

  function getRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;

    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');

    const roleMap = {
      'a': 'link',
      'button': 'button',
      'input': type === 'submit' || type === 'button' ? 'button' :
               type === 'checkbox' ? 'checkbox' :
               type === 'radio' ? 'radio' : 'textbox',
      'select': 'combobox',
      'textarea': 'textbox',
      'img': 'image',
      'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
      'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'form': 'form',
      'table': 'table',
      'tr': 'row',
      'td': 'cell',
      'th': 'columnheader',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem',
    };

    return roleMap[tag] || 'generic';
  }

  function getLabel(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    const title = el.getAttribute('title');
    if (title) return title.trim();

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();

    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();

    if (el.tagName === 'INPUT' && el.value && el.value.length < 50) {
      return el.value.trim();
    }

    if (['BUTTON', 'A', 'SPAN', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName)) {
      const text = el.textContent?.trim();
      if (text && text.length < 100) return text;
    }

    return '';
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true;
    if (el.getAttribute('onclick') || el.getAttribute('role') === 'button') return true;
    if (el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1') return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (window.getComputedStyle(el).cursor === 'pointer') return true;
    return false;
  }

  function processElement(el, depth = 0) {
    if (depth > maxDepth) return;

    const tag = el.tagName?.toLowerCase();
    if (!tag || ['script', 'style', 'meta', 'link', 'noscript', 'svg', 'path'].includes(tag)) return;

    const visible = isVisible(el);
    const interactive = isInteractive(el);

    if (filter === 'interactive' && !interactive) {
      for (const child of el.children) processElement(child, depth);
      return;
    }

    if (!visible) return;

    const role = getRole(el);
    const label = getLabel(el);

    if (role === 'generic' && !label && filter !== 'all') {
      for (const child of el.children) processElement(child, depth);
      return;
    }

    const refId = `ref_${++elementCounter}`;
    elementMap.set(refId, el);

    const rect = el.getBoundingClientRect();

    const entry = {
      ref: refId,
      role,
      label: label || undefined,
      tag,
      href: el.getAttribute('href') || undefined,
      type: el.getAttribute('type') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      value: el.value || undefined,
      checked: el.checked || undefined,
      disabled: el.disabled || undefined,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };

    Object.keys(entry).forEach(k => {
      if (entry[k] === undefined || entry[k] === false) delete entry[k];
    });
    results.push(entry);

    for (const child of el.children) processElement(child, depth + 1);
  }

  // If rootRefId specified, start from that element
  let startEl = document.body;
  if (rootRefId && elementMap.has(rootRefId)) {
    startEl = elementMap.get(rootRefId);
  }

  processElement(startEl);
  return results;
}

// Find elements by natural language query
function findByQuery(query) {
  const queryLower = query.toLowerCase();
  const results = [];

  // Build element tree first
  const elements = generateElementTree('all', 10);

  for (const entry of elements) {
    const el = elementMap.get(entry.ref);
    if (!el) continue;

    let score = 0;
    const label = (entry.label || '').toLowerCase();
    const role = (entry.role || '').toLowerCase();

    // Exact match
    if (label === queryLower) score += 100;
    // Contains match
    else if (label.includes(queryLower)) score += 50;
    // Role match
    if (role.includes(queryLower)) score += 30;
    // Class/id match
    if (el.className?.toLowerCase().includes(queryLower)) score += 20;
    if (el.id?.toLowerCase().includes(queryLower)) score += 20;

    if (score > 0) {
      results.push({ ...entry, score });
    }
  }

  // Sort by score and return top 20
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

// Find element by ref or selector
function findElement(query) {
  if (query.startsWith('ref_')) {
    return elementMap.get(query);
  }

  try {
    const el = document.querySelector(query);
    if (el) return el;
  } catch {}

  // Text match
  const allElements = document.querySelectorAll('a, button, input, [role="button"], [aria-label]');
  for (const el of allElements) {
    const text = el.textContent?.trim().toLowerCase() || '';
    const label = el.getAttribute('aria-label')?.toLowerCase() || '';
    if (text.includes(query.toLowerCase()) || label.includes(query.toLowerCase())) {
      return el;
    }
  }

  return null;
}

// Click element
async function clickElement(selector) {
  const el = findElement(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 100));

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventInit = {
    view: window, bubbles: true, cancelable: true,
    clientX: x, clientY: y, screenX: x, screenY: y,
    button: 0, buttons: 1
  };

  el.dispatchEvent(new MouseEvent('mousedown', eventInit));
  el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  el.dispatchEvent(new MouseEvent('click', eventInit));

  return { clicked: true, element: selector };
}

// Type into element
async function typeIntoElement(selector, text, options = {}) {
  const el = findElement(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  el.focus();
  await new Promise(r => setTimeout(r, 50));

  if (options.clear) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  el.value = (options.clear ? '' : el.value) + text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (options.submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const form = el.closest('form');
    if (form) form.submit();
  }

  return { typed: true, element: selector, text };
}

// Set form value (for checkboxes, selects, etc.)
async function setFormValue(selector, value) {
  const el = findElement(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type');

  if (tag === 'select') {
    // Find option by value or text
    for (const opt of el.options) {
      if (opt.value === value || opt.text === value) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { set: true, value: opt.value };
      }
    }
    throw new Error(`Option not found: ${value}`);
  }

  if (type === 'checkbox' || type === 'radio') {
    const shouldCheck = value === true || value === 'true' || value === 1;
    if (el.checked !== shouldCheck) {
      el.click();
    }
    return { set: true, checked: el.checked };
  }

  // Default: set value
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { set: true, value };
}

// Scroll to element
async function scrollToElement(selector) {
  const el = findElement(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { scrolled: true, element: selector };
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, params } = message;

  (async () => {
    try {
      let result;

      switch (action) {
        case 'get_elements':
          result = {
            elements: generateElementTree(
              params?.filter || 'interactive',
              params?.depth || 15,
              params?.refId
            )
          };
          break;

        case 'find':
          result = { elements: findByQuery(params.query) };
          break;

        case 'click':
          result = await clickElement(params.selector);
          break;

        case 'type':
          result = await typeIntoElement(params.selector, params.text, params.options);
          break;

        case 'set_value':
          result = await setFormValue(params.selector, params.value);
          break;

        case 'scroll':
          window.scrollBy(params.x || 0, params.y || 0);
          result = { scrolled: true };
          break;

        case 'scroll_to':
          result = await scrollToElement(params.selector);
          break;

        case 'get_page_info':
          result = { url: window.location.href, title: document.title };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// Intercept console messages
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

['log', 'warn', 'error', 'info'].forEach(method => {
  console[method] = function(...args) {
    originalConsole[method].apply(console, args);
    try {
      chrome.runtime.sendMessage({
        type: 'console_message',
        data: {
          level: method,
          text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
          timestamp: Date.now()
        }
      });
    } catch {}
  };
});

chrome.runtime.sendMessage({ type: 'content_script_ready', url: window.location.href });
