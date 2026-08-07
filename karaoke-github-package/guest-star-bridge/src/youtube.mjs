import { spawn } from "node:child_process";

function youtubeVideoKey(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" && url.pathname === "/watch") {
      return url.searchParams.get("v") || "";
    }
    if (host === "youtu.be") return url.pathname.replace(/^\/+/, "").split("/")[0];
    return "";
  } catch {
    return "";
  }
}

export function selectYoutubeOptions(items, limit = 6) {
  const candidates = Array.isArray(items) ? items : [];
  const seen = new Set();
  const maximum = Math.min(10, Math.max(1, Number(limit) || 6));
  const priority = (item) => {
    const value = Number(item?.channelPriority);
    return Number.isFinite(value) && value > 0 ? value : 9999;
  };
  return candidates
    .map((item) => ({ item, key: youtubeVideoKey(item?.url) }))
    .filter(({ item, key }) =>
      item && key && item.searchOnly !== true && item.recommended !== false
    )
    .sort((left, right) => {
      const priorityDifference = priority(left.item) - priority(right.item);
      if (priorityDifference !== 0) return priorityDifference;
      if (left.item.resultType !== right.item.resultType) {
        return left.item.resultType === "karaoke" ? -1 : 1;
      }
      return (
        Number(right.item.qualityScore || 0) -
        Number(left.item.qualityScore || 0)
      );
    })
    .filter(({ key }) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maximum)
    .map(({ item }) => item);
}

export function selectBestYoutubeResult(items) {
  return selectYoutubeOptions(items, 1)[0] || null;
}

export async function copyMacClipboard(value, options = {}) {
  const text = String(value || "").trim();
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawnProcess || spawn;
  if (!text) throw new Error("There is no link to copy.");
  if (platform !== "darwin") {
    throw new Error("Clipboard copy is available on Mac.");
  }
  await new Promise((resolve, reject) => {
    const child = spawnProcess("/usr/bin/pbcopy", [], {
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "The link could not be copied."));
    });
    child.stdin.end(text);
  });
  return text;
}

export async function openMacUrl(value, options = {}) {
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawnProcess || spawn;
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("The link is not valid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only secure web links can be opened.");
  }
  if (url.username || url.password) {
    throw new Error("The link contains credentials and will not be opened.");
  }
  if (platform !== "darwin") {
    throw new Error("External link opening is available on Mac.");
  }
  await new Promise((resolve, reject) => {
    const child = spawnProcess("/usr/bin/open", [url.toString()], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "The link could not be opened."));
    });
  });
  return url.toString();
}
