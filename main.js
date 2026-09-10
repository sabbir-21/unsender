// ============================================================================
// ========================= USER CONFIGURATION AREA ==========================
// ============================================================================
const CONFIG = {
  // ⏱️ DELAYS (In milliseconds. 1000 = 1 second. Increase these if it glitches/misses)
  HOVER_DELAY: 150,            // Time to wait after hovering over a message
  MENU_RENDER_DELAY: 400,      // Time to wait for the 3-dots menu to open
  MODAL_RENDER_DELAY: 800,     // Time to wait for the central popup to appear
  NETWORK_REQUEST_DELAY: 1000, // Wait time after clicking "Remove" to let Facebook process
  SCROLL_WAIT_DELAY: 1200,     // Time to wait after scrolling to let old messages load
  MAX_RETRIES: 2,              // How many times it tries to delete a message before permanently skipping it

  // 🛑 EXCLUSIONS (Add text in lowercase here to completely skip certain messages)
  IGNORE_TEXTS: [
    'unsent a message',
    'deleted a message',
    'group audio call',
    'video call',
    'tap to join',
    'missed call'
  ],

  // 🔍 BUTTON & TEXT IDENTIFIERS (What the script looks for. Keep lowercase)
  MENU_UNSEND_TEXTS: ['remove', 'unsend'],
  DIALOG_UNSEND_IDENTIFIERS: ['unsend'],
  DIALOG_RADIO_TEXT: 'unsend for everyone',
  CONFIRM_BUTTON_TEXTS: ['remove', 'unsend'],
  CANCEL_BUTTON_TEXTS: ['cancel'],
  OKAY_BUTTON_TEXTS: ['okay']
};
// ============================================================================
// ============================================================================

const LOADING_QUERY = '[role="main"] svg[aria-valuetext="Loading..."], [role="progressbar"]';
const STATUS = { CONTINUE: 'continue', ERROR: 'error', COMPLETE: 'complete' };

let DELAY = 5;
const RUNNER_COUNT = 300;
const DEBUG_MODE = false; 

const currentURL = location.protocol + '//' + location.host + location.pathname;
const continueKey = 'shoot-the-messenger-continue' + currentURL;
const lastClearedKey = 'shoot-the-messenger-last-cleared' + currentURL;
const delayKey = 'shoot-the-messenger-delay' + currentURL;

let scrollerCache = null;
const clickCountPerId = new Map();
const blacklistedMessageIds = new Set(); // Memory storage that survives React refreshes

// Helper functions ----------------------------------------------------------
function getRandom(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, getRandom(ms, ms * 1.2)));
}

function getScroller() {
  if (scrollerCache) return scrollerCache;

  let el = document.querySelector('div[data-message-id]');
  while (el) {
    const style = window.getComputedStyle(el);
    if (el.scrollHeight > el.clientHeight && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
      scrollerCache = el;
      return el;
    }
    el = el.parentElement;
  }
  
  scrollerCache = document.documentElement;
  return scrollerCache;
}

// Removal functions ---------------------------------------------------------
async function prepareDOMForRemoval() {
  getScroller().scrollTop = 0;
  await sleep(600);
}

async function getAllMessages() {
  const allMessages = Array.from(document.querySelectorAll('div[data-message-id]'));
  
  return allMessages.filter(el => {
    const msgId = el.getAttribute('data-message-id');
    if (!msgId || blacklistedMessageIds.has(msgId)) return false; // Skip if blacklisted

    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const textContent = (el.textContent || '').toLowerCase(); 
    
    // Ensure it's your message
    const isMine = label.includes(' you:') || label.endsWith(' you') || label === 'you';
    
    // Check against the IGNORE list in CONFIG
    const shouldIgnore = CONFIG.IGNORE_TEXTS.some(ignoreText => 
        textContent.includes(ignoreText) || label.includes(ignoreText)
    );
    
    return isMine && !shouldIgnore;
  });
}

