import { escapeHtml as escape } from "./html.js";

function rating(fingerprint, value) {
  const stars = [1, 2, 3, 4, 5]
    .map(
      (score) =>
        `<button data-rate="${fingerprint}" data-rating="${score}" class="${score <= value ? "active" : ""}" title="Rate ${score} out of 5">★</button>`,
    )
    .join("");
  return `<div class="exchange-rating" aria-label="Your rating">${stars}<small>YOUR RATING</small></div>`;
}

function proofBadge(entry) {
  if (!entry.package.verification.length) return "";
  const labels = {
      local: "✓ PROVEN ON THIS DEVICE",
      mixed: "◇ LOCAL + ATTACHED PROOF",
      attached: "◇ CHALLENGE PROOF ATTACHED",
    },
    trust = labels[entry.proofTrust] ? entry.proofTrust : "attached";
  return `<span class="exchange-proof ${trust}">${labels[trust]}</span>`;
}

export function renderBlueprintExchangeCard(entry) {
  const item = entry.package,
    metadata = item.metadata,
    dependency = item.dependencies,
    kindLabel =
      item.kind === "blueprint"
        ? "MACHINE"
        : dependency.partCount === 1
          ? "COMPONENT"
          : "SUBASSEMBLY",
    thumbnail = metadata.thumbnail
      ? `<img src="${metadata.thumbnail}" alt="Thumbnail for ${escape(metadata.title)}">`
      : `<div class="exchange-placeholder"><i>${item.kind === "blueprint" ? "▱" : dependency.partCount === 1 ? "◆" : "▦"}</i><span>${dependency.partCount} PARTS</span></div>`,
    lineage = item.provenance.parentFingerprint
      ? `<span class="exchange-lineage">REMIX ${item.provenance.remixDepth} · ${item.provenance.parentFingerprint.slice(-6).toUpperCase()}</span>`
      : '<span class="exchange-lineage">ORIGINAL</span>',
    tags = metadata.tags.map((tag) => `<span>${escape(tag)}</span>`).join(""),
    primary =
      item.kind === "blueprint"
        ? `<button data-load-share="${item.fingerprint}" class="primary">LOAD</button><button data-remix-share="${item.fingerprint}">REMIX</button>`
        : `<button data-install-share="${item.fingerprint}" class="primary">ADD TO MY PARTS</button>`;
  return `<article class="exchange-item" data-kind="${item.kind}" data-fingerprint="${item.fingerprint}">
    <div class="exchange-thumb">${thumbnail}${proofBadge(entry)}<span class="exchange-origin">${escape(entry.origin)}</span></div>
    <div class="exchange-card-body">
      <div class="exchange-item-head"><div><small>${kindLabel} · ${item.fingerprint.slice(-6).toUpperCase()}</small><h3>${escape(metadata.title)}</h3></div><button data-favorite="${item.fingerprint}" class="exchange-favorite ${entry.social.favorite ? "active" : ""}" title="Favorite">★</button></div>
      <p>${escape(metadata.description || "No description supplied.")}</p>
      <div class="exchange-tags">${tags || "<span>untagged</span>"}</div>
      <div class="exchange-credit"><span>${metadata.creator ? `BY ${escape(metadata.creator)}` : "CREATOR NOT LISTED"}</span>${lineage}</div>
      <div class="exchange-dependencies"><span>${dependency.partCount} PARTS</span><span>${dependency.connectionCount} LINKS</span><span>${dependency.componentTypes.length} TYPES</span>${item.verification.length ? `<span>${item.verification.length} PROOF${item.verification.length === 1 ? "" : "S"}</span>` : ""}</div>
      ${rating(item.fingerprint, entry.social.rating)}
      <div class="exchange-card-actions">${primary}<button data-download-share="${item.fingerprint}" title="Download package">↓ FILE</button><button data-link-share="${item.fingerprint}" title="Copy share link">⌁ LINK</button><button data-delete-share="${item.fingerprint}" class="danger" title="Remove from local Exchange">×</button></div>
    </div>
  </article>`;
}
