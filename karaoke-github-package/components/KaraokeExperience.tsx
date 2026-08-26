"use client";

import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { normalizeBrandImageUrl } from "@/lib/guest-star/media-url";
import {
  ArrowRight, Bell, CalendarPlus, Check, ChevronDown, Clock3, Headphones,
  Hourglass, Mail, MessageCircleMore, Mic2, Music2, RotateCcw, Send, Star,
  ShieldCheck, Sparkles, UserRound, UsersRound, XCircle
} from "lucide-react";

type Lang = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt";
type FieldKey = "name" | "song" | "artist" | "comment";
type Copy = {
  live: string; title: string; sub: string; desc: string; fields: Record<FieldKey, [string, string]>;
  error: string; submit: string; sending: string; success: string; stage: string;
  again: string; closed: string; closedText: string; failed: string; steps: string[];
};

type ApiState = {
  accepting?: boolean;
  activityHours?: number;
  activityStartedAt?: string;
  activityFinishedAt?: string;
  activityRunning?: boolean;
  showPublicStatus?: boolean;
  queuePeopleCount?: number;
  stateRevision?: number;
  activityId?: string;
  serverNow?: string;
  _receivedAt?: number;
  hotel?: { name?: string; slug?: string; publicUrl?: string; timezone?: string };
  venue?: { name?: string } | null;
  activity?: {
    activityId?: string;
    name?: string;
    status?: string;
    scheduledStartAt?: string;
    showCountdown?: boolean;
    acceptEarlyRequests?: boolean;
    allowedLanguages?: Lang[];
  } | null;
  branding?: Record<string, string | boolean>;
  upcomingActivities?: Array<{
    scheduleId?: string;
    activityName?: string;
    venueName?: string;
    scheduledStartAt?: string;
    durationSeconds?: number;
    showCountdown?: boolean;
  }>;
  googleFallback?: {
    enabled?: boolean;
    formUrl?: string;
    hotelId?: string;
    activityId?: string;
  };
};
type ApiResponse = ApiState & {
  ok?: boolean;
  code?: string;
  error?: string;
  state?: ApiState;
  duplicates?: DuplicateWarning;
  externalReview?: { provider?: string; url?: string; guestCanChoose?: boolean } | null;
};
type ApiOptions = { transientRetries?: number };
type DuplicateWarning = {
  repeatedSinger?: boolean;
  duplicateSong?: boolean;
  duplicateSongState?: "active" | "completed" | "";
};
type DuplicateCopy = {
  title: string;
  singer: string;
  active: string;
  completed: string;
  question: string;
  continue: string;
  cancel: string;
};
type ActivityCopy = {
  label: string;
  notStarted: string;
  running: string;
  finished: string;
  elapsed: string;
  remaining: string;
  queue: string;
};
type ModuleCopy = {
  unavailableTitle: string; unavailableText: string; startsIn: string;
  nextActivity: string; defaultActivity: string; addCalendar: string;
  reminderEmail: string; reminderConsent: string; remindMe: string;
  reminderScheduled: string; reminderRequired: string; reminderFailed: string;
  reviewLabel: string; reviewInvitation: string; reviewGeneral: string;
  ratingLabel: string; star: string; stars: string; optionalComment: string;
  optionalEmail: string; followUpConsent: string; submitReview: string;
  reviewSaved: string; ratingRequired: string; reviewFailed: string;
  separateReview: string; optionalExternalReview: string; hotel: string;
  unsubscribed: string; unsubscribeInvalid: string;
};

const ENDPOINT = "/api/karaoke";
const GUEST_DEVICE_STORAGE_KEY = "guest-star-public-device-v1";
const TRANSIENT_RETRY_DELAYS_MS = [200, 500, 1000, 2000, 4000, 6000];
let ephemeralGuestDeviceId = "";

function newGuestDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
}

function guestDeviceId() {
  if (ephemeralGuestDeviceId) return ephemeralGuestDeviceId;
  try {
    const saved = window.localStorage.getItem(GUEST_DEVICE_STORAGE_KEY) || "";
    if (/^[a-z0-9._:-]{16,128}$/i.test(saved)) {
      ephemeralGuestDeviceId = saved;
      return saved;
    }
    ephemeralGuestDeviceId = newGuestDeviceId();
    window.localStorage.setItem(GUEST_DEVICE_STORAGE_KEY, ephemeralGuestDeviceId);
    return ephemeralGuestDeviceId;
  } catch {
    ephemeralGuestDeviceId = newGuestDeviceId();
    return ephemeralGuestDeviceId;
  }
}

