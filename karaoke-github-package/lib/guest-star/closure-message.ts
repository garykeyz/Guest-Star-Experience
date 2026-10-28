// Public closure notice only; uses the existing activity clock and hotel timezone.
export function closureMessage(state: {activityStartedAt?: string; activityHours?: number; hotel?: {timezone?: string}}, language = "en") {
  const start = Date.parse(String(state.activityStartedAt || ""));
  const seconds = Math.max(0, Number(state.activityHours) || 0) * 3600;
  const labels: Record<string, [string, string]> = {
    es: ["Las solicitudes están cerradas.", "La actividad está prevista para finalizar aproximadamente a las"],
    en: ["Requests are closed.", "The activity is expected to finish at approximately"],
    fr: ["Les demandes sont fermées.", "La fin de l’activité est prévue vers"],
    it: ["Le richieste sono chiuse.", "La fine dell’attività è prevista verso le"],
    de: ["Songwünsche sind geschlossen.", "Die Veranstaltung endet voraussichtlich gegen"],
    ru: ["Приём заявок закрыт.", "Мероприятие завершится примерно в"],
    pt: ["Os pedidos estão encerrados.", "A atividade deverá terminar aproximadamente às"],
    hi: ["रिक्वेस्ट बंद हैं।", "कार्यक्रम लगभग इस समय समाप्त होगा:"]
  };
  const [closed, end] = labels[language] || labels.en;
  const locale: Record<string,string> = {es:"es-DO",en:"en-US",fr:"fr-FR",it:"it-IT",de:"de-DE",ru:"ru-RU",pt:"pt-BR",hi:"hi-IN"};
  if (!Number.isFinite(start) || !seconds) return closed;
  const time = new Date(start + seconds * 1000).toLocaleTimeString(locale[language] || "en-US", {hour:"numeric",minute:"2-digit",timeZone:state.hotel?.timezone || "America/Santo_Domingo"});
  return `${closed} ${end} ${time}.`;
}
