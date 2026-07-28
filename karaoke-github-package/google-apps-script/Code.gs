const SHEET_ID = "1Tgc_sHY4kevbMRlHyjSnVWFpAPJXwJYJeVZfu9yqyZU";
const REQUESTS = "Solicitudes";
const CONFIG = "Configuración";
const HISTORY = "Historial";
const HEADERS = ["Fecha y hora","Nombre","Canción","Artista","Comentario","Idioma","Duración","Transición","Tiempo acumulado","Tiempo restante","Fuente","Estado"];

function doGet(e) {
  const cfg = config_();
  return jsonp_({
    ok: true,
    accepting: cfg.accepting,
    activityHours: cfg.hours,
    accumulatedSeconds: Math.round(cfg.accumulated * 86400),
    remainingSeconds: Math.max(0, Math.round((cfg.hours / 24 - cfg.accumulated) * 86400))
  }, e && e.parameter.callback);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action) return hostAction_(body);
    const cfg = config_();
    if (!cfg.accepting) return json_({ ok:false, code:"CLOSED" });
    if (!body.name || !body.song || !body.artist) return json_({ ok:false, code:"MISSING_FIELDS" });

    const song = findSong_(body.song, body.artist);
    const durationDays = song.seconds / 86400;
    const transitionDays = cfg.transition / 86400;
    const accumulated = cfg.accumulated + durationDays + transitionDays;
    const remaining = Math.max(0, cfg.hours / 24 - accumulated);
    const sheet = spreadsheet_().getSheetByName(REQUESTS);
    sheet.appendRow([
      new Date(), clean_(body.name), clean_(body.song), clean_(body.artist),
      clean_(body.comment), clean_(body.language), durationDays, transitionDays,
      accumulated, remaining, song.url, song.found ? "Encontrada" : "Duración estimada"
    ]);
    const row = sheet.getLastRow();
    sheet.getRange(row, 7, 1, 4).setNumberFormat("[h]:mm:ss");
    const cfgSheet = spreadsheet_().getSheetByName(CONFIG);
    cfgSheet.getRange("B5").setValue(accumulated).setNumberFormat("[h]:mm:ss");
    cfgSheet.getRange("B6").setValue(remaining).setNumberFormat("[h]:mm:ss");
    return json_({ ok:true });
  } catch (error) {
    return json_({ ok:false, error:String(error) });
  } finally {
    lock.releaseLock();
  }
}

function hostAction_(body) {
  const savedPin = PropertiesService.getScriptProperties().getProperty("HOST_PIN");
  if (!savedPin || String(body.pin) !== savedPin) return json_({ ok:false, code:"INVALID_PIN" });
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  if (body.action === "open") cfg.getRange("B4").setValue(true);
  else if (body.action === "close") cfg.getRange("B4").setValue(false);
  else if (body.action === "reset") resetActivity_();
  else return json_({ ok:false, code:"INVALID_ACTION" });
  return json_({ ok:true });
}