const languages: [Lang, string, string, string][] = [
  ["es","🇪🇸","Spanish","Español"],["en","🇺🇸","English","English"],["fr","🇫🇷","French","Français"],
  ["it","🇮🇹","Italian","Italiano"],["de","🇩🇪","German","Deutsch"],["ru","🇷🇺","Russian","Русский"],["pt","🇵🇹","Portuguese","Português"]
];
const duplicateCopy: Record<Lang, DuplicateCopy> = {
  en: {title:"Please confirm",singer:"You already have another request in this activity.",active:"This song has already been requested and is still active.",completed:"This song has already been sung during this activity.",question:"Do you still want to submit it?",continue:"Yes, continue",cancel:"Go back"},
  es: {title:"Confirma antes de continuar",singer:"Ya tienes otra solicitud en esta actividad.",active:"Esta canción ya fue solicitada y sigue activa.",completed:"Esta canción ya fue cantada durante esta actividad.",question:"¿Aun así quieres enviarla?",continue:"Sí, continuar",cancel:"Volver"},
  fr: {title:"Veuillez confirmer",singer:"Vous avez déjà une autre demande pour cette activité.",active:"Cette chanson a déjà été demandée et reste active.",completed:"Cette chanson a déjà été chantée pendant cette activité.",question:"Voulez-vous quand même l’envoyer ?",continue:"Oui, continuer",cancel:"Revenir"},
  it: {title:"Conferma prima di continuare",singer:"Hai già un’altra richiesta in questa attività.",active:"Questo brano è già stato richiesto ed è ancora attivo.",completed:"Questo brano è già stato cantato durante questa attività.",question:"Vuoi inviarlo comunque?",continue:"Sì, continua",cancel:"Indietro"},
  de: {title:"Bitte bestätigen",singer:"Du hast bereits einen weiteren Wunsch für diese Veranstaltung.",active:"Dieser Song wurde bereits gewünscht und ist noch aktiv.",completed:"Dieser Song wurde während dieser Veranstaltung bereits gesungen.",question:"Möchtest du ihn trotzdem senden?",continue:"Ja, fortfahren",cancel:"Zurück"},
  ru: {title:"Подтвердите отправку",singer:"У вас уже есть другая заявка в этом мероприятии.",active:"Эта песня уже заказана и ещё активна.",completed:"Эту песню уже исполняли во время этого мероприятия.",question:"Всё равно отправить заявку?",continue:"Да, продолжить",cancel:"Назад"},
  pt: {title:"Confirme antes de continuar",singer:"Já tem outro pedido nesta atividade.",active:"Esta música já foi pedida e continua ativa.",completed:"Esta música já foi cantada durante esta atividade.",question:"Deseja enviá-la mesmo assim?",continue:"Sim, continuar",cancel:"Voltar"}
};
const activityCopy: Record<Lang, ActivityCopy> = {
  en: {label:"ACTIVITY STATUS",notStarted:"The activity has not started",running:"Activity in progress",finished:"Scheduled time completed",elapsed:"Elapsed",remaining:"Remaining",queue:"People in queue"},
  es: {label:"ESTADO DE LA ACTIVIDAD",notStarted:"La actividad aún no ha iniciado",running:"Actividad en curso",finished:"Tiempo programado finalizado",elapsed:"Transcurrido",remaining:"Faltante",queue:"Personas en cola"},
  fr: {label:"ÉTAT DE L’ACTIVITÉ",notStarted:"L’activité n’a pas encore commencé",running:"Activité en cours",finished:"Temps prévu terminé",elapsed:"Écoulé",remaining:"Restant",queue:"Personnes en attente"},
  it: {label:"STATO DELL’ATTIVITÀ",notStarted:"L’attività non è ancora iniziata",running:"Attività in corso",finished:"Tempo previsto terminato",elapsed:"Trascorso",remaining:"Rimanente",queue:"Persone in coda"},
  de: {label:"AKTIVITÄTSSTATUS",notStarted:"Die Aktivität hat noch nicht begonnen",running:"Aktivität läuft",finished:"Geplante Zeit beendet",elapsed:"Vergangen",remaining:"Verbleibend",queue:"Personen in der Warteschlange"},
  ru: {label:"СТАТУС МЕРОПРИЯТИЯ",notStarted:"Мероприятие ещё не началось",running:"Мероприятие идёт",finished:"Запланированное время завершено",elapsed:"Прошло",remaining:"Осталось",queue:"Людей в очереди"},
  pt: {label:"ESTADO DA ATIVIDADE",notStarted:"A atividade ainda não começou",running:"Atividade em curso",finished:"Tempo programado concluído",elapsed:"Decorrido",remaining:"Restante",queue:"Pessoas na fila"}
};
const fallbackCopy: Record<Lang,{eyebrow:string;title:string;body:string;action:string;language:string}> = {
  es:{eyebrow:"RESPALDO SEGURO",title:"Solicitudes disponibles en Google Forms",body:"El anfitrión activó temporalmente el formulario de respaldo para esta actividad. Tu solicitud llegará a la misma operación del evento.",action:"Abrir formulario de solicitudes",language:"Cambiar idioma"},
  en:{eyebrow:"SECURE BACKUP",title:"Requests available in Google Forms",body:"The host temporarily enabled the backup form for this activity. Your request will reach the same event operation.",action:"Open request form",language:"Change language"},
  fr:{eyebrow:"SAUVEGARDE SÉCURISÉE",title:"Demandes disponibles dans Google Forms",body:"L’hôte a temporairement activé le formulaire de secours pour cette activité. Votre demande arrivera à la même équipe.",action:"Ouvrir le formulaire",language:"Changer de langue"},
  it:{eyebrow:"BACKUP SICURO",title:"Richieste disponibili in Google Forms",body:"L’host ha attivato temporaneamente il modulo di backup per questa attività. La richiesta arriverà alla stessa gestione dell’evento.",action:"Apri il modulo richieste",language:"Cambia lingua"},
  de:{eyebrow:"SICHERE RESERVE",title:"Anfragen über Google Forms verfügbar",body:"Der Host hat vorübergehend das Reserveformular für diese Aktivität aktiviert. Deine Anfrage erreicht dasselbe Veranstaltungsteam.",action:"Anfrageformular öffnen",language:"Sprache ändern"},
  ru:{eyebrow:"БЕЗОПАСНЫЙ РЕЗЕРВ",title:"Заявки доступны в Google Forms",body:"Ведущий временно включил резервную форму для этого мероприятия. Ваша заявка поступит той же команде.",action:"Открыть форму заявок",language:"Сменить язык"},
  pt:{eyebrow:"BACKUP SEGURO",title:"Pedidos disponíveis no Google Forms",body:"O anfitrião ativou temporariamente o formulário de reserva para esta atividade. O pedido chegará à mesma operação do evento.",action:"Abrir formulário de pedidos",language:"Mudar idioma"}
};
const moduleCopy: Record<Lang,ModuleCopy> = {
  en:{unavailableTitle:"Link unavailable",unavailableText:"This hotel link is unavailable or no longer active.",startsIn:"STARTS IN",nextActivity:"NEXT ACTIVITY",defaultActivity:"Guest Star Activity",addCalendar:"Add to Calendar",reminderEmail:"Email for one reminder",reminderConsent:"Yes, send me one reminder for this activity.",remindMe:"Remind Me",reminderScheduled:"Your one-time reminder is scheduled.",reminderRequired:"Enter your email and confirm consent for one reminder.",reminderFailed:"The reminder could not be created. Please try again.",reviewLabel:"OPTIONAL REVIEW",reviewInvitation:"How was your Guest Star experience?",reviewGeneral:"No review is required to continue or to use any other option.",ratingLabel:"Rating from one to five",star:"star",stars:"stars",optionalComment:"Optional comment",optionalEmail:"Email (optional)",followUpConsent:"Yes, I would like one follow-up message about my experience.",submitReview:"Submit Optional Review",reviewSaved:"Thank you. Your review was saved.",ratingRequired:"Choose a rating before submitting.",reviewFailed:"Your review could not be submitted. Please try again.",separateReview:"Leave a separate {provider} review",optionalExternalReview:"Leave an optional {provider} review",hotel:"hotel",unsubscribed:"You have been unsubscribed from future Guest Star messages.",unsubscribeInvalid:"This unsubscribe link is invalid or has expired."},
  es:{unavailableTitle:"Enlace no disponible",unavailableText:"Este enlace del hotel no está disponible o ya no está activo.",startsIn:"COMIENZA EN",nextActivity:"PRÓXIMA ACTIVIDAD",defaultActivity:"Actividad Guest Star",addCalendar:"Añadir al calendario",reminderEmail:"Correo para un recordatorio",reminderConsent:"Sí, envíame un recordatorio para esta actividad.",remindMe:"Recordarme",reminderScheduled:"Tu recordatorio único quedó programado.",reminderRequired:"Escribe tu correo y confirma el consentimiento para recibir un recordatorio.",reminderFailed:"No se pudo crear el recordatorio. Inténtalo de nuevo.",reviewLabel:"RESEÑA OPCIONAL",reviewInvitation:"¿Cómo fue tu experiencia Guest Star?",reviewGeneral:"No es necesario dejar una reseña para continuar ni usar ninguna otra opción.",ratingLabel:"Calificación de una a cinco",star:"estrella",stars:"estrellas",optionalComment:"Comentario opcional",optionalEmail:"Correo (opcional)",followUpConsent:"Sí, deseo recibir un mensaje de seguimiento sobre mi experiencia.",submitReview:"Enviar reseña opcional",reviewSaved:"Gracias. Tu reseña fue guardada.",ratingRequired:"Elige una calificación antes de enviar.",reviewFailed:"No se pudo enviar tu reseña. Inténtalo de nuevo.",separateReview:"Dejar otra reseña en {provider}",optionalExternalReview:"Dejar una reseña opcional en {provider}",hotel:"el hotel",unsubscribed:"Te diste de baja de futuros mensajes de Guest Star.",unsubscribeInvalid:"Este enlace para darte de baja no es válido o ya venció."},
  fr:{unavailableTitle:"Lien indisponible",unavailableText:"Ce lien d’hôtel est indisponible ou n’est plus actif.",startsIn:"COMMENCE DANS",nextActivity:"PROCHAINE ACTIVITÉ",defaultActivity:"Activité Guest Star",addCalendar:"Ajouter au calendrier",reminderEmail:"E-mail pour un rappel",reminderConsent:"Oui, envoyez-moi un rappel pour cette activité.",remindMe:"Me le rappeler",reminderScheduled:"Votre rappel unique est programmé.",reminderRequired:"Saisissez votre e-mail et confirmez votre accord pour recevoir un rappel.",reminderFailed:"Le rappel n’a pas pu être créé. Réessayez.",reviewLabel:"AVIS FACULTATIF",reviewInvitation:"Comment s’est passée votre expérience Guest Star ?",reviewGeneral:"Aucun avis n’est requis pour continuer ou utiliser une autre option.",ratingLabel:"Note de un à cinq",star:"étoile",stars:"étoiles",optionalComment:"Commentaire facultatif",optionalEmail:"E-mail (facultatif)",followUpConsent:"Oui, je souhaite recevoir un message de suivi sur mon expérience.",submitReview:"Envoyer l’avis facultatif",reviewSaved:"Merci. Votre avis a été enregistré.",ratingRequired:"Choisissez une note avant l’envoi.",reviewFailed:"Votre avis n’a pas pu être envoyé. Réessayez.",separateReview:"Laisser un autre avis sur {provider}",optionalExternalReview:"Laisser un avis facultatif sur {provider}",hotel:"l’hôtel",unsubscribed:"Vous êtes désabonné des futurs messages Guest Star.",unsubscribeInvalid:"Ce lien de désabonnement est invalide ou a expiré."},
  it:{unavailableTitle:"Link non disponibile",unavailableText:"Questo link dell’hotel non è disponibile o non è più attivo.",startsIn:"INIZIA TRA",nextActivity:"PROSSIMA ATTIVITÀ",defaultActivity:"Attività Guest Star",addCalendar:"Aggiungi al calendario",reminderEmail:"E-mail per un promemoria",reminderConsent:"Sì, inviami un promemoria per questa attività.",remindMe:"Ricordamelo",reminderScheduled:"Il promemoria singolo è stato programmato.",reminderRequired:"Inserisci l’e-mail e conferma il consenso per ricevere un promemoria.",reminderFailed:"Impossibile creare il promemoria. Riprova.",reviewLabel:"RECENSIONE FACOLTATIVA",reviewInvitation:"Com’è stata la tua esperienza Guest Star?",reviewGeneral:"Non è richiesta alcuna recensione per continuare o usare altre opzioni.",ratingLabel:"Valutazione da uno a cinque",star:"stella",stars:"stelle",optionalComment:"Commento facoltativo",optionalEmail:"E-mail (facoltativa)",followUpConsent:"Sì, desidero ricevere un messaggio di follow-up sulla mia esperienza.",submitReview:"Invia recensione facoltativa",reviewSaved:"Grazie. La recensione è stata salvata.",ratingRequired:"Scegli una valutazione prima di inviare.",reviewFailed:"Impossibile inviare la recensione. Riprova.",separateReview:"Lascia un’altra recensione su {provider}",optionalExternalReview:"Lascia una recensione facoltativa su {provider}",hotel:"l’hotel",unsubscribed:"Non riceverai più i futuri messaggi Guest Star.",unsubscribeInvalid:"Questo link di annullamento non è valido o è scaduto."},
  de:{unavailableTitle:"Link nicht verfügbar",unavailableText:"Dieser Hotellink ist nicht verfügbar oder nicht mehr aktiv.",startsIn:"BEGINNT IN",nextActivity:"NÄCHSTE AKTIVITÄT",defaultActivity:"Guest-Star-Aktivität",addCalendar:"Zum Kalender hinzufügen",reminderEmail:"E-Mail für eine Erinnerung",reminderConsent:"Ja, senden Sie mir eine Erinnerung für diese Aktivität.",remindMe:"Erinnern",reminderScheduled:"Ihre einmalige Erinnerung ist geplant.",reminderRequired:"Geben Sie Ihre E-Mail ein und bestätigen Sie die Zustimmung für eine Erinnerung.",reminderFailed:"Die Erinnerung konnte nicht erstellt werden. Versuchen Sie es erneut.",reviewLabel:"OPTIONALE BEWERTUNG",reviewInvitation:"Wie war Ihr Guest-Star-Erlebnis?",reviewGeneral:"Eine Bewertung ist nicht erforderlich, um fortzufahren oder andere Optionen zu nutzen.",ratingLabel:"Bewertung von eins bis fünf",star:"Stern",stars:"Sterne",optionalComment:"Optionaler Kommentar",optionalEmail:"E-Mail (optional)",followUpConsent:"Ja, ich möchte eine Rückmeldung zu meinem Erlebnis erhalten.",submitReview:"Optionale Bewertung senden",reviewSaved:"Vielen Dank. Ihre Bewertung wurde gespeichert.",ratingRequired:"Wählen Sie vor dem Senden eine Bewertung.",reviewFailed:"Ihre Bewertung konnte nicht gesendet werden. Versuchen Sie es erneut.",separateReview:"Separate Bewertung bei {provider} abgeben",optionalExternalReview:"Optionale Bewertung bei {provider} abgeben",hotel:"dem Hotel",unsubscribed:"Sie wurden von zukünftigen Guest-Star-Nachrichten abgemeldet.",unsubscribeInvalid:"Dieser Abmeldelink ist ungültig oder abgelaufen."},
  ru:{unavailableTitle:"Ссылка недоступна",unavailableText:"Эта ссылка отеля недоступна или больше не активна.",startsIn:"ДО НАЧАЛА",nextActivity:"СЛЕДУЮЩЕЕ МЕРОПРИЯТИЕ",defaultActivity:"Мероприятие Guest Star",addCalendar:"Добавить в календарь",reminderEmail:"Эл. почта для одного напоминания",reminderConsent:"Да, отправьте мне одно напоминание об этом мероприятии.",remindMe:"Напомнить",reminderScheduled:"Одноразовое напоминание запланировано.",reminderRequired:"Введите эл. почту и подтвердите согласие на одно напоминание.",reminderFailed:"Не удалось создать напоминание. Попробуйте ещё раз.",reviewLabel:"НЕОБЯЗАТЕЛЬНЫЙ ОТЗЫВ",reviewInvitation:"Как вам впечатления от Guest Star?",reviewGeneral:"Отзыв не обязателен для продолжения или использования других функций.",ratingLabel:"Оценка от одного до пяти",star:"звезда",stars:"звёзд",optionalComment:"Необязательный комментарий",optionalEmail:"Эл. почта (необязательно)",followUpConsent:"Да, я хочу получить одно сообщение о моём опыте.",submitReview:"Отправить необязательный отзыв",reviewSaved:"Спасибо. Ваш отзыв сохранён.",ratingRequired:"Выберите оценку перед отправкой.",reviewFailed:"Не удалось отправить отзыв. Попробуйте ещё раз.",separateReview:"Оставить отдельный отзыв на {provider}",optionalExternalReview:"Оставить необязательный отзыв на {provider}",hotel:"сайте отеля",unsubscribed:"Вы отписались от будущих сообщений Guest Star.",unsubscribeInvalid:"Эта ссылка для отписки недействительна или устарела."},
  pt:{unavailableTitle:"Link indisponível",unavailableText:"Este link do hotel não está disponível ou já não está ativo.",startsIn:"COMEÇA EM",nextActivity:"PRÓXIMA ATIVIDADE",defaultActivity:"Atividade Guest Star",addCalendar:"Adicionar ao calendário",reminderEmail:"E-mail para um lembrete",reminderConsent:"Sim, envie-me um lembrete para esta atividade.",remindMe:"Lembrar-me",reminderScheduled:"O seu lembrete único foi agendado.",reminderRequired:"Introduza o e-mail e confirme o consentimento para receber um lembrete.",reminderFailed:"Não foi possível criar o lembrete. Tente novamente.",reviewLabel:"AVALIAÇÃO OPCIONAL",reviewInvitation:"Como foi a sua experiência Guest Star?",reviewGeneral:"Não é necessário avaliar para continuar ou utilizar qualquer outra opção.",ratingLabel:"Avaliação de uma a cinco",star:"estrela",stars:"estrelas",optionalComment:"Comentário opcional",optionalEmail:"E-mail (opcional)",followUpConsent:"Sim, gostaria de receber uma mensagem de acompanhamento sobre a minha experiência.",submitReview:"Enviar avaliação opcional",reviewSaved:"Obrigado. A sua avaliação foi guardada.",ratingRequired:"Escolha uma avaliação antes de enviar.",reviewFailed:"Não foi possível enviar a avaliação. Tente novamente.",separateReview:"Deixar outra avaliação em {provider}",optionalExternalReview:"Deixar uma avaliação opcional em {provider}",hotel:"o hotel",unsubscribed:"Cancelou os futuros e-mails da Guest Star.",unsubscribeInvalid:"Este link para cancelar os e-mails é inválido ou expirou."}
};
const languageLocales: Record<Lang,string> = {es:"es-DO",en:"en-US",fr:"fr-FR",it:"it-IT",de:"de-DE",ru:"ru-RU",pt:"pt-PT"};
const common = (x: Partial<Copy>): Copy => ({
  live:"LIVE EXPERIENCE",title:"KARAOKE NIGHT",sub:"Ready to sing?",desc:"Request your favorite song and get ready to shine on stage.",
  fields:{name:["Your Name","What should we call you?"],song:["Song Title","What would you like to sing?"],artist:["Artist","Who performs it?"],comment:["Comment","Optional dedication or note..."]},
  error:"Please complete this field.",submit:"Submit Request",sending:"Sending...",
  success:"Your song request has been sent!",stage:"Get ready to take the stage!",again:"Submit another song",
  closed:"Requests are closed",closedText:"The host has temporarily closed song requests.",
  failed:"We couldn't send your request. Please try again.",
  steps:["Fill the form","Wait for your turn","Sing and enjoy!"],...x
});
const copy: Record<Lang, Copy> = {
  en: common({}),
  es: common({
    live:"EXPERIENCIA EN VIVO",title:"NOCHE DE KARAOKE",sub:"¿Listo para cantar?",
    desc:"Pide tu canción favorita y prepárate para brillar en el escenario.",
    fields:{name:["Tu nombre","¿Cómo quieres que te llamemos?"],song:["Título de la canción","¿Qué te gustaría cantar?"],artist:["Artista","¿Quién la interpreta?"],comment:["Comentario","Dedicatoria o nota opcional..."]},
    error:"Completa este campo.",submit:"Enviar solicitud",sending:"Enviando...",
    success:"¡Tu solicitud de canción ha sido enviada!",stage:"¡Prepárate para subir al escenario!",again:"Pedir otra canción",
    closed:"Solicitudes cerradas",closedText:"El anfitrión ha cerrado temporalmente las solicitudes de canciones.",
    failed:"No pudimos enviar la solicitud. Inténtalo de nuevo.",
    steps:["Completa el formulario","Espera tu turno","¡Canta y disfruta!"]
  }),
  fr: common({
    live:"EXPÉRIENCE EN DIRECT",title:"SOIRÉE KARAOKÉ",sub:"Prêt à chanter ?",
    desc:"Demandez votre chanson préférée et préparez-vous à briller sur scène.",
    fields:{name:["Votre nom","Comment souhaitez-vous être appelé ?"],song:["Titre de la chanson","Que souhaitez-vous chanter ?"],artist:["Artiste","Qui interprète cette chanson ?"],comment:["Commentaire","Dédicace ou remarque facultative..."]},
    error:"Veuillez remplir ce champ.",submit:"Envoyer la demande",sending:"Envoi en cours...",
    success:"Votre demande de chanson a bien été envoyée !",stage:"Préparez-vous à monter sur scène !",again:"Demander une autre chanson",
    closed:"Demandes fermées",closedText:"L’animateur a temporairement fermé les demandes de chansons.",
    failed:"Impossible d’envoyer votre demande. Veuillez réessayer.",
    steps:["Remplissez le formulaire","Attendez votre tour","Chantez et amusez-vous !"]
  }),
  it: common({
    live:"ESPERIENZA DAL VIVO",title:"SERATA KARAOKE",sub:"Pronto a cantare?",
    desc:"Richiedi la tua canzone preferita e preparati a brillare sul palco.",
    fields:{name:["Il tuo nome","Come vuoi che ti chiamiamo?"],song:["Titolo della canzone","Cosa vorresti cantare?"],artist:["Artista","Chi la interpreta?"],comment:["Commento","Dedica o nota facoltativa..."]},
    error:"Compila questo campo.",submit:"Invia richiesta",sending:"Invio in corso...",
    success:"La tua richiesta è stata inviata!",stage:"Preparati a salire sul palco!",again:"Richiedi un’altra canzone",
    closed:"Richieste chiuse",closedText:"Il presentatore ha temporaneamente chiuso le richieste di brani.",
    failed:"Non è stato possibile inviare la richiesta. Riprova.",
    steps:["Compila il modulo","Aspetta il tuo turno","Canta e divertiti!"]
  }),
  de: common({
    live:"LIVE-ERLEBNIS",title:"KARAOKE-NACHT",sub:"Bereit zum Singen?",
    desc:"Wünsch dir deinen Lieblingssong und mach dich bereit, auf der Bühne zu glänzen.",
    fields:{name:["Dein Name","Wie dürfen wir dich nennen?"],song:["Songtitel","Was möchtest du singen?"],artist:["Interpret/in","Von wem ist der Song?"],comment:["Kommentar","Optionale Widmung oder Nachricht..."]},
    error:"Bitte fülle dieses Feld aus.",submit:"Songwunsch senden",sending:"Wird gesendet...",
    success:"Dein Songwunsch wurde gesendet!",stage:"Mach dich bereit für deinen Auftritt!",again:"Weiteren Song wünschen",
    closed:"Keine Songwünsche möglich",closedText:"Der Gastgeber nimmt vorübergehend keine Songwünsche an.",
    failed:"Dein Songwunsch konnte nicht gesendet werden. Bitte versuche es erneut.",
    steps:["Formular ausfüllen","Warte, bis du dran bist","Singen und Spaß haben!"]
  }),
  ru: common({
    live:"ЖИВОЕ ШОУ",title:"ВЕЧЕР КАРАОКЕ",sub:"Готовы петь?",
    desc:"Закажите любимую песню и приготовьтесь блистать на сцене.",
    fields:{name:["Ваше имя","Как к вам обращаться?"],song:["Название песни","Что вы хотите спеть?"],artist:["Исполнитель","Кто исполняет эту песню?"],comment:["Комментарий","Посвящение или примечание — необязательно..."]},
    error:"Заполните это поле.",submit:"Отправить заявку",sending:"Отправка...",
    success:"Ваша заявка на песню отправлена!",stage:"Приготовьтесь выйти на сцену!",again:"Заказать ещё одну песню",
    closed:"Приём заявок закрыт",closedText:"Ведущий временно приостановил приём заявок на песни.",
    failed:"Не удалось отправить заявку. Попробуйте ещё раз.",
    steps:["Заполните форму","Дождитесь своей очереди","Пойте и получайте удовольствие!"]
  }),
  pt: common({
    live:"EXPERIÊNCIA AO VIVO",title:"NOITE DE KARAOKE",sub:"Pronto para cantar?",
    desc:"Peça a sua música favorita e prepare-se para brilhar no palco.",
    fields:{name:["O seu nome","Como gostaria de ser chamado?"],song:["Título da música","O que gostaria de cantar?"],artist:["Artista","Quem interpreta esta música?"],comment:["Comentário","Dedicatória ou nota opcional..."]},
    error:"Preencha este campo.",submit:"Enviar pedido",sending:"A enviar...",
    success:"O seu pedido de música foi enviado!",stage:"Prepare-se para subir ao palco!",again:"Pedir outra música",
    closed:"Pedidos encerrados",closedText:"O anfitrião encerrou temporariamente os pedidos de músicas.",
    failed:"Não foi possível enviar o pedido. Tente novamente.",
    steps:["Preencha o formulário","Aguarde a sua vez","Cante e divirta-se!"]
  })
};
const icons = { name: UserRound, song: Music2, artist: Mic2, comment: MessageCircleMore };

