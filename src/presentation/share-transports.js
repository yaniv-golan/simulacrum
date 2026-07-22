import { MAX_SHARE_BYTES } from "../model/share-packages.js";
import {
  decodeSharePayload,
  encodeSharePayload,
  parseSharedText,
  readShareUrl,
} from "../model/share-codec.js";

export async function createShareUrl(value, location = window.location) {
  const encoded = await encodeSharePayload(value),
    base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#share=${encoded}`;
}

export {
  decodeSharePayload,
  encodeSharePayload,
  parseSharedText,
  readShareUrl,
};

export async function readShareFile(file) {
  if (!file) throw new Error("Choose a Simulacrum package first");
  if (
    !String(file.name || "")
      .toLowerCase()
      .endsWith(".simshare")
  )
    throw new Error("Choose a current .simshare package");
  if (file.size > MAX_SHARE_BYTES)
    throw new Error("Shared design exceeds the 2 MB safety limit");
  return JSON.parse(await file.text());
}

function safeFilename(value) {
  return (
    String(value || "simulacrum-design")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "simulacrum-design"
  );
}

export function downloadSharePackage(value, documentRef = document) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/vnd.simulacrum.share+json",
    }),
    url = URL.createObjectURL(blob),
    link = documentRef.createElement("a");
  link.href = url;
  link.download = `${safeFilename(value.metadata?.title)}.simshare`;
  documentRef.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyText(value, navigatorRef = navigator) {
  if (!navigatorRef.clipboard?.writeText)
    throw new Error("Clipboard access is unavailable; copy from the text box");
  await navigatorRef.clipboard.writeText(value);
}

export function captureBlueprintThumbnail(
  sourceCanvas,
  documentRef = document,
) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return "";
  const canvas = documentRef.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d"),
    scale = Math.max(
      canvas.width / sourceCanvas.width,
      canvas.height / sourceCanvas.height,
    ),
    width = sourceCanvas.width * scale,
    height = sourceCanvas.height * scale;
  context.fillStyle = "#071314";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    sourceCanvas,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
  const thumbnail = canvas.toDataURL("image/jpeg", 0.7);
  return thumbnail.length <= 90_000 ? thumbnail : "";
}