function resetActivity_() {
  const ss = spreadsheet_();
  const source = ss.getSheetByName(REQUESTS);
  const history = ss.getSheetByName(HISTORY);
  const last = source.getLastRow();
  if (last > 1) {
    const rows = source.getRange(2, 1, last - 1, HEADERS.length).getValues();
    history.getRange(history.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    source.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  }
  const cfg = ss.getSheetByName(CONFIG);
  const hours = Number(cfg.getRange("B2").getValue()) || 2;
  cfg.getRange("B5").setValue(0).setNumberFormat("[h]:mm:ss");
  cfg.getRange("B6").setValue(hours / 24).setNumberFormat("[h]:mm:ss");
  cfg.getRange("B7").setValue(new Date());
}

function findSong_(title, artist) {
  const key = PropertiesService.getScriptProperties().getProperty("YOUTUBE_API_KEY");
  if (!key) return { seconds:240, url:"", found:false };
  const query = encodeURIComponent(`${artist} ${title} official audio`);
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${query}&key=${key}`;
  const search = JSON.parse(UrlFetchApp.fetch(searchUrl, { muteHttpExceptions:true }).getContentText());
  const ids = (search.items || []).map(item => item.id.videoId).filter(Boolean);
  if (!ids.length) return { seconds:240, url:"", found:false };
  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids.join(",")}&key=${key}`;
  const details = JSON.parse(UrlFetchApp.fetch(detailsUrl, { muteHttpExceptions:true }).getContentText());
  const candidates = (details.items || []).map(item => ({
    id:item.id, seconds:isoSeconds_(item.contentDetails.duration),
    title:String(item.snippet.title || "").toLowerCase()
  })).filter(item => item.seconds >= 90 && item.seconds <= 900);
  const preferred = candidates.find(item => !/(live|remix|sped up|slowed|karaoke)/i.test(item.title)) || candidates[0];
  return preferred ? { seconds:preferred.seconds, url:`https://youtu.be/${preferred.id}`, found:true } : { seconds:240, url:"", found:false };
}

function isoSeconds_(iso) {
  const match = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
}

function config_() {
  const sheet = spreadsheet_().getSheetByName(CONFIG);
  return {
    hours:Number(sheet.getRange("B2").getValue()) || 2,
    transition:Number(sheet.getRange("B3").getValue()) || 30,
    accepting:sheet.getRange("B4").getValue() !== false,
    accumulated:Number(sheet.getRange("B5").getValue()) || 0
  };
}

function setup() {
  const ss = spreadsheet_();
  let requests = ss.getSheetByName(REQUESTS) || ss.insertSheet(REQUESTS);
  let config = ss.getSheetByName(CONFIG) || ss.insertSheet(CONFIG);
  let history = ss.getSheetByName(HISTORY) || ss.insertSheet(HISTORY);
  requests.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  history.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  if (!config.getRange("A1").getValue()) {
    config.getRange("A1:B7").setValues([
      ["Configuración","Valor"],["Duración total (horas)",2],
      ["Transición por participante (segundos)",30],["Aceptar solicitudes",true],
      ["Tiempo acumulado",0],["Tiempo restante",2/24],["Último reinicio",new Date()]
    ]);
  }
  SpreadsheetApp.getUi().alert("Configuración lista.");
}

function configurarCredenciales() {
  const ui = SpreadsheetApp.getUi();
  const pin = ui.prompt("PIN privado del host", "Escribe un PIN que solo tú conozcas:", ui.ButtonSet.OK_CANCEL);
  if (pin.getSelectedButton() !== ui.Button.OK || !pin.getResponseText()) return;
  PropertiesService.getScriptProperties().setProperty("HOST_PIN", pin.getResponseText().trim());
  const key = ui.prompt("YouTube API Key", "Pega tu clave de YouTube Data API v3:", ui.ButtonSet.OK_CANCEL);
  if (key.getSelectedButton() === ui.Button.OK && key.getResponseText()) {
    PropertiesService.getScriptProperties().setProperty("YOUTUBE_API_KEY", key.getResponseText().trim());
  }
  ui.alert("Credenciales guardadas de forma privada.");
}

function abrirSolicitudes() { spreadsheet_().getSheetByName(CONFIG).getRange("B4").setValue(true); }
function cerrarSolicitudes() { spreadsheet_().getSheetByName(CONFIG).getRange("B4").setValue(false); }
function reiniciarActividad() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert("Reiniciar actividad", "Se archivarán las solicitudes actuales.", ui.ButtonSet.YES_NO) === ui.Button.YES) resetActivity_();
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu("🎤 Karaoke")
    .addItem("Configurar PIN y YouTube", "configurarCredenciales")
    .addSeparator().addItem("Abrir solicitudes", "abrirSolicitudes")
    .addItem("Cerrar solicitudes", "cerrarSolicitudes")
    .addItem("Reiniciar actividad", "reiniciarActividad").addToUi();
}
function spreadsheet_() { return SpreadsheetApp.openById(SHEET_ID); }
function clean_(value) { return String(value || "").trim().slice(0,500); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(data, callback) {
  const safe = String(callback || "").replace(/[^\w$]/g,"");
  return ContentService.createTextOutput(safe ? `${safe}(${JSON.stringify(data)})` : JSON.stringify(data))
    .setMimeType(safe ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
