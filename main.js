// Remove Queries -------------------------------------------------------------
const LOADING_QUERY = '[role="main"] svg[aria-valuetext="Loading..."], [role="progressbar"]';

// Consts and Params.
const STATUS = {
  CONTINUE: 'continue',
  ERROR: 'error',
  COMPLETE: 'complete',
};

let DELAY = 5;
const RUNNER_COUNT = 300;
const DEBUG_MODE = false; 

const currentURL = location.protocol + '//' + location.host + location.pathname;
const continueKey = 'shoot-the-messenger-continue' + currentURL;
const lastClearedKey = 'shoot-the-messenger-last-cleared' + currentURL;
const delayKey = 'shoot-the-messenger-delay' + currentURL;

let scrollerCache = null;
const clickCountPerElement = new Map();

// Helper functions ----------------------------------------------------------
function getRandom(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
  let randomizedSleep = getRandom(ms, ms * 1.2);
  return new Promise((resolve) => setTimeout(resolve, randomizedSleep));
}

function reload() {
  window.location = window.location.pathname;
}

// Dynamically climb the DOM to find the scrollable container
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
  const elementsToRemove = [];

  for (let [el, count] of clickCountPerElement) {
    if (count > 3) {
      elementsToRemove.push(el);
    }
  }

  getScroller().scrollTop = 0;
  await sleep(600);

  elementsToRemove.shift();
  elementsToRemove.reverse();
  
  for (let badEl of elementsToRemove) {
    await sleep(100);
    if (badEl) badEl.remove();
  }
}

async function getAllMessages() {
  const allMessages = Array.from(document.querySelectorAll('div[data-message-id]'));
  
  return allMessages.filter(el => {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const textContent = (el.textContent || '').toLowerCase(); 
    
    const isMine = label.includes('you');
    
    // STRICT EXCLUSION: Catches both "You unsent a message" and "You deleted a message"
    const isAlreadyUnsent = textContent.includes('unsent a message') || 
                            textContent.includes('deleted a message') || 
                            label.includes('unsent');
    
    return isMine && !isAlreadyUnsent;
  });
}

async function unsendAllVisibleMessages() {
  prepareDOMForRemoval();
  const rows = await getAllMessages();

  for (let el of rows.slice().reverse()) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100); // Wait for scroll to settle

    // Trigger hover state to make the "More" button appear
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await sleep(200); // Hover delay

    const moreButton = el.querySelector('[aria-label="More actions"], [aria-label="More"]');
    if (!moreButton) {
      continue;
    }
    
    moreButton.click();
    clickCountPerElement.set(el, (clickCountPerElement.get(el) ?? 0) + 1);
    await sleep(400); // Menu rendering delay

    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const removeMenuBtn = menuItems.find(b => {
      const text = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('remove') || text.includes('unsend');
    });

    if (!removeMenuBtn) {
      document.body.click(); 
      continue;
    }

    removeMenuBtn.click();
    
    // Wait for the confirmation modal to fully render
    await sleep(800); // Modal rendering delay

    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) {
      const dialogText = (dialog.textContent || '').toLowerCase();
      const dialogLabel = (dialog.getAttribute('aria-label') || '').toLowerCase();
      
      const isUnsendDialog = dialogText.includes('unsend') || dialogLabel.includes('unsend');
      
      const buttons = Array.from(dialog.querySelectorAll('[role="button"], button'));
      const cancelButton = buttons.find(b => {
          const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isHidden = b.getAttribute('aria-hidden') === 'true';
          const isDisabled = b.getAttribute('aria-disabled') === 'true';
          return text === 'cancel' && !isHidden && !isDisabled;
      });

      // ABSOLUTE FAIL-SAFE
      if (!isUnsendDialog) {
         console.log("Dialog is not an 'Unsend' dialog. Canceling to avoid removing tombstone.");
         if (cancelButton) cancelButton.click();
         await sleep(300);
         continue; 
      }

      // Explicitly select the "Unsend for everyone" radio button
      const labels = Array.from(dialog.querySelectorAll('label'));
      const unsendEveryoneLabel = labels.find(l => (l.textContent || '').toLowerCase().includes('unsend for everyone'));
      if (unsendEveryoneLabel) {
          unsendEveryoneLabel.click();
          await sleep(150);
      }
      
      const confirmButton = buttons.find(b => {
          const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isHidden = b.getAttribute('aria-hidden') === 'true';
          const isDisabled = b.getAttribute('aria-disabled') === 'true';
          return (text === 'remove' || text === 'unsend') && !isHidden && !isDisabled;
      });
      
      if (DEBUG_MODE || !confirmButton) {
        console.log("Clicking cancel...");
        if (cancelButton) cancelButton.click();
      } else {
        console.log("Clicking the final confirmation button...");
        confirmButton.click();

        await sleep(1000); // Network request time buffer
        
        // Handle secondary "Okay" modal if Facebook prompts it
        const okayDialog = document.querySelector('div[role="dialog"]');
        if (okayDialog) {
            const okayBtn = Array.from(okayDialog.querySelectorAll('[role="button"], button')).find(b => {
               const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
               return text === 'okay' && b.getAttribute('aria-hidden') !== 'true';
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
            return text === 'cancel' && b.getAttribute('aria-hidden') !== 'true';
        });
        if (cancelBtn) cancelBtn.click();
        await sleep(300);
    }
  }

  const scroller_ = getScroller();
  await sleep(1200); 
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