function retryDelay(attempt: number) {
  const base = TRANSIENT_RETRY_DELAYS_MS[Math.min(attempt, TRANSIENT_RETRY_DELAYS_MS.length - 1)];
  return base + Math.floor(Math.random() * Math.max(50, base * .2));
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function api(url = ENDPOINT, init?: RequestInit, options: ApiOptions = {}): Promise<ApiResponse> {
  const retries = Math.max(0, Math.min(6, Math.floor(options.transientRetries || 0)));
  let lastError: Error = new Error("REQUEST_FAILED");
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {})
        }
      });
      let data: ApiResponse;
      try {
        data = await response.json() as ApiResponse;
      } catch {
        const invalid = new Error("INVALID_SERVER_RESPONSE");
        Object.assign(invalid, { transient: true, httpStatus: response.status });
        throw invalid;
      }
      if (!response.ok || data.ok === false) {
        const error = new Error(data.error || data.code || "REQUEST_FAILED");
        Object.assign(error, data, {
          httpStatus: response.status,
          transient: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
        });
        throw error;
      }
      return data;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught || "REQUEST_FAILED"));
      lastError = error;
      const transient = (error as Error & { transient?: boolean }).transient !== false;
      if (!transient || attempt >= retries) throw error;
      await wait(retryDelay(attempt));
    }
  }
  throw lastError;
}