async function unsendAllVisibleMessages() {
  await prepareDOMForRemoval();
  const rows = await getAllMessages();

  for (let el of rows.slice().reverse()) {
    const msgId = el.getAttribute('data-message-id');
    
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100); 

    // Hover simulation
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await sleep(CONFIG.HOVER_DELAY); 

    const moreButton = el.querySelector('[aria-label="More actions"], [aria-label="More"]');
    if (!moreButton) {
      continue;
    }
    
    moreButton.click();
    
    // Track attempts by unique ID to prevent infinite loops
    const currentCount = (clickCountPerId.get(msgId) || 0) + 1;
    clickCountPerId.set(msgId, currentCount);
    if (currentCount > CONFIG.MAX_RETRIES) {
        console.log(`Blacklisting stuck message: ${msgId}`);
        blacklistedMessageIds.add(msgId);
    }
    
    await sleep(CONFIG.MENU_RENDER_DELAY); 

    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const removeMenuBtn = menuItems.find(b => {
      const text = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
      return CONFIG.MENU_UNSEND_TEXTS.some(t => text.includes(t));
    });

    if (!removeMenuBtn) {
      document.body.click(); 
      continue;
    }

    removeMenuBtn.click();
    await sleep(CONFIG.MODAL_RENDER_DELAY); 

    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) {
      const dialogText = (dialog.textContent || '').toLowerCase();
      const dialogLabel = (dialog.getAttribute('aria-label') || '').toLowerCase();
      
      const isUnsendDialog = CONFIG.DIALOG_UNSEND_IDENTIFIERS.some(t => dialogText.includes(t) || dialogLabel.includes(t));
      
      const buttons = Array.from(dialog.querySelectorAll('[role="button"], button'));
      const cancelButton = buttons.find(b => {
          const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isHidden = b.getAttribute('aria-hidden') === 'true';
          const isDisabled = b.getAttribute('aria-disabled') === 'true';
          return CONFIG.CANCEL_BUTTON_TEXTS.includes(text) && !isHidden && !isDisabled;
      });

      // FAIL-SAFE: If it's a "Remove for you" dialog, cancel and blacklist
      if (!isUnsendDialog) {
         console.log("Dialog is not an 'Unsend' dialog. Canceling and blacklisting element.");
         blacklistedMessageIds.add(msgId); // Permanently skip this element
         if (cancelButton) cancelButton.click();
         await sleep(300);
         continue; 
      }

      // Explicitly select the "Unsend for everyone" radio button
      const labels = Array.from(dialog.querySelectorAll('label'));
      const unsendEveryoneLabel = labels.find(l => (l.textContent || '').toLowerCase().includes(CONFIG.DIALOG_RADIO_TEXT));
      if (unsendEveryoneLabel) {
          unsendEveryoneLabel.click();
          await sleep(150);
      }
      
      const confirmButton = buttons.find(b => {
          const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isHidden = b.getAttribute('aria-hidden') === 'true';
          const isDisabled = b.getAttribute('aria-disabled') === 'true';
          return CONFIG.CONFIRM_BUTTON_TEXTS.includes(text) && !isHidden && !isDisabled;
      });
      
      if (DEBUG_MODE || !confirmButton) {
        console.log("Clicking cancel...");
        if (cancelButton) cancelButton.click();
      } else {
        console.log("Clicking the final confirmation button...");
        confirmButton.click();

        await sleep(CONFIG.NETWORK_REQUEST_DELAY); 
        
        // Handle secondary "Okay" modal if Facebook prompts it
        const okayDialog = document.querySelector('div[role="dialog"]');
        if (okayDialog) {
            const okayBtn = Array.from(okayDialog.querySelectorAll('[role="button"], button')).find(b => {
               const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
               return CONFIG.OKAY_BUTTON_TEXTS.includes(text) && b.getAttribute('aria-hidden') !== 'true';
            });
            if (okayBtn) {
               okayBtn.click();
               await sleep(300);
            }
        }
      }
    }
    
    // SAFETY NET: Force close any stuck modals
    const stuckDialog = document.querySelector('div[role="dialog"]');
    if (stuckDialog) {
        console.log("Dialog is stuck. Forcing close to prevent freezing.");
        const cancelBtn = Array.from(stuckDialog.querySelectorAll('[role="button"], button')).find(b => {
            const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
            return CONFIG.CANCEL_BUTTON_TEXTS.includes(text) && b.getAttribute('aria-hidden') !== 'true';
        });
        if (cancelBtn) cancelBtn.click();
        await sleep(300);
    }
  }

  const scroller_ = getScroller();
  await sleep(CONFIG.SCROLL_WAIT_DELAY); 
  if (!scroller_ || scroller_.scrollTop === 0) {
    return { status: STATUS.COMPLETE };
  }

  let loader = null;
  scroller_.scrollTop = 0;

  for (let i = 0; i < 5; ++i) {
    await sleep(1000);
    loader = document.querySelector(LOADING_QUERY);
    if (!loader) break;
  }

  return { status: STATUS.CONTINUE, data: Math.max(1000, DELAY * 1000) }; 
}

