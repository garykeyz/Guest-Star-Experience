import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function listen(server) {
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen)
  );
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForState(url, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await fetch(`${url}/api/state`).then((response) => response.json());
      if (predicate(latest)) return latest;
    } catch {
      // The Bridge can still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`El estado esperado no llegó: ${JSON.stringify(latest)}`);
}

test("reconcilia retiro, reingreso, orden y opciones de YouTube", async (t) => {
  const sourceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const tempRoot = await mkdtemp(join(tmpdir(), "guest-star-integration-"));
  const bridgeRoot = join(tempRoot, "bridge");
  const karaokeFolder = join(tempRoot, "karaoke");
  await cp(sourceRoot, bridgeRoot, { recursive: true });
  await mkdir(join(bridgeRoot, "data"), { recursive: true });
  await mkdir(karaokeFolder, { recursive: true });
  const localSong = join(karaokeFolder, "Adele - Hello Karaoke Lyrics.mp4");
  await writeFile(localSong, "");

  const requests = [
    {
      id: "request-1",
      timestamp: "2026-07-29T10:00:00.000Z",
      singer: "Ana",
      song: "Hello",
      artist: "Adele",
      status: "Agregada a VirtualDJ",
      fileName: "Adele - Hello Karaoke Lyrics.mp4",
      durationSeconds: 240,
      transitionSeconds: 30
    },
    {
      id: "request-2",
      timestamp: "2026-07-29T10:05:00.000Z",
      singer: "Carlos",
      song: "Treasure",
      artist: "Bruno Mars",
      status: "Pendiente",
      fileName: "",
      durationSeconds: 210,
      transitionSeconds: 30
    }
  ];
  const activity = {
    accepting: true,
    activityHours: 2,
    transitionSeconds: 30,
    remainingSeconds: 7200,
    activityStartedAt: "2026-07-29T10:00:00.000Z",
    activityId: "activity-1",
    stateRevision: 1,
    lastAction: "setup",
    lastSource: "sheet"
  };
  const sheetServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    let payload = { ok: true };
    if (body.action === "bridgeQueue") {
      payload = {
        ok: true,
        codeVersion: "4.1.1",
        state: { ...activity },
        requests
      };
    } else if (body.action === "bridgeControl") {
      activity.stateRevision += 1;
      activity.lastAction = body.control;
      activity.lastSource = "bridge";
      if (body.control === "open") activity.accepting = true;
      if (body.control === "close") activity.accepting = false;
      if (body.control === "reset") {
        requests.splice(0);
        activity.activityId = "activity-2";
        activity.remainingSeconds = 7200;
      }
      payload = {
        ok: true,
        codeVersion: "4.1.1",
        control: body.control,
        state: { ...activity },
        requests
      };
    } else if (body.action === "bridgeUpdate") {
      const item = requests.find((entry) => entry.id === body.id);
      if (item) {
        item.status = body.status;
        item.fileName = body.fileName || item.fileName;
        if (Number(body.durationSeconds) > 0) {
          item.durationSeconds = Number(body.durationSeconds);
        }
        if (body.sourceUrl) item.sourceUrl = body.sourceUrl;
      }
    } else if (body.action === "youtubeSearch") {
      payload = {
        ok: true,
        items: [
          {
            url: "https://www.youtube.com/watch?v=karaoke123",
            title: `${body.song} Karaoke Lyrics`,
            channel: "Sing King",
            durationSeconds: 240,
            qualityScore: 120,
            resultType: "karaoke",
            recommended: true
          }
        ]
      };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  const sheetPort = await listen(sheetServer);

  const otherPath = join(karaokeFolder, "Other Song.mp4");
  const vdjQueue = [
    {
      filepath: localSong,
      singer: "Ana",
      title: "Hello",
      artist: "Adele",
      length: "4:03"
    },
    {
      filepath: otherPath,
      singer: "Otro",
      title: "Other Song",
      artist: "Other Artist",
      length: "3:00"
    }
  ];
  let selected = 0;
  const vdjServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const script = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/execute") {
      if (script.includes('browser_scroll "top"')) selected = 0;
      selected += (script.match(/browser_scroll \+1/g) || []).length;
      if (script.includes("browser_remove")) vdjQueue.splice(selected, 1);
      const path = script.match(/karaoke_add "([^"]+)"/)?.[1];
      const singer = script.match(/browsed_song "singer" "([^"]+)"/)?.[1];
      if (path && singer) {
        vdjQueue.push({
          filepath: path,
          singer,
          title: "Hello",
          artist: "Adele",
          length: "4:03"
        });
        selected = vdjQueue.length - 1;
        const movesUp = (script.match(/browser_move -1/g) || []).length;
        for (let move = 0; move < movesUp && selected > 0; move++) {
          const previous = vdjQueue[selected - 1];
          vdjQueue[selected - 1] = vdjQueue[selected];
          vdjQueue[selected] = previous;
          selected -= 1;
        }
      }
      response.end("true");
      return;
    }
    if (script === "file_count karaoke") response.end(String(vdjQueue.length));
    else if (script === "get_clock") response.end("10:30 PM");
    else {
      const next = script.match(
        /^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/
      );
      const index = Number(next?.[2] || 0);
      response.end(next ? vdjQueue[index]?.[next[1]] || "" : "");
    }
  });
  const vdjPort = await listen(vdjServer);
  const bridgePort = await freePort();

  await writeFile(
    join(bridgeRoot, "data", "config.json"),
    `${JSON.stringify({
      configVersion: 4,
      bridgePort,
      libraryFolders: [karaokeFolder],
      rememberLibraryFolders: true,
      appsScriptUrl: `http://127.0.0.1:${sheetPort}/exec`,
      hostPin: "123456",
      rememberHostPin: true,
      virtualDJ: {
        host: "127.0.0.1",
        port: vdjPort,
        password: "",
        timeoutMs: 1000
      },
      requestIntervalSeconds: 3,
      scanIntervalSeconds: 5,
      autoQueueExact: false
    }, null, 2)}\n`
  );

  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: bridgeRoot,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let childError = "";
  child.stderr.on("data", (chunk) => {
    childError += chunk.toString("utf8");
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.all([
      new Promise((resolveClose) => sheetServer.close(resolveClose)),
      new Promise((resolveClose) => vdjServer.close(resolveClose))
    ]);
  });

  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  let state = await waitForState(
    bridgeUrl,
    (candidate) =>
      candidate.requests?.find((item) => item.id === "request-1")?.queued === true &&
      candidate.requests?.find((item) => item.id === "request-1")?.durationSeconds === 243 &&
      candidate.requests?.find((item) => item.id === "request-2")?.youtube?.length === 1
  );
  assert.equal(
    state.requests.find((item) => item.id === "request-1").queuePosition,
    1
  );
  assert.equal(
    state.requests.find((item) => item.id === "request-1").durationSeconds,
    243
  );
  assert.equal(state.virtualDJ.queueCount, 2);
  assert.equal(state.activitySummary.queueSongCount, 2);
  assert.equal(state.activitySummary.queuedSeconds, 483);

  vdjQueue.splice(0, 1);
  state = await waitForState(
    bridgeUrl,
    (candidate) =>
      candidate.requests?.find((item) => item.id === "request-1")
        ?.removedExternally === true
  );
  assert.equal(
    state.requests.find((item) => item.id === "request-1").localState,
    "removed"
  );

  const restored = await fetch(
    `${bridgeUrl}/api/requests/request-1/queue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: localSong })
    }
  ).then((response) => response.json());
  assert.equal(restored.restored, true);
  assert.equal(vdjQueue.at(-1).singer, "Ana");

  state = await waitForState(
    bridgeUrl,
    (candidate) =>
      candidate.requests?.find((item) => item.id === "request-1")?.queuePosition === 2
  );
  assert.deepEqual(
    state.requests.filter((item) => item.queued).map((item) => item.id),
    ["request-1"]
  );

  const removedByBridge = await fetch(
    `${bridgeUrl}/api/requests/request-1/remove`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }
  ).then((response) => response.json());
  assert.equal(removedByBridge.removed, true);
  assert.equal(removedByBridge.verified, true);
  assert.equal(removedByBridge.singer, "Ana");
  assert.equal(vdjQueue.some((entry) => entry.singer === "Ana"), false);

  const queuedAgain = await fetch(
    `${bridgeUrl}/api/requests/request-1/queue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: localSong })
    }
  ).then((response) => response.json());
  assert.equal(queuedAgain.ok, true);
  assert.equal(vdjQueue.at(-1).singer, "Ana");

  const completed = await fetch(
    `${bridgeUrl}/api/requests/request-1/outcome`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "completed" })
    }
  ).then((response) => response.json());
  assert.equal(completed.status, "Ya cantó");
  assert.equal(completed.removedFromVirtualDJ, true);
  assert.equal(completed.singer, "Ana");
  assert.equal(completed.undoOriginalPosition, 2);
  state = await waitForState(
    bridgeUrl,
    (candidate) =>
      candidate.requests?.find((item) => item.id === "request-1")?.outcome ===
      "completed"
  );
  assert.equal(state.activitySummary.completedSeconds, 273);
  assert.equal(
    state.requests.find((item) => item.id === "request-1").canRestoreToQueue,
    true
  );
  assert.equal(vdjQueue.some((entry) => entry.singer === "Ana"), false);

  const undoneToOriginalTurn = await fetch(
    `${bridgeUrl}/api/requests/request-1/undo-outcome`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement: "original" })
    }
  ).then((response) => response.json());
  assert.equal(undoneToOriginalTurn.restoredToVirtualDJ, true);
  assert.equal(undoneToOriginalTurn.queuePosition, 2);
  assert.deepEqual(vdjQueue.map((entry) => entry.singer), ["Otro", "Ana"]);

  const skipped = await fetch(
    `${bridgeUrl}/api/requests/request-1/outcome`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: "skipped" })
    }
  ).then((response) => response.json());
  assert.equal(skipped.status, "Saltado");
  assert.equal(vdjQueue.some((entry) => entry.singer === "Ana"), false);

  const undoneOutsideQueue = await fetch(
    `${bridgeUrl}/api/requests/request-1/undo-outcome`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement: "pending" })
    }
  ).then((response) => response.json());
  assert.equal(undoneOutsideQueue.restoredToVirtualDJ, false);
  assert.equal(undoneOutsideQueue.status, "Fuera de VirtualDJ");

  const queuedAfterUndo = await fetch(
    `${bridgeUrl}/api/requests/request-1/queue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: localSong })
    }
  ).then((response) => response.json());
  assert.equal(queuedAfterUndo.ok, true);
  assert.equal(vdjQueue.at(-1).singer, "Ana");

  await unlink(localSong);
  state = await waitForState(
    bridgeUrl,
    (candidate) => {
      const item = candidate.requests?.find((entry) => entry.id === "request-1");
      return item?.localState === "queued-missing" && item.youtube?.length === 1;
    }
  );
  assert.equal(
    state.requests.find((item) => item.id === "request-1").youtube[0].resultType,
    "karaoke"
  );

  state = await fetch(`${bridgeUrl}/api/activity/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  assert.equal(state.activity.accepting, false);
  assert.equal(activity.accepting, false);

  state = await fetch(`${bridgeUrl}/api/activity/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  assert.equal(state.activity.lastAction, "reset");
  assert.deepEqual(state.requests, []);
  assert.equal(requests.length, 0);
  assert.equal(vdjQueue.some((entry) => entry.singer === "Ana"), false);
  assert.equal(childError, "");
});
