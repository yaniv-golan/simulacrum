import { createDialogClose, createDialogHeader } from './dialog-close.mjs';
/**
 * What's new since this device's last visit. Notes are injected (they live in the
 * application layer); this owns the Help badge, the retrievable Help section and the
 * one automatic surface: a non-modal notice shown once per new notes head. It is a
 * section with role=dialog, never a <dialog>, because any open dialog silences every
 * workshop key; keys reach the notice only while focus is inside it.
 */
export const STORAGE_KEY = 'simulacrum-whats-new-v1';
const RETENTION_DAYS = 366;
const el = (tag, text = '', cls = '') => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (text, run) => {
  const b = el('button', text);
  b.type = 'button';
  b.onclick = run;
  return b;
};

/** Entries newer than the stored cursor, newest first. An unknown cursor (a rollback
 * served notes without it) is a first visit, never "everything is new". */
export function unseenNotes(notes, cursor) {
  if (cursor === null || cursor === undefined) return { firstVisit: true, unseen: [] };
  const index = notes.findIndex((note) => note.id === cursor);
  if (index < 0) return { firstVisit: true, unseen: [] };
  return { firstVisit: false, unseen: notes.slice(0, index) };
}

/** A throwing read means this browser is not remembering visits; the failure stays
 * visible to the caller instead of nagging the player on every load. */
export function readCursor(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { mode: 'unavailable', cursor: null };
  }
  try {
    const record = raw ? JSON.parse(raw) : null;
    const cursor = typeof record?.seenId === 'string' ? record.seenId : null;
    return { mode: 'available', cursor };
  } catch {
    return { mode: 'available', cursor: null };
  }
}

export function writeCursor(storage, record) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Pure mount decision. `write` on a first visit records the newest id; on an open it
 * records the notice as seen at the moment it is shown. */
export function planConsider({ mode, firstVisit, unseen, gateReason }) {
  if (mode !== 'available') return { badge: false, open: false, write: false };
  if (firstVisit) return { badge: false, open: false, write: true };
  if (unseen.length === 0) return { badge: false, open: false, write: false };
  const open = gateReason === null || gateReason === undefined;
  return { badge: true, open, write: open };
}