function post(data: Record<string, unknown>, options: ApiOptions = {}) {
  return api(ENDPOINT, { method: "POST", body: JSON.stringify(data) }, options);
}

function acceptingFrom(data: ApiResponse) {
  return (data.state?.accepting ?? data.accepting) !== false;
}

function stateFrom(data: ApiResponse): ApiState {
  return { ...(data.state || data), _receivedAt: Date.now() };
}

function activityDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return `${hours}:${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`;
}

export default function KaraokeExperience({ hotelCode = "" }: { hotelCode?: string }) {
  const [lang,setLang]=useState<Lang|null>(null);
  const [menu,setMenu]=useState(false);
  const [values,setValues]=useState<Record<FieldKey,string>>({name:"",song:"",artist:"",comment:""});
  const [touched,setTouched]=useState<Partial<Record<FieldKey,boolean>>>({});
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [accepting,setAccepting]=useState(true);
  const [activity,setActivity]=useState<ApiState>({});
  const [clockNow,setClockNow]=useState(()=>Date.now());
  const [bootstrapError,setBootstrapError]=useState("");
  const [submitError,setSubmitError]=useState("");
  const [duplicateWarning,setDuplicateWarning]=useState<DuplicateWarning|null>(null);
  const [reviewRating,setReviewRating]=useState(0);
  const [reviewComment,setReviewComment]=useState("");
  const [reviewEmail,setReviewEmail]=useState("");
  const [reviewConsent,setReviewConsent]=useState(false);
  const [reviewSent,setReviewSent]=useState(false);
  const [reminderEmail,setReminderEmail]=useState("");
  const [reminderConsent,setReminderConsent]=useState(false);
  const [reminderSent,setReminderSent]=useState(false);
  const [moduleError,setModuleError]=useState("");
  const hasLoadedPublicState=useRef(false);
  const unavailableConfirmations=useRef(0);
  const [externalReview,setExternalReview]=useState<{provider?:string;url?:string}|null>(null);
  const text=copy[lang||"en"];
  const warningText=duplicateCopy[lang||"en"];
  const statusText=activityCopy[lang||"en"];
  const moduleText=moduleCopy[lang||"en"];
  const allowedLanguageCodes=activity.activity?.allowedLanguages?.length
    ? activity.activity.allowedLanguages
    : (["es","en","fr","it","de","ru","pt"] as Lang[]);
  const availableLanguages=languages.filter(x=>allowedLanguageCodes.includes(x[0]));
  const active=availableLanguages.find(x=>x[0]===lang)||availableLanguages[0]||languages[0];
  const complete=Boolean(values.name.trim()&&values.song.trim()&&values.artist.trim());
  const serverOffset=Number.isFinite(Date.parse(String(activity.serverNow||"")))
    ? Date.parse(String(activity.serverNow))-Number(activity._receivedAt||clockNow)
    : 0;
  const synchronizedNow=clockNow+serverOffset;
  const targetSeconds=Math.max(0,Math.round((Number(activity.activityHours)||0)*3600));
  const startedAt=Date.parse(String(activity.activityStartedAt||""));
  const finishedAt=Date.parse(String(activity.activityFinishedAt||""));
  const hasStarted=Number.isFinite(startedAt);
  const activityRunning=hasStarted&&activity.activityRunning!==false;
  const elapsedSeconds=hasStarted
    ? Math.max(0,Math.floor(((Number.isFinite(finishedAt)?finishedAt:synchronizedNow)-startedAt)/1000))
    : 0;
  const remainingSeconds=Math.max(0,targetSeconds-elapsedSeconds);
  const activityFinished=String(activity.activity?.status||"")==="finished"||
    (activityRunning&&targetSeconds>0&&remainingSeconds===0);
  const queuePeopleCount=Math.max(0,Math.floor(Number(activity.queuePeopleCount)||0));
  const branding=activity.branding||{};
  const localizedMessages=(()=>{
    const raw=branding.localizedMessagesJson;
    if(raw&&typeof raw==="object")return raw as Record<string,Record<string,string>>;
    try{return JSON.parse(String(raw||"{}")) as Record<string,Record<string,string>>;}catch{return {};}
  })();
  const brandingMessage=(field:string)=>localizedMessages[lang||"en"]?.[field]||branding[field]||"";
  const scheduledAt=Date.parse(String(activity.activity?.scheduledStartAt||""));
  const countdownSeconds=Number.isFinite(scheduledAt)
    ? Math.max(0,Math.floor((scheduledAt-synchronizedNow)/1000))
    : 0;
  const brandStyle={
    "--p":String(branding.primaryColor||"#ff2d95"),
    "--v":String(branding.secondaryColor||"#8b3dff"),
    "--b":String(branding.accentColor||"#00c8ff")
  } as CSSProperties;
  const replaceMessage=(input:unknown)=>String(input||"")
    .replaceAll("{hotel_name}",String(activity.hotel?.name||""))
    .replaceAll("{activity_name}",String(activity.activity?.name||""))
    .replaceAll("{venue_name}",String(activity.venue?.name||""));
  const activityStatus=String(activity.activity?.status||"");
  const endingSoon=activityStatus==="in_progress"&&targetSeconds>0&&remainingSeconds>0&&remainingSeconds<=900;
  const publicMessage=activityStatus==="finished"
    ? [brandingMessage("activityFinishedTitle"),brandingMessage("activityFinishedMessage")||brandingMessage("activityEndingMessage")]
    : activityStatus==="in_progress"&&!accepting
      ? [brandingMessage("requestsClosedTitle"),brandingMessage("requestsClosedMessage")]
      : activityStatus==="in_progress"
        ? [brandingMessage("inProgressTitle"),endingSoon&&brandingMessage("activityEndingMessage")?brandingMessage("activityEndingMessage"):brandingMessage("inProgressMessage")]
        : activityStatus==="scheduled"&&accepting
          ? [brandingMessage("beforeStartOpenTitle"),brandingMessage("beforeStartOpenMessage")]
          : activity.activity
            ? [brandingMessage("beforeStartClosedTitle"),brandingMessage("beforeStartClosedMessage")]
            : [brandingMessage("noActivityTitle"),brandingMessage("noActivityMessage")];
  const nextActivity=activity.upcomingActivities?.[0];
  const calendarStamp=(value:string|undefined)=>value
    ? new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")
    : "";
  const calendarUrl=nextActivity?.scheduledStartAt
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(nextActivity.activityName||moduleText.defaultActivity)}&dates=${calendarStamp(nextActivity.scheduledStartAt)}/${calendarStamp(new Date(new Date(nextActivity.scheduledStartAt).getTime()+(Number(nextActivity.durationSeconds)||7200)*1000).toISOString())}&details=${encodeURIComponent(activity.hotel?.publicUrl||"")}`
    : "";
  const moduleErrorText=moduleError==="REMINDER_REQUIRED"?moduleText.reminderRequired
    :moduleError==="REMINDER_FAILED"?moduleText.reminderFailed
    :moduleError==="RATING_REQUIRED"?moduleText.ratingRequired
    :moduleError==="REVIEW_FAILED"?moduleText.reviewFailed
    :moduleError==="UNSUBSCRIBED"?moduleText.unsubscribed
    :moduleError==="UNSUBSCRIBE_INVALID"?moduleText.unsubscribeInvalid
    :moduleError;

  useEffect(()=>{
    let mounted=true;
    const refreshStatus=async()=>{
      try{
        const query=new URLSearchParams({
          action:hotelCode?"publicBootstrap":"status",
          t:String(Date.now())
        });
        if(hotelCode)query.set("hotel",hotelCode);
        const data=await api(`${ENDPOINT}?${query.toString()}`,undefined,{transientRetries:2});
        if(mounted){
          hasLoadedPublicState.current=true;
          unavailableConfirmations.current=0;
          setAccepting(acceptingFrom(data));
          setActivity(stateFrom(data));
          setBootstrapError("");
        }
      }catch(error){
        const code=String((error as ApiResponse)?.code||"");
        if(mounted&&!hasLoadedPublicState.current&&code==="PUBLIC_LINK_NOT_FOUND"){
          unavailableConfirmations.current+=1;
          if(unavailableConfirmations.current>=3)setBootstrapError(hotelCode?"UNAVAILABLE":"");
        }
      }
    };
    refreshStatus();
    // Fifteen seconds is responsive for request-open/closed changes while
    // keeping the public page comfortably below Workers Free request limits.
    const id=window.setInterval(refreshStatus,15000);
    return()=>{mounted=false;clearInterval(id);};
  },[hotelCode]);

  useEffect(()=>{
    const id=window.setInterval(()=>setClockNow(Date.now()),1000);
    return()=>clearInterval(id);
  },[]);

  useEffect(()=>{
    if(lang&&!availableLanguages.some(language=>language[0]===lang))setLang(null);
  },[lang,allowedLanguageCodes.join(",")]);

  useEffect(()=>{
    if(!hotelCode)return;
    const query=new URLSearchParams(window.location.search);
    const recordId=query.get("unsubscribe");
    const token=query.get("token");
    if(!recordId||!token)return;
    void post({action:"unsubscribeGuest",publicCode:hotelCode,recordId,token})
      .then(()=>setModuleError("UNSUBSCRIBED"))
      .catch(()=>setModuleError("UNSUBSCRIBE_INVALID"));
  },[hotelCode]);

  const sendRequest=async(confirmDuplicate=false)=>{
    if(!complete||!accepting)return;
    setLoading(true);setSubmitError("");
    try{
      const data=await post({
        ...values,
        ...(hotelCode?{publicCode:hotelCode}:{}),
        guestDeviceId:guestDeviceId(),
        language:active[3],
        languageCode:active[0] === "es" ? "spanish" :
          active[0] === "en" ? "english" :
          active[0] === "fr" ? "french" :
          active[0] === "it" ? "italian" :
          active[0] === "de" ? "german" :
          active[0] === "ru" ? "russian" : "portuguese",
        confirmDuplicate
      },{transientRetries:5});
      setAccepting(acceptingFrom(data));
      setActivity(previous=>({...previous,...stateFrom(data)}));
      setDuplicateWarning(null);
      setDone(true);
    }catch(error){
      const detail=error as Error & {code?:string;duplicates?:DuplicateWarning};
      const code=detail.code;
      if(code==="CLOSED")setAccepting(false);
      if(code==="DUPLICATE_CONFIRMATION_REQUIRED"&&detail.duplicates){
        setDuplicateWarning(detail.duplicates);
      }else{
        setSubmitError(code==="CLOSED"?text.closedText:text.failed);
      }
    }finally{setLoading(false);}
  };
  const submit=(e:FormEvent)=>{
    e.preventDefault();setTouched({name:true,song:true,artist:true});
    void sendRequest(false);
  };
  const submitReminder=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setModuleError("");
    if(!reminderEmail||!reminderConsent){setModuleError("REMINDER_REQUIRED");return;}
    try{
      await post({action:"createGuestReminder",publicCode:hotelCode,guestEmail:reminderEmail,consent:true});
      setReminderSent(true);
    }catch{setModuleError("REMINDER_FAILED");}
  };
  const submitReview=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setModuleError("");
    if(reviewRating<1){setModuleError("RATING_REQUIRED");return;}
    try{
      const result=await post({
        action:"submitReview",publicCode:hotelCode,rating:reviewRating,comment:reviewComment,
        guestEmail:reviewEmail,guestContactConsent:Boolean(reviewEmail&&reviewConsent)
      });
      setReviewSent(true);setExternalReview(result.externalReview||null);
    }catch{setModuleError("REVIEW_FAILED");}
  };
  const reset=()=>{setValues({name:"",song:"",artist:"",comment:""});setTouched({});setSubmitError("");setDuplicateWarning(null);setMenu(false);setLang(null);setDone(false);};

  if(activity.googleFallback?.enabled&&activity.googleFallback.formUrl){
    const fallbackText=fallbackCopy[lang||"en"];
    return <main className="page fallbackPage" style={brandStyle}>
      <div className="ambient" aria-hidden="true"><i className="orb pink"/><i className="orb blue"/><ShieldCheck className="ghost microphone"/></div>
      <div className="brand">✦ {branding.showTeamIdentity!==false&&branding.teamDisplayName?String(branding.teamDisplayName):"GUEST STAR EXPERIENCE"}</div>
      {!lang?<motion.section className="card languageGate fallbackLanguageGate" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
        <div className="badge"><ShieldCheck size={31}/></div>
        <p className="eyebrow"><Sparkles size={14}/> LANGUAGE / IDIOMA</p>
        <h1>Select your language · Selecciona tu idioma</h1>
        <div className="languageGrid">{availableLanguages.map(x=><button type="button" key={x[0]} onClick={()=>setLang(x[0])}><span>{x[1]}</span><strong>{x[3]}</strong><Check size={18}/></button>)}</div>
      </motion.section>:<>
        <div className="selector"><button type="button" onClick={()=>setMenu(!menu)} aria-expanded={menu}>{active[1]} <span>{active[3]}</span><ChevronDown size={16}/></button>
          <AnimatePresence>{menu&&<motion.div className="menu" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>{availableLanguages.map(x=><button type="button" key={x[0]} onClick={()=>{setLang(x[0]);setMenu(false)}}>{x[1]} <span>{x[3]}</span>{x[0]===lang&&<Check size={15}/>}</button>)}</motion.div>}</AnimatePresence>
        </div>
        {activity.hotel&&<section className="tenantIdentity">
          {branding.showHotelLogo!==false&&(branding.hotelLogoUrl||branding.teamLogoUrl)&&<span className="tenantLogo" aria-hidden="true"><img src={normalizeBrandImageUrl(String(branding.hotelLogoUrl||branding.teamLogoUrl))} alt="" referrerPolicy="no-referrer"/></span>}
          <div>{branding.showHotelName!==false&&<strong>{activity.hotel.name}</strong>}<span>{[activity.venue?.name,activity.activity?.name].filter(Boolean).join(" · ")}</span></div>
        </section>}
        <motion.section className="card googleFallbackCard" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
          <div className="fallbackShield"><ShieldCheck size={38}/></div>
          <p className="eyebrow"><Sparkles size={14}/> {fallbackText.eyebrow}</p>
          <h1>{fallbackText.title}</h1>
          <p>{fallbackText.body}</p>
          <a className="submit googleFallbackAction" href={activity.googleFallback.formUrl} target="_blank" rel="noreferrer"><ShieldCheck size={20}/>{fallbackText.action}<ArrowRight size={18}/></a>
          <button type="button" className="fallbackLanguage" onClick={()=>{setLang(null);setMenu(false)}}>{fallbackText.language}</button>
        </motion.section>
      </>}
    </main>;
  }

  return <main className="page" style={brandStyle}>
    <div className="ambient" aria-hidden="true"><i className="orb pink"/><i className="orb blue"/>{["♪","♫","✦","♬"].map((n,i)=><motion.span className={`note n${i}`} key={i} animate={{y:[0,-18,0],rotate:[-7,7,-7]}} transition={{duration:4+i,repeat:Infinity}}>{n}</motion.span>)}<Headphones className="ghost headphones"/><Mic2 className="ghost microphone"/></div>
    <div className="brand">✦ {branding.showTeamIdentity!==false&&branding.teamDisplayName?String(branding.teamDisplayName):"GUEST STAR EXPERIENCE"}</div>
    <AnimatePresence>{duplicateWarning&&<motion.div className="duplicateBackdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
      <motion.section className="duplicateDialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title" initial={{opacity:0,scale:.94,y:14}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.96,y:10}}>
        <span className="duplicateIcon">!</span><h2 id="duplicate-title">{warningText.title}</h2>
        {duplicateWarning.repeatedSinger&&<p>{warningText.singer}</p>}
        {duplicateWarning.duplicateSong&&<p>{duplicateWarning.duplicateSongState==="completed"?warningText.completed:warningText.active}</p>}
        <strong>{warningText.question}</strong>
        <div><button type="button" onClick={()=>setDuplicateWarning(null)}>{warningText.cancel}</button><button type="button" className="continue" disabled={loading} onClick={()=>void sendRequest(true)}>{loading?text.sending:warningText.continue}</button></div>
      </motion.section>
    </motion.div>}</AnimatePresence>
    {!lang?<motion.section className="card languageGate" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
      <div className="badge"><Mic2 size={31}/></div>
      <p className="eyebrow"><Sparkles size={14}/> SONG LANGUAGE</p>
      <h1>What language will you sing in?</h1>
      <p>Choose a language before completing your request. This helps us find the best karaoke version and lets the host know your selection.</p>
      <div className="languageGrid">{availableLanguages.map(x=><button type="button" key={x[0]} onClick={()=>setLang(x[0])}><span>{x[1]}</span><strong>{x[2]}</strong><Check size={18}/></button>)}</div>
    </motion.section>:<>
    <div className="selector"><button type="button" onClick={()=>setMenu(!menu)} aria-expanded={menu}>{active[1]} <span>{active[3]}</span><ChevronDown size={16}/></button>
      <AnimatePresence>{menu&&<motion.div className="menu" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>{availableLanguages.map(x=><button type="button" key={x[0]} onClick={()=>{setLang(x[0]);setMenu(false)}}>{x[1]} <span>{x[3]}</span>{x[0]===lang&&<Check size={15}/>}</button>)}</motion.div>}</AnimatePresence>
    </div>
    {bootstrapError&&<section className="tenantError" role="alert"><strong>{moduleText.unavailableTitle}</strong><span>{moduleText.unavailableText}</span></section>}
    {activity.hotel&&<section className="tenantIdentity">
      {branding.showHotelLogo!==false&&(branding.hotelLogoUrl||branding.teamLogoUrl)&&<span className="tenantLogo" aria-hidden="true"><img src={normalizeBrandImageUrl(String(branding.hotelLogoUrl||branding.teamLogoUrl))} alt="" referrerPolicy="no-referrer"/></span>}
      <div>
        {branding.showHotelName!==false&&<strong>{activity.hotel.name}</strong>}
        {branding.showActivityDetails!==false&&<span>{[activity.venue?.name,activity.activity?.name].filter(Boolean).join(" · ")}</span>}
      </div>
    </section>}
    {brandingMessage("welcomeMessage")&&<section className="publicMessage welcomeMessage"><p>{replaceMessage(brandingMessage("welcomeMessage"))}</p></section>}
    {(publicMessage[0]||publicMessage[1])&&<section className="publicMessage">
      {publicMessage[0]&&<strong>{replaceMessage(publicMessage[0])}</strong>}
      {publicMessage[1]&&<p>{replaceMessage(publicMessage[1])}</p>}
    </section>}
    {!activityRunning&&activity.activity?.showCountdown&&countdownSeconds>0&&<motion.section className="publicCountdown" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}}>
      <Clock3 size={18}/><span><small>{moduleText.startsIn}</small><strong>{activityDuration(countdownSeconds)}</strong></span>
    </motion.section>}
    <AnimatePresence>{activity.showPublicStatus&&<motion.section className="publicActivityStatus" role="status" initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}>
      <div className="publicActivityHead"><span className={`activityPulse ${activityFinished?"finished":activityRunning?"running":"waiting"}`}/><div><small>{statusText.label}</small><strong>{activityFinished?statusText.finished:activityRunning?statusText.running:statusText.notStarted}</strong></div></div>
      <div className="publicActivityMetrics"><div><Clock3 size={17}/><span><small>{statusText.elapsed}</small><strong>{activityDuration(elapsedSeconds)}</strong></span></div><div><Hourglass size={17}/><span><small>{statusText.remaining}</small><strong>{activityDuration(remainingSeconds)}</strong></span></div><div><UsersRound size={18}/><span><small>{statusText.queue}</small><strong>{queuePeopleCount}</strong></span></div></div>
    </motion.section>}</AnimatePresence>
    <motion.div className="card" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
      {!done?<><header><div className="badge"><Mic2 size={31}/></div><p className="eyebrow"><Sparkles size={14}/> {text.live}</p><h1>{text.title}</h1><h2>{text.sub}</h2><p className="desc">{text.desc}</p></header>
      {accepting?<form onSubmit={submit}>{(["name","song","artist","comment"] as FieldKey[]).map(k=>{const Icon=icons[k],required=k!=="comment",bad=required&&touched[k]&&!values[k].trim();return <div className="field" key={k}><label htmlFor={k}>{text.fields[k][0]} {required&&<b>*</b>}</label><div className={`input ${bad?"bad":""}`}><Icon size={20}/>{k==="comment"?<textarea id={k} value={values[k]} placeholder={text.fields[k][1]} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>:<input id={k} required value={values[k]} placeholder={text.fields[k][1]} onBlur={()=>setTouched(t=>({...t,[k]:true}))} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>}</div>{bad&&<p>{text.error}</p>}</div>})}
        <button className="submit" disabled={!complete||loading}>{loading?<><i className="loader"/>{text.sending}</>:<><Mic2 size={21}/>{text.submit}<Send className="send" size={17}/></>}</button>{submitError&&<p className="submitError" role="alert">{submitError}</p>}
      </form>:<section className="closedState"><span><XCircle size={45}/></span><h3>{text.closed}</h3><p>{text.closedText}</p></section>}</>:<section className="success"><motion.div className="successMic" animate={{y:[0,-10,0],rotate:[-5,5,-5]}} transition={{duration:2,repeat:Infinity}}><Mic2 size={55}/></motion.div><span className="check"><Check size={31}/></span><h2>🎉 {text.success}</h2><p>{text.stage}</p><button className="submit secondary" onClick={reset}><RotateCcw size={19}/>{text.again}</button></section>}
    </motion.div>
    {nextActivity&&branding.showNextActivity!==false&&<section className="publicModule nextActivity">
      <div className="moduleIcon"><CalendarPlus/></div><div><small>{moduleText.nextActivity}</small><strong>{nextActivity.activityName||moduleText.defaultActivity}</strong><p>{replaceMessage(brandingMessage("upcomingActivityMessage"))||[nextActivity.venueName,new Date(String(nextActivity.scheduledStartAt)).toLocaleString(languageLocales[lang||"en"])].filter(Boolean).join(" · ")}</p></div>
      <div className="moduleActions">{branding.showAddToCalendar!==false&&calendarUrl&&<a href={calendarUrl} target="_blank" rel="noreferrer"><CalendarPlus/>{moduleText.addCalendar}</a>}</div>
      {branding.showRemindMe===true&&!reminderSent&&<form onSubmit={submitReminder}><label><Mail/><input type="email" value={reminderEmail} onChange={e=>setReminderEmail(e.target.value)} placeholder={moduleText.reminderEmail} required/></label><label className="consent"><input type="checkbox" checked={reminderConsent} onChange={e=>setReminderConsent(e.target.checked)}/> {moduleText.reminderConsent}</label><button><Bell/>{moduleText.remindMe}</button></form>}
      {reminderSent&&<p className="moduleSuccess">✓ {moduleText.reminderScheduled}</p>}
    </section>}
    {(activityStatus==="finished"||activityFinished)&&branding.showInternalRating===true&&<section className="publicModule reviewModule">
      <div className="moduleIcon"><Star/></div><div><small>{moduleText.reviewLabel}</small><strong>{replaceMessage(brandingMessage("reviewInvitationMessage"))||moduleText.reviewInvitation}</strong><p>{replaceMessage(brandingMessage("generalReviewMessage"))||moduleText.reviewGeneral}</p></div>
      {!reviewSent?<form onSubmit={submitReview}><div className="rating" aria-label={moduleText.ratingLabel}>{[1,2,3,4,5].map(rating=><button type="button" key={rating} className={reviewRating>=rating?"active":""} aria-label={`${rating} ${rating===1?moduleText.star:moduleText.stars}`} onClick={()=>setReviewRating(rating)}><Star/></button>)}</div><textarea value={reviewComment} onChange={e=>setReviewComment(e.target.value)} placeholder={moduleText.optionalComment}/><input type="email" value={reviewEmail} onChange={e=>setReviewEmail(e.target.value)} placeholder={moduleText.optionalEmail}/>{reviewEmail&&branding.offerFollowUp===true&&<label className="consent"><input type="checkbox" checked={reviewConsent} onChange={e=>setReviewConsent(e.target.checked)}/> {moduleText.followUpConsent}</label>}<button className="reviewSubmit">{moduleText.submitReview}</button></form>:<p className="moduleSuccess">✓ {moduleText.reviewSaved}</p>}
      {externalReview?.url&&<a className="externalReview" href={externalReview.url} target="_blank" rel="noreferrer">{moduleText.separateReview.replace("{provider}",externalReview.provider||moduleText.hotel)} <ArrowRight/></a>}
    </section>}
    {branding.showExternalReview===true&&branding.externalReviewUrl&&!(externalReview?.url)&&<a className="publicModule externalOnly" href={String(branding.externalReviewUrl)} target="_blank" rel="noreferrer">{moduleText.optionalExternalReview.replace("{provider}",String(branding.externalReviewProvider||moduleText.hotel))} <ArrowRight/></a>}
    {moduleErrorText&&<p className="moduleNotice" role="status">{moduleErrorText}</p>}
    <footer>{text.steps.map((x,i)=><div className="stepWrap" key={x}><div className="step">{i===0?<MessageCircleMore/>:i===1?<Music2/>:<Mic2/>}<span>{x}</span></div>{i<2&&<ArrowRight className="arrow" size={16}/>}</div>)}</footer>
    </>}
  </main>;
}