async function deleteAllRunner(count) {
  console.log('Starting delete all runner removal for N iterations: ', count);
  for (let i = 0; i < count; ++i) {
    console.log('Running count:', i);
    const sleepTime = await unsendAllVisibleMessages();
    if (sleepTime.status === STATUS.CONTINUE) {
      await sleep(sleepTime.data);
    } else if (sleepTime.status === STATUS.COMPLETE) {
      return STATUS.COMPLETE;
    } else {
      return STATUS.ERROR;
    }
  }
  console.log('Completed run.');
  return STATUS.CONTINUE;
}

function hijackLog() {
  if(document.getElementById('log')) return; 
  
  const log = document.createElement('div');
  log.id = 'log';
  log.style.position = 'fixed';
  log.style.bottom = '0';
  log.style.left = '0';
  log.style.backgroundColor = 'white';
  log.style.padding = '10px';
  log.style.zIndex = '10000';
  log.style.maxWidth = '200px';
  log.style.maxHeight = '500px';
  log.style.overflow = 'scroll';
  log.style.border = '1px solid black';
  log.style.fontSize = '12px';
  log.style.fontFamily = 'monospace';
  log.style.color = 'black';
  document.body.appendChild(log);

  const oldLog = console.log;
  console.log = function () {
    oldLog.apply(console, arguments);
    log.innerText += '\n' + Array.from(arguments).join(' ');
    log.scrollTop = log.scrollHeight;
  };
  return log;
}

async function removeHandler() {
  hijackLog();
  DELAY = localStorage.getItem(delayKey) ?? DELAY;
  await sleep(2000); 

  const status = await deleteAllRunner(RUNNER_COUNT);

  if (status === STATUS.COMPLETE) {
    localStorage.removeItem(continueKey);
    localStorage.setItem(lastClearedKey, new Date().toString());
    console.log('Success!');
    alert('Successfully cleared all messages!');
    return null;
  } else if (status === STATUS.CONTINUE) {
    console.log('Completed runner iteration but did not finish removal.');
    localStorage.setItem(continueKey, true);
    return alert('Reload');
  }

  console.log('Failed to complete removal.');
  alert('ERROR: something went wrong. Failed to complete removal.');
}

// Main ----------------------------------------------------------------------

if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) {
      if (console) {
        console.error('Cannot remove a child from a different parent', child, this);
      }
      return child;
    }
    return originalRemoveChild.apply(this, arguments);
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (console) {
        console.error('Cannot insert before a reference node from a different parent', referenceNode, this);
      }
      return newNode;
    }
    return originalInsertBefore.apply(this, arguments);
  };
}

(async function () {
  chrome.runtime.onMessage.addListener(async function (msg, sender) {
    if (document.documentElement.lang !== 'en') {
      alert('ERROR: detected non-English language. Shoot the Messenger only works when Facebook settings are set to English. Please change your profile settings and try again.');
      return;
    }

    console.log('Got action: ', msg.action);
    if (msg.action === 'REMOVE') {
      const doRemove = confirm(
        'Removal will unsend your messages. We HIGHLY recommend backing up your messages first. Continue?'
      );
      if (doRemove) {
        removeHandler();
      }
    } else if (msg.action === 'STOP') {
      localStorage.removeItem(continueKey);
    } else if (msg.action === 'UPDATE_DELAY') {
      console.log('Setting delay to', msg.data, 'seconds');
      localStorage.setItem(delayKey, msg.data);
    } else {
      console.log('Unknown action.');
    }
  });

  if (localStorage.getItem(continueKey)) {
    removeHandler();
  }
})();