export function createWhatsNew({
  root,
  helpButton,
  help,
  insertBefore,
  notes,
  storage,
  buildId,
  learnButton,
  findExample,
  openExamples,
  gate,
}) {
  const newest = notes[0] ?? null;
  const cutoff = newest
    ? new Date(Date.parse(newest.date) - RETENTION_DAYS * 86400000).toISOString().slice(0, 10)
    : '';
  const shown = notes.filter((note) => note.date >= cutoff);
  let { mode, cursor } = readCursor(storage);
  let { firstVisit, unseen } = unseenNotes(notes, cursor);
  let writeFailed = false,
    attempted = false,
    disposed = false,
    badge = false;
  const record = () => {
    writeFailed = !writeCursor(storage, {
      seenId: newest.id,
      seenBuildId: buildId,
      seenAt: new Date().toISOString(),
    });
    cursor = newest.id;
    ({ firstVisit, unseen } = unseenNotes(notes, cursor));
  };

  // Help badge: the state is described; the button's name stays "Help".
  const badgeDot = el('span', '', 'whats-new-badge');
  badgeDot.setAttribute('aria-hidden', 'true');
  const badgeText = el('span', 'New since your last visit', 'sr-only');
  badgeText.id = 'whats-new-badge-text';
  const showBadge = () => {
    if (badge) return;
    badge = true;
    // The description lives outside the button so its accessible name stays "Help".
    helpButton.append(badgeDot);
    helpButton.after(badgeText);
    helpButton.setAttribute('aria-describedby', badgeText.id);
    helpButton.classList.add('has-whats-new');
  };
  const hideBadge = () => {
    if (!badge) return;
    badge = false;
    badgeDot.remove();
    badgeText.remove();
    helpButton.removeAttribute('aria-describedby');
    helpButton.classList.remove('has-whats-new');
  };

  // Retrievable Help section.
  const section = el('section', '', 'whats-new');
  const status = el('p', '', 'whats-new-status');
  const list = el('ol', '', 'whats-new-list');
  const seen = el('details', '', 'whats-new-seen');
  const seenList = el('ol', '', 'whats-new-list');
  seen.append(el('summary', 'Seen before'), seenList);
  section.append(el('h3', 'What’s new'), status, list, seen);
  help.insertBefore(section, insertBefore);
  const storageSentence = 'This browser is not saving which changes you have seen.';
  const entry = (note, withTry) => {
    const item = el('li');
    const time = el('time', note.date);
    time.setAttribute('datetime', note.date);
    item.append(el('h4', note.name), time, el('p', note.summary));
    if (withTry && note.example) {
      // The card's own launcher runs, so the Build-only rule and the replacement
      // confirmation behave exactly as from Learn & examples.
      const launch = findExample(note.example);
      const tryIt = button('Try it', () => {
        help.close();
        openExamples();
        launch.click();
      });
      item.append(tryIt);
      if (!launch) {
        tryIt.disabled = true;
        item.append(el('small', 'Leave the guided build first.', 'whats-new-note'));
      }
    }
    return item;
  };
  function renderSection() {
    list.replaceChildren();
    seenList.replaceChildren();
    if (mode !== 'available') {
      status.textContent = storageSentence;
      status.hidden = false;
      for (const note of shown) list.append(entry(note, true));
      list.hidden = false;
      seen.hidden = true;
      return;
    }
    const unseenIds = new Set(unseen.map((note) => note.id));
    const fresh = shown.filter((note) => unseenIds.has(note.id));
    const problem = writeFailed ? ` ${storageSentence}` : '';
    status.textContent = fresh.length
      ? problem.trim()
      : `Nothing new since your last visit.${problem}`;
    status.hidden = !status.textContent;
    for (const note of fresh) list.append(entry(note, true));
    list.hidden = !fresh.length;
    for (const note of shown) if (!unseenIds.has(note.id)) seenList.append(entry(note, true));
    seen.hidden = !seenList.childElementCount;
  }

  // The automatic notice.
  const notice = el('section', '', 'whats-new-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'dialog');
  notice.setAttribute('aria-label', 'What’s new');
  notice.dataset.partHelpInput = '';
  notice.tabIndex = -1;
  const noticeList = el('ol', '', 'whats-new-list');
  const noticeActions = el('div', '', 'whats-new-actions');
  notice.append(
    createDialogHeader(
      el('h2', 'What’s new'),
      createDialogClose('Close what’s new', () => closeNotice()),
    ),
    noticeList,
    noticeActions,
  );
  root.append(notice);
  const outside = (event) => {
    if (!notice.contains(event.target)) closeNotice();
  };
  notice.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeNotice();
    }
  };
  function openNotice() {
    if (disposed) return;
    noticeList.replaceChildren(...unseen.map((note) => entry(note, false)));
    noticeActions.replaceChildren();
    // At most one invitation, to existing admitted content, never per entry.
    if (unseen.some((note) => note.example))
      noticeActions.append(
        button('Open Learn & examples', () => {
          learnButton.click();
          closeNotice();
        }),
      );
    notice.hidden = false;
    document.addEventListener('pointerdown', outside, true);
    notice.focus();
    record();
    renderSection();
  }
  function closeNotice() {
    if (notice.hidden) return;
    const inside = notice.contains(document.activeElement);
    notice.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
    hideBadge();
    if (inside) helpButton.focus();
  }
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY || !newest) return;
    try {
      if (JSON.parse(event.newValue)?.seenId !== newest.id) return;
    } catch {
      return;
    }
    cursor = newest.id;
    ({ firstVisit, unseen } = unseenNotes(notes, cursor));
    closeNotice();
    hideBadge();
    renderSection();
  };
  window.addEventListener('storage', onStorage);

  /** Once per mount, after every mount-time surface has had its chance to open. A gate
   * naming an open dialog is re-checked once that dialog closes; any other gate reason
   * leaves the badge only until the next clean mount. */
  function consider() {
    if (attempted || disposed || !newest) return;
    const blocked = gate();
    const plan = planConsider({ mode, firstVisit, unseen, gateReason: blocked?.reason ?? null });
    if (plan.badge) showBadge();
    if (plan.open) {
      attempted = true;
      openNotice();
    } else if (plan.write) {
      attempted = true;
      record();
      renderSection();
    } else if (blocked?.dialog)
      blocked.dialog.addEventListener('close', () => consider(), { once: true });
    else attempted = true;
  }
  /** Opening Help counts as seeing the notes; the notice, if open, gives way. */
  function markSeen() {
    if (mode === 'available' && !firstVisit && unseen.length) record();
    closeNotice();
    hideBadge();
    renderSection();
  }
  renderSection();
  return {
    consider,
    markSeen,
    read: () => ({
      mode,
      firstVisit,
      unseenIds: unseen.map((note) => note.id),
      badge,
      noticeOpen: !notice.hidden,
      writeFailed,
    }),
    dispose() {
      disposed = true;
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('pointerdown', outside, true);
      notice.remove();
      section.remove();
    },
  };
}
