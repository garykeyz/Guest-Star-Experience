import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  copyMacClipboard,
  openMacUrl,
  selectBestYoutubeResult,
  selectYoutubeOptions
} from "../src/youtube.mjs";

test("elige un único video directo con la mejor puntuación", () => {
  const best = selectBestYoutubeResult([
    {
      url: "https://www.youtube.com/results?search_query=hello+karaoke",
      qualityScore: 999,
      searchOnly: true
    },
    {
      url: "https://www.youtube.com/watch?v=lyrics123",
      qualityScore: 70,
      resultType: "lyrics-vocals"
    },
    {
      url: "https://youtu.be/karaoke123",
      qualityScore: 120,
      resultType: "karaoke"
    }
  ]);

  assert.equal(best.url, "https://youtu.be/karaoke123");
  assert.equal(best.resultType, "karaoke");
});

test("descarta videos marcados como no recomendados", () => {
  assert.equal(
    selectBestYoutubeResult([
      {
        url: "https://www.youtube.com/watch?v=bad123",
        qualityScore: 200,
        recommended: false
      }
    ]),
    null
  );
});

test("devuelve varias opciones directas sin repetir el mismo video", () => {
  const options = selectYoutubeOptions([
    {
      url: "https://www.youtube.com/watch?v=karaoke123",
      qualityScore: 120,
      resultType: "karaoke"
    },
    {
      url: "https://youtu.be/karaoke123",
      qualityScore: 110,
      resultType: "karaoke"
    },
    {
      url: "https://www.youtube.com/watch?v=lyrics123",
      qualityScore: 70,
      resultType: "lyrics-vocals"
    }
  ]);

  assert.deepEqual(
    options.map((item) => item.url),
    [
      "https://www.youtube.com/watch?v=karaoke123",
      "https://www.youtube.com/watch?v=lyrics123"
    ]
  );
});

test("limita la selección a las seis mejores opciones", () => {
  const options = selectYoutubeOptions(
    Array.from({ length: 8 }, (_value, index) => ({
      url: `https://www.youtube.com/watch?v=option${index}`,
      qualityScore: 100 - index,
      resultType: "karaoke"
    }))
  );

  assert.equal(options.length, 6);
  assert.equal(options[0].url, "https://www.youtube.com/watch?v=option0");
  assert.equal(options[5].url, "https://www.youtube.com/watch?v=option5");
});

test("conserva el orden de canales prioritarios antes de la puntuación", () => {
  const options = selectYoutubeOptions([
    {
      url: "https://www.youtube.com/watch?v=unknown",
      channelPriority: 120,
      qualityScore: 999,
      resultType: "karaoke"
    },
    {
      url: "https://www.youtube.com/watch?v=karafun",
      channelPriority: 2,
      qualityScore: 80,
      resultType: "karaoke"
    },
    {
      url: "https://www.youtube.com/watch?v=singking",
      channelPriority: 1,
      qualityScore: 70,
      resultType: "karaoke"
    }
  ]);

  assert.deepEqual(
    options.map((item) => item.url),
    [
      "https://www.youtube.com/watch?v=singking",
      "https://www.youtube.com/watch?v=karafun",
      "https://www.youtube.com/watch?v=unknown"
    ]
  );
});

test("copia el enlace con pbcopy en Mac", async () => {
  let executable = "";
  let copied = "";
  const spawnProcess = (command) => {
    executable = command;
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end(value) {
        copied = value;
        queueMicrotask(() => child.emit("close", 0));
      }
    };
    return child;
  };

  const url = "https://www.youtube.com/watch?v=karaoke123";
  assert.equal(
    await copyMacClipboard(url, { platform: "darwin", spawnProcess }),
    url
  );
  assert.equal(executable, "/usr/bin/pbcopy");
  assert.equal(copied, url);
});

test("abre enlaces web con macOS sin crear una ventana en el WebView", async () => {
  let executable = "";
  let args = [];
  const spawnProcess = (command, commandArgs) => {
    executable = command;
    args = commandArgs;
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };

  const url = "https://www.youtube.com/watch?v=karaoke123";
  assert.equal(
    await openMacUrl(url, { platform: "darwin", spawnProcess }),
    url
  );
  assert.equal(executable, "/usr/bin/open");
  assert.deepEqual(args, [url]);
});

test("rechaza esquemas que no son enlaces web", async () => {
  await assert.rejects(
    openMacUrl("file:///Users/Yefry/secret.txt", { platform: "darwin" }),
    /Only secure web links can be opened/
  );
});
