import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  buildKaraokeRemoveScript,
  buildKaraokeScript,
  executeVdj,
  listKaraokeEntries,
  queryVdj,
  removeKaraokeEntry
} from "../src/virtualdj.mjs";

test("construye el comando completo de cola karaoke y cantante", () => {
  const script = buildKaraokeScript(
    "/Users/Yefry/Music/Karaoke/Bruno Mars - Treasure.mp4",
    'Carlos "El Show"'
  );
  assert.match(script, /karaoke_add/);
  assert.match(script, /browser_window "karaoke"/);
  assert.match(script, /browser_scroll "bottom"/);
  assert.match(script, /browsed_song "singer" "Carlos 'El Show'"/);
});

test("construye una eliminación dirigida dentro de la cola karaoke", () => {
  assert.equal(
    buildKaraokeRemoveScript(2),
    'browser_window "karaoke" & browser_scroll "top" & browser_scroll +1 & browser_scroll +1 & browser_remove'
  );
});

test("usa los endpoints execute y query de Network Control con Bearer", async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8")
    });
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(request.url === "/query" ? "10:30 PM" : "true");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const config = {
    host: "127.0.0.1",
    port: address.port,
    password: "secreto",
    timeoutMs: 1000
  };
  assert.equal(await queryVdj(config, "get_clock"), "10:30 PM");
  assert.equal(await executeVdj(config, "pause"), "true");
  assert.deepEqual(received.map((item) => item.url), ["/query", "/execute"]);
  assert.ok(received.every((item) => item.authorization === "Bearer secreto"));
  assert.deepEqual(received.map((item) => item.body), ["get_clock", "pause"]);
});

test("retira solo la solicitud que coincide en archivo y cantante", async (t) => {
  const queue = [
    {
      filepath: "/Music/Karaoke/La Bachata.mp4",
      singer: "Ana",
      title: "La Bachata",
      artist: "Manuel Turizo"
    },
    {
      filepath: "/Music/Karaoke/Propuesta Indecente.mp4",
      singer: "Moises",
      title: "Propuesta Indecente",
      artist: "Romeo Santos"
    },
    {
      filepath: "/Music/Karaoke/La Bachata.mp4",
      singer: "Carlos",
      title: "La Bachata",
      artist: "Manuel Turizo"
    }
  ];
  let selected = 0;
  let removed = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const script = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/execute") {
      if (script.includes('browser_scroll "top"')) selected = 0;
      selected += (script.match(/browser_scroll \+1/g) || []).length;
      if (script.includes("browser_remove")) removed = queue.splice(selected, 1)[0];
      response.end("true");
      return;
    }
    if (script === "file_count karaoke") response.end(String(queue.length));
    else {
      const next = script.match(
        /^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/
      );
      const index = Number(next?.[2] || 0);
      response.end(next ? queue[index]?.[next[1]] || "" : "");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const config = {
    host: "127.0.0.1",
    port: address.port,
    password: "",
    timeoutMs: 1000
  };

  const result = await removeKaraokeEntry(config, {
    filePath: "/Music/Karaoke/La Bachata.mp4",
    singer: "Carlos"
  });

  assert.equal(result.removed, true);
  assert.equal(removed.singer, "Carlos");
  assert.deepEqual(queue.map((item) => item.singer), ["Ana", "Moises"]);
});

test("retira por cantante y título cuando VirtualDJ omite la ruta y altera el artista", async (t) => {
  const queue = [
    {
      filepath: "",
      singer: "Gary",
      title: "Valio La Pena",
      artist: "Marc Antohny"
    }
  ];
  let removed = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const script = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/execute") {
      if (script.includes("browser_remove")) removed = queue.splice(0, 1)[0];
      response.end("true");
      return;
    }
    if (script === "file_count karaoke") response.end(String(queue.length));
    else {
      const next = script.match(
        /^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/
      );
      response.end(next ? queue[0]?.[next[1]] || "" : "");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const result = await removeKaraokeEntry(
    {
      host: "127.0.0.1",
      port: server.address().port,
      password: "",
      timeoutMs: 1000
    },
    {
      filePath: "/Music/Marc Anthony - Valio La Pena.mp4",
      singer: "Gary",
      song: "Valio La Pena",
      artist: "Marc Anthony"
    }
  );

  assert.equal(result.removed, true);
  assert.equal(removed.singer, "Gary");
});

test("avisa cuando VirtualDJ acepta el comando pero no retira la canción", async (t) => {
  const queue = [
    {
      filepath: "/Music/Dancing Queen.mp4",
      singer: "Moises",
      title: "Dancing Queen",
      artist: "ABBA"
    }
  ];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const script = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/execute") {
      response.end("true");
      return;
    }
    if (script === "file_count karaoke") response.end(String(queue.length));
    else {
      const next = script.match(
        /^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/
      );
      response.end(next ? queue[0]?.[next[1]] || "" : "");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await assert.rejects(
    removeKaraokeEntry(
      {
        host: "127.0.0.1",
        port: server.address().port,
        password: "",
        timeoutMs: 1000
      },
      {
        filePath: "/Music/Dancing Queen.mp4",
        singer: "Moises",
        song: "Dancing Queen",
        artist: "ABBA"
      }
    ),
    /todavía aparece en la cola/
  );
});

test("lee la cola Karaoke completa respetando su orden", async (t) => {
  const queue = [
    {
      filepath: "/Music/Primera.mp4",
      singer: "Ana",
      title: "Hello",
      artist: "Adele"
    },
    {
      filepath: "/Music/Segunda.mp4",
      singer: "Carlos",
      title: "Treasure",
      artist: "Bruno Mars"
    }
  ];
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const script = Buffer.concat(chunks).toString("utf8");
    received.push({ url: request.url, script });
    if (script === "file_count karaoke") response.end(String(queue.length));
    else {
      const next = script.match(
        /^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/
      );
      const index = Number(next?.[2] || 0);
      response.end(next ? queue[index]?.[next[1]] || "" : "");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const entries = await listKaraokeEntries({
    host: "127.0.0.1",
    port: address.port,
    password: "",
    timeoutMs: 1000
  });

  assert.deepEqual(entries, [
    {
      index: 0,
      filePath: "/Music/Primera.mp4",
      singer: "Ana",
      song: "Hello",
      artist: "Adele"
    },
    {
      index: 1,
      filePath: "/Music/Segunda.mp4",
      singer: "Carlos",
      song: "Treasure",
      artist: "Bruno Mars"
    }
  ]);
  assert.ok(received.every((item) => item.url === "/query"));
  assert.ok(
    received.some(
      (item) => item.script === 'get_next_karaoke_song "singer" 1'
    )
  );
});

test("una cola Karaoke vacía se confirma sin mover el navegador de VirtualDJ", async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({
      url: request.url,
      script: Buffer.concat(chunks).toString("utf8")
    });
    response.end("0");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const entries = await listKaraokeEntries({
    host: "127.0.0.1",
    port: server.address().port,
    password: "",
    timeoutMs: 1000
  });

  assert.deepEqual(entries, []);
  assert.deepEqual(received, [
    { url: "/query", script: "file_count karaoke" }
  ]);
});

test("no confunde una respuesta inválida con una cola Karaoke vacía", async (t) => {
  const server = createServer((_request, response) => response.end("false"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await assert.rejects(
    listKaraokeEntries({
      host: "127.0.0.1",
      port: server.address().port,
      password: "",
      timeoutMs: 1000
    }),
    /no devolvió el tamaño/
  );
});
