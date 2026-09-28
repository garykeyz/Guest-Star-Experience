// Canonical guest-facing locale catalog. This file is bundled into the
// Cloudflare Request and shipped unchanged inside Guest Star.app, so public,
// kiosk and Star Screen surfaces never need a translations API or D1 read.
export const GUEST_LANGUAGE_CODES = Object.freeze(["es", "en", "fr", "it", "de", "ru", "pt", "hi"]);

export const GUEST_LANGUAGES = Object.freeze([
  Object.freeze({ code: "es", flag: "🇪🇸", englishName: "Spanish", nativeName: "Español", songCode: "spanish", locale: "es-DO" }),
  Object.freeze({ code: "en", flag: "🇺🇸", englishName: "English", nativeName: "English", songCode: "english", locale: "en-US" }),
  Object.freeze({ code: "fr", flag: "🇫🇷", englishName: "French", nativeName: "Français", songCode: "french", locale: "fr-FR" }),
  Object.freeze({ code: "it", flag: "🇮🇹", englishName: "Italian", nativeName: "Italiano", songCode: "italian", locale: "it-IT" }),
  Object.freeze({ code: "de", flag: "🇩🇪", englishName: "German", nativeName: "Deutsch", songCode: "german", locale: "de-DE" }),
  Object.freeze({ code: "ru", flag: "🇷🇺", englishName: "Russian", nativeName: "Русский", songCode: "russian", locale: "ru-RU" }),
  Object.freeze({ code: "pt", flag: "🇵🇹", englishName: "Portuguese", nativeName: "Português", songCode: "portuguese", locale: "pt-PT" }),
  Object.freeze({ code: "hi", flag: "🇮🇳", englishName: "Hindi", nativeName: "हिन्दी", songCode: "hindi", locale: "hi-IN" })
]);

export const LANGUAGE_BY_CODE = Object.freeze(Object.fromEntries(GUEST_LANGUAGES.map((language) => [language.code, language])));

export const GUEST_UI_COPY = Object.freeze({
  en: Object.freeze({
    enter:"Enter Activity PIN", hint:"Ask the host for the six-digit PIN for this activity.", joining:"Joining activity…",
    invalid:"That PIN is not correct.", expired:"That PIN has expired.", ended:"Tonight's show has ended.", changed:"Activity PIN has changed.",
    linkExpired:"This activity link has expired.", rate:"Too many attempts. Please wait a moment.", newPin:"Enter New Activity PIN", clear:"Clear",
    enterButton:"Join Activity", another:"Join another activity", yourActivities:"Your activities", savedActivities:"Saved Activities", save:"Save this activity",
    saved:"Saved", setDefault:"Set as default", default:"Default", switchActivity:"Switch Activity", forget:"Forget Activity", access:"Activity Access",
    share:"Share this activity", next:"Next show", compactNext:"Next", noDate:"No new date has been announced yet.", compactNoDate:"No new date announced",
    closed:"Requests open when the show begins.", expiredAccess:"Access expired. Enter the new Activity PIN to reconnect.", startsIn:"Starts in",
    showQr:"Show QR", closeQr:"Close QR", unavailable:"Connection unavailable. Try again in a moment.", scan:"Scan here to sing",
    touch:"Touch anywhere to request on this kiosk"
  }),
  es: Object.freeze({
    enter:"Ingresa el PIN de la actividad", hint:"Pide al anfitrión el PIN de seis dígitos de esta actividad.", joining:"Conectando con la actividad…",
    invalid:"Ese PIN no es correcto.", expired:"Ese PIN ha expirado.", ended:"El show de hoy ha finalizado.", changed:"El PIN de la actividad ha cambiado.",
    linkExpired:"El enlace de esta actividad ha expirado.", rate:"Demasiados intentos. Espera un momento.", newPin:"Ingresar nuevo PIN de la actividad", clear:"Borrar",
    enterButton:"Entrar a la actividad", another:"Agregar otra actividad", yourActivities:"Tus actividades", savedActivities:"Actividades guardadas", save:"Guardar esta actividad",
    saved:"Guardada", setDefault:"Establecer como predeterminada", default:"Predeterminada", switchActivity:"Cambiar actividad", forget:"Olvidar actividad", access:"Acceso a la actividad",
    share:"Compartir esta actividad", next:"Próximo show", compactNext:"Próximo", noDate:"Todavía no hay nueva fecha anunciada.", compactNoDate:"Sin nueva fecha anunciada",
    closed:"Las solicitudes se abren al comenzar el show.", expiredAccess:"Acceso vencido. Ingresa el nuevo PIN de la actividad.", startsIn:"Comienza en",
    showQr:"Mostrar QR", closeQr:"Cerrar QR", unavailable:"No hay conexión. Inténtalo de nuevo en un momento.", scan:"Escanea para cantar",
    touch:"Toca la pantalla para solicitar aquí"
  }),
  fr: Object.freeze({
    enter:"Saisissez le PIN de l'activité", hint:"Demandez à l’animateur le PIN à six chiffres de cette activité.", joining:"Connexion à l’activité…",
    invalid:"Ce PIN est incorrect.", expired:"Ce PIN a expiré.", ended:"Le spectacle de ce soir est terminé.", changed:"Le PIN de l'activité a changé.",
    linkExpired:"Le lien de cette activité a expiré.", rate:"Trop de tentatives. Veuillez patienter.", newPin:"Saisir le nouveau PIN", clear:"Effacer",
    enterButton:"Rejoindre l’activité", another:"Ajouter une autre activité", yourActivities:"Vos activités", savedActivities:"Activités enregistrées", save:"Enregistrer cette activité",
    saved:"Enregistrée", setDefault:"Définir par défaut", default:"Par défaut", switchActivity:"Changer d'activité", forget:"Oublier l'activité", access:"Accès à l'activité",
    share:"Partager cette activité", next:"Prochain spectacle", compactNext:"Prochain", noDate:"Aucune nouvelle date n'a encore été annoncée.", compactNoDate:"Aucune nouvelle date annoncée",
    closed:"Les demandes ouvrent au début du spectacle.", expiredAccess:"Accès expiré. Saisissez le nouveau PIN de l'activité.", startsIn:"Commence dans",
    showQr:"Afficher le QR", closeQr:"Fermer le QR", unavailable:"Connexion indisponible. Réessayez dans un instant.", scan:"Scannez ici pour chanter",
    touch:"Touchez l’écran pour faire une demande ici"
  }),
  it: Object.freeze({
    enter:"Inserisci il PIN dell’attività", hint:"Chiedi al presentatore il PIN di sei cifre di questa attività.", joining:"Connessione all’attività…",
    invalid:"Il PIN non è corretto.", expired:"Il PIN è scaduto.", ended:"Lo spettacolo di stasera è terminato.", changed:"Il PIN dell’attività è cambiato.",
    linkExpired:"Il link di questa attività è scaduto.", rate:"Troppi tentativi. Attendi un momento.", newPin:"Inserisci il nuovo PIN", clear:"Cancella",
    enterButton:"Entra nell’attività", another:"Aggiungi un’altra attività", yourActivities:"Le tue attività", savedActivities:"Attività salvate", save:"Salva questa attività",
    saved:"Salvata", setDefault:"Imposta come predefinita", default:"Predefinita", switchActivity:"Cambia attività", forget:"Dimentica attività", access:"Accesso all’attività",
    share:"Condividi questa attività", next:"Prossimo spettacolo", compactNext:"Prossimo", noDate:"Non è stata ancora annunciata una nuova data.", compactNoDate:"Nessuna nuova data",
    closed:"Le richieste si aprono quando inizia lo spettacolo.", expiredAccess:"Accesso scaduto. Inserisci il nuovo PIN.", startsIn:"Inizia tra",
    showQr:"Mostra QR", closeQr:"Chiudi QR", unavailable:"Connessione non disponibile. Riprova tra poco.", scan:"Scansiona per cantare",
    touch:"Tocca lo schermo per fare una richiesta"
  }),
  de: Object.freeze({
    enter:"Aktivitäts-PIN eingeben", hint:"Frag den Host nach der sechsstelligen PIN für diese Aktivität.", joining:"Verbindung zur Aktivität wird hergestellt…",
    invalid:"Diese PIN ist nicht korrekt.", expired:"Diese PIN ist abgelaufen.", ended:"Die heutige Show ist beendet.", changed:"Die Aktivitäts-PIN wurde geändert.",
    linkExpired:"Der Link zu dieser Aktivität ist abgelaufen.", rate:"Zu viele Versuche. Bitte warte einen Moment.", newPin:"Neue Aktivitäts-PIN eingeben", clear:"Löschen",
    enterButton:"Aktivität beitreten", another:"Weitere Aktivität hinzufügen", yourActivities:"Deine Aktivitäten", savedActivities:"Gespeicherte Aktivitäten", save:"Aktivität speichern",
    saved:"Gespeichert", setDefault:"Als Standard festlegen", default:"Standard", switchActivity:"Aktivität wechseln", forget:"Aktivität vergessen", access:"Aktivitätszugang",
    share:"Aktivität teilen", next:"Nächste Show", compactNext:"Als Nächstes", noDate:"Es wurde noch kein neuer Termin angekündigt.", compactNoDate:"Kein neuer Termin",
    closed:"Songwünsche sind ab Showbeginn möglich.", expiredAccess:"Zugang abgelaufen. Gib die neue Aktivitäts-PIN ein.", startsIn:"Beginnt in",
    showQr:"QR anzeigen", closeQr:"QR schließen", unavailable:"Verbindung nicht verfügbar. Versuch es gleich noch einmal.", scan:"Scannen und mitsingen",
    touch:"Tippe auf den Bildschirm, um einen Song zu wünschen"
  }),
  ru: Object.freeze({
    enter:"Введите PIN мероприятия", hint:"Узнайте шестизначный PIN у ведущего.", joining:"Подключение к мероприятию…",
    invalid:"Неверный PIN.", expired:"Срок действия PIN истёк.", ended:"Сегодняшнее шоу завершено.", changed:"PIN мероприятия изменён.",
    linkExpired:"Срок действия ссылки истёк.", rate:"Слишком много попыток. Подождите.", newPin:"Ввести новый PIN", clear:"Очистить",
    enterButton:"Войти", another:"Добавить другое мероприятие", yourActivities:"Ваши мероприятия", savedActivities:"Сохранённые мероприятия", save:"Сохранить",
    saved:"Сохранено", setDefault:"По умолчанию", default:"По умолчанию", switchActivity:"Сменить мероприятие", forget:"Забыть", access:"Доступ",
    share:"Поделиться", next:"Следующее шоу", compactNext:"Далее", noDate:"Новая дата пока не объявлена.", compactNoDate:"Дата не объявлена",
    closed:"Приём заявок начнётся с началом шоу.", expiredAccess:"Доступ истёк. Введите новый PIN.", startsIn:"До начала",
    showQr:"Показать QR", closeQr:"Закрыть QR", unavailable:"Нет связи. Повторите чуть позже.", scan:"Сканируйте, чтобы спеть",
    touch:"Коснитесь экрана, чтобы выбрать песню"
  }),
  pt: Object.freeze({
    enter:"Introduza o PIN da atividade", hint:"Peça ao anfitrião o PIN de seis dígitos desta atividade.", joining:"A ligar à atividade…",
    invalid:"O PIN não está correto.", expired:"O PIN expirou.", ended:"O espetáculo de hoje terminou.", changed:"O PIN da atividade mudou.",
    linkExpired:"O link desta atividade expirou.", rate:"Demasiadas tentativas. Aguarde um momento.", newPin:"Introduzir novo PIN", clear:"Limpar",
    enterButton:"Entrar na atividade", another:"Adicionar outra atividade", yourActivities:"As suas atividades", savedActivities:"Atividades guardadas", save:"Guardar esta atividade",
    saved:"Guardada", setDefault:"Definir como predefinida", default:"Predefinida", switchActivity:"Mudar de atividade", forget:"Esquecer atividade", access:"Acesso à atividade",
    share:"Partilhar esta atividade", next:"Próximo espetáculo", compactNext:"Próximo", noDate:"Ainda não foi anunciada uma nova data.", compactNoDate:"Sem nova data",
    closed:"Os pedidos abrem quando o espetáculo começa.", expiredAccess:"O acesso expirou. Introduza o novo PIN.", startsIn:"Começa em",
    showQr:"Mostrar QR", closeQr:"Fechar QR", unavailable:"Ligação indisponível. Tente novamente em breve.", scan:"Leia o QR para cantar",
    touch:"Toque no ecrã para fazer um pedido"
  }),
  hi: Object.freeze({
    enter:"एक्टिविटी PIN दर्ज करें", hint:"इस एक्टिविटी का छह अंकों वाला PIN होस्ट से पूछें।", joining:"एक्टिविटी से जुड़ रहे हैं…",
    invalid:"यह PIN सही नहीं है।", expired:"यह PIN समाप्त हो गया है।", ended:"आज का शो समाप्त हो गया है।", changed:"एक्टिविटी PIN बदल गया है।",
    linkExpired:"इस एक्टिविटी का लिंक समाप्त हो गया है।", rate:"बहुत अधिक प्रयास। कुछ देर प्रतीक्षा करें।", newPin:"नया एक्टिविटी PIN दर्ज करें", clear:"मिटाएँ",
    enterButton:"एक्टिविटी में प्रवेश करें", another:"एक और एक्टिविटी जोड़ें", yourActivities:"आपकी एक्टिविटी", savedActivities:"सहेजी गई एक्टिविटी", save:"इस एक्टिविटी को सहेजें",
    saved:"सहेजी गई", setDefault:"डिफ़ॉल्ट बनाएँ", default:"डिफ़ॉल्ट", switchActivity:"एक्टिविटी बदलें", forget:"हटाएँ", access:"एक्टिविटी एक्सेस",
    share:"इस एक्टिविटी को शेयर करें", next:"अगला शो", compactNext:"अगला", noDate:"अभी तक नई तारीख़ घोषित नहीं हुई है।", compactNoDate:"नई तारीख़ घोषित नहीं",
    closed:"शो शुरू होने पर रिक्वेस्ट खुलेंगे।", expiredAccess:"एक्सेस समाप्त। नया एक्टिविटी PIN दर्ज करें।", startsIn:"शुरू होने में",
    showQr:"QR दिखाएँ", closeQr:"QR बंद करें", unavailable:"कनेक्शन उपलब्ध नहीं है। कुछ देर बाद फिर कोशिश करें।", scan:"गाने के लिए स्कैन करें",
    touch:"यहाँ रिक्वेस्ट करने के लिए स्क्रीन छुएँ"
  })
});

export const FUNNY_MESSAGES = Object.freeze({
  en: Object.freeze({waitingSinger:["The mic is ready. Who's brave enough? 🎤","Your stage is waiting."],preparingSong:["Warming up the spotlight…","Your karaoke moment is loading."],nextSinger:["You're up next—breathe, smile, sing!","The next Guest Star is almost on."],requestIdle:["Can't decide? Let fate pick the mic. 🎤","The perfect song is one tap away."],kioskIdle:["Scan here to sing 🎤","Don't be shy. We know you sing in the shower."],countdown:["The stage lights are warming up.","Almost showtime!"],activityStarting:["Voices ready. Lights ready. Let's go!","The show is about to begin."],betweenSongs:["Applause loading… next voice up!","One song ends. Another star begins."],planB:["Can't decide? Let fate pick the mic. 🎤"]}),
  es: Object.freeze({waitingSinger:["El micrófono está listo. ¿Quién se atreve? 🎤","El escenario te está esperando."],preparingSong:["Preparando las luces del escenario…","Tu momento karaoke está cargando."],nextSinger:["¡Sigues tú: respira, sonríe y canta!","La próxima Guest Star ya casi sube."],requestIdle:["¿No te decides? Que el karaoke decida. 🎤","Tu canción perfecta está a un toque."],kioskIdle:["Escanea para cantar 🎤","No seas tímido… sabemos que cantas en la ducha."],countdown:["Las luces del escenario se están encendiendo.","¡Ya casi empieza el show!"],activityStarting:["Voces listas. Luces listas. ¡Vamos!","El show está a punto de comenzar."],betweenSongs:["Cargando aplausos… ¡sigue otra voz!","Termina una canción y nace otra estrella."],planB:["¿No te decides? Que el karaoke decida. 🎤"]}),
  fr: Object.freeze({waitingSinger:["Le micro est prêt. Qui ose se lancer ? 🎤","La scène vous attend."],preparingSong:["Les projecteurs se préparent…","Votre moment karaoké arrive."],nextSinger:["À vous ensuite : respirez, souriez, chantez !","La prochaine Guest Star arrive."],requestIdle:["Indécis ? Laissez le karaoké choisir. 🎤","La chanson idéale est à un geste."],kioskIdle:["Scannez pour chanter 🎤","N'ayez pas peur… on sait que vous chantez sous la douche."],countdown:["Les lumières de la scène s'allument.","Le spectacle commence bientôt !"],activityStarting:["Voix prêtes. Lumières prêtes. C'est parti !","Le spectacle va commencer."],betweenSongs:["Applaudissements en cours…","Une chanson finit, une autre star arrive."],planB:["Indécis ? Laissez le karaoké choisir. 🎤"]}),
  it: Object.freeze({waitingSinger:["Il microfono è pronto. Chi ha coraggio? 🎤","Il palco ti aspetta."],preparingSong:["Accendiamo i riflettori…","Il tuo momento karaoke sta arrivando."],nextSinger:["Tocca a te: respira, sorridi e canta!","La prossima Guest Star sta per salire."],requestIdle:["Non sai decidere? Lascia scegliere al karaoke. 🎤","La canzone perfetta è a un tocco."],kioskIdle:["Scansiona per cantare 🎤","Non essere timido… sappiamo che canti sotto la doccia."],countdown:["Le luci del palco si stanno accendendo.","Manca poco allo show!"],activityStarting:["Voci pronte. Luci pronte. Si parte!","Lo show sta per cominciare."],betweenSongs:["Applausi in arrivo…","Finisce una canzone, arriva una nuova star."],planB:["Non sai decidere? Lascia scegliere al karaoke. 🎤"]}),
  de: Object.freeze({waitingSinger:["Das Mikro ist bereit. Wer traut sich? 🎤","Die Bühne wartet auf dich."],preparingSong:["Das Rampenlicht wird vorbereitet…","Dein Karaoke-Moment wird geladen."],nextSinger:["Du bist gleich dran: atmen, lächeln, singen!","Der nächste Guest Star kommt gleich."],requestIdle:["Unentschlossen? Lass das Karaoke wählen. 🎤","Der perfekte Song ist nur einen Tipp entfernt."],kioskIdle:["Scannen und mitsingen 🎤","Keine Scheu… wir wissen, dass du unter der Dusche singst."],countdown:["Die Bühnenlichter werden warm.","Gleich beginnt die Show!"],activityStarting:["Stimmen bereit. Licht bereit. Los geht's!","Die Show beginnt gleich."],betweenSongs:["Applaus wird geladen…","Ein Song endet, der nächste Star beginnt."],planB:["Unentschlossen? Lass das Karaoke wählen. 🎤"]}),
  ru: Object.freeze({waitingSinger:["Микрофон готов. Кто смелый? 🎤","Сцена ждёт вас."],preparingSong:["Готовим свет и музыку…","Ваш караоке-момент уже близко."],nextSinger:["Вы следующий: вдох, улыбка, песня!","Следующая Guest Star уже готова."],requestIdle:["Не можете выбрать? Пусть караоке решит. 🎤","Идеальная песня — в одном касании."],kioskIdle:["Сканируйте, чтобы спеть 🎤","Не стесняйтесь… мы знаем, что вы поёте в душе."],countdown:["Сцена зажигает огни.","Скоро начнётся шоу!"],activityStarting:["Голоса готовы. Свет готов. Начинаем!","Шоу вот-вот начнётся."],betweenSongs:["Загружаем аплодисменты…","Одна песня кончилась — новая звезда выходит."],planB:["Не можете выбрать? Пусть караоке решит. 🎤"]}),
  pt: Object.freeze({waitingSinger:["O microfone está pronto. Quem se atreve? 🎤","O palco espera por você."],preparingSong:["Preparando as luzes do palco…","O seu momento de karaokê está chegando."],nextSinger:["Você é o próximo: respire, sorria e cante!","A próxima Guest Star está quase no palco."],requestIdle:["Não consegue decidir? Deixe o karaokê escolher. 🎤","A música perfeita está a um toque."],kioskIdle:["Leia o QR para cantar 🎤","Não tenha vergonha… sabemos que você canta no banho."],countdown:["As luzes do palco estão aquecendo.","O show vai começar!"],activityStarting:["Vozes prontas. Luzes prontas. Vamos!","O show está prestes a começar."],betweenSongs:["Carregando aplausos…","Uma música termina, outra estrela começa."],planB:["Não consegue decidir? Deixe o karaokê escolher. 🎤"]}),
  hi: Object.freeze({waitingSinger:["माइक तैयार है। अब कौन हिम्मत करेगा? 🎤","मंच आपका इंतज़ार कर रहा है।"],preparingSong:["मंच की रोशनी तैयार हो रही है…","आपका कराओके मोमेंट बस आने वाला है।"],nextSinger:["अगले आप हैं—साँस लें, मुस्कुराएँ और गाएँ!","अगली Guest Star मंच पर आने वाली है।"],requestIdle:["चुन नहीं पा रहे? कराओके को चुनने दें। 🎤","आपका परफ़ेक्ट गाना बस एक टैप दूर है।"],kioskIdle:["गाने के लिए स्कैन करें 🎤","शर्माएँ नहीं… हम जानते हैं आप शावर में गाते हैं।"],countdown:["मंच की लाइटें जल रही हैं।","शो बस शुरू होने वाला है!"],activityStarting:["आवाज़ तैयार। रोशनी तैयार। चलिए शुरू करते हैं!","शो शुरू होने वाला है।"],betweenSongs:["तालियाँ लोड हो रही हैं…","एक गाना ख़त्म, अगला सितारा तैयार।"],planB:["चुन नहीं पा रहे? कराओके को चुनने दें। 🎤"]})
});

export const KIOSK_ATTRACT_CTA = Object.freeze({
  en:"SCAN TO SING", es:"ESCANEA PARA CANTAR", fr:"SCANNEZ POUR CHANTER", it:"SCANSIONA PER CANTARE",
  de:"SCANNEN & SINGEN", ru:"СКАНИРУЙТЕ И ПОЙТЕ", pt:"ESCANEIE PARA CANTAR", hi:"गाने के लिए स्कैन करें"
});

export const STAR_SCREEN_COPY = Object.freeze({
  en:{lineup:"UP NEXT ON STAGE",next:"NEXT",queued:"IN LINE",first:"Be the first to sing!",scan:"Scan the QR to request a song.",now:"PLAYING NOW",background:"Background music",waiting:"Waiting for requests",requestedSong:"Requested song",want:"WANT TO SING?",scanQr:"SCAN THE QR",activityPin:"ACTIVITY PIN",startsIn:"STARTS IN",liveAtHotel:"LIVE AT THE HOTEL",inviteNote:"YOUR MOMENT · YOUR SONG · YOUR STAGE",requestQrAlt:"QR code to request a song",activityQrAlt:"QR code to join the activity",finalTitle:"THANK YOU FOR JOINING US",finalMessage:"See you next time.",returns:"WE'LL BE BACK",dedication:"DEDICATION"},
  es:{lineup:"PRÓXIMOS EN EL ESCENARIO",next:"SIGUIENTE",queued:"EN FILA",first:"¡Sé el primero en cantar!",scan:"Escanea el QR para solicitar una canción.",now:"SONANDO AHORA",background:"Música de fondo",waiting:"Esperando solicitudes",requestedSong:"Canción solicitada",want:"¿QUIERES CANTAR?",scanQr:"ESCANEA EL QR",activityPin:"PIN DE ACTIVIDAD",startsIn:"COMIENZA EN",liveAtHotel:"EN VIVO EN EL HOTEL",inviteNote:"TU MOMENTO · TU CANCIÓN · TU ESCENARIO",requestQrAlt:"QR para solicitar una canción",activityQrAlt:"QR para entrar a la actividad",finalTitle:"GRACIAS POR PARTICIPAR",finalMessage:"Nos vemos en la próxima.",returns:"VOLVEMOS",dedication:"DEDICATORIA"},
  fr:{lineup:"PROCHAINS SUR SCÈNE",next:"SUIVANT",queued:"EN ATTENTE",first:"Soyez le premier à chanter !",scan:"Scannez le QR pour demander une chanson.",now:"EN COURS",background:"Musique d'ambiance",waiting:"En attente de demandes",want:"ENVIE DE CHANTER ?",scanQr:"SCANNEZ LE QR",activityPin:"PIN DE L'ACTIVITÉ",startsIn:"COMMENCE DANS"},
  it:{lineup:"PROSSIMI SUL PALCO",next:"PROSSIMO",queued:"IN CODA",first:"Sii il primo a cantare!",scan:"Scansiona il QR per richiedere una canzone.",now:"IN RIPRODUZIONE",background:"Musica di sottofondo",waiting:"In attesa di richieste",want:"VUOI CANTARE?",scanQr:"SCANSIONA IL QR",activityPin:"PIN ATTIVITÀ",startsIn:"INIZIA TRA"},
  de:{lineup:"ALS NÄCHSTES AUF DER BÜHNE",next:"NÄCHSTE/R",queued:"IN DER WARTESCHLANGE",first:"Sei der Erste auf der Bühne!",scan:"Scanne den QR-Code für deinen Songwunsch.",now:"LÄUFT GERADE",background:"Hintergrundmusik",waiting:"Warten auf Songwünsche",want:"MÖCHTEST DU SINGEN?",scanQr:"QR-CODE SCANNEN",activityPin:"AKTIVITÄTS-PIN",startsIn:"BEGINNT IN"},
  ru:{lineup:"СЛЕДУЮЩИЕ НА СЦЕНЕ",next:"СЛЕДУЮЩИЙ",queued:"В ОЧЕРЕДИ",first:"Станьте первым!",scan:"Отсканируйте QR, чтобы заказать песню.",now:"СЕЙЧАС ИГРАЕТ",background:"Фоновая музыка",waiting:"Ждём заявок",want:"ХОТИТЕ ПЕТЬ?",scanQr:"СКАНИРУЙТЕ QR",activityPin:"PIN МЕРОПРИЯТИЯ",startsIn:"ДО НАЧАЛА"},
  pt:{lineup:"PRÓXIMOS NO PALCO",next:"PRÓXIMO",queued:"NA FILA",first:"Seja o primeiro a cantar!",scan:"Leia o QR para pedir uma música.",now:"A TOCAR AGORA",background:"Música ambiente",waiting:"Aguardando pedidos",want:"QUER CANTAR?",scanQr:"LEIA O QR",activityPin:"PIN DA ATIVIDADE",startsIn:"COMEÇA EM"},
  hi:{lineup:"मंच पर अगले कलाकार",next:"अगला",queued:"कतार में",first:"सबसे पहले गाने वाले बनें!",scan:"गाना चुनने के लिए QR स्कैन करें।",now:"अभी बज रहा है",background:"बैकग्राउंड म्यूज़िक",waiting:"रिक्वेस्ट का इंतज़ार",want:"गाना चाहते हैं?",scanQr:"QR स्कैन करें",activityPin:"एक्टिविटी PIN",startsIn:"शुरू होने में"}
});

export const PLAN_B_COPY = Object.freeze({
  en:{open:"Help me choose",title:"Need a song?",language:"Suggestion language",tryThese:"Try one of these",more:"More suggestions",surprise:"Surprise me",yourSong:"Your song is…",tryAnother:"Try another",choose:"Use in my request",close:"Close Plan B"},
  es:{open:"Ayúdame a elegir",title:"¿Necesitas una canción?",language:"Idioma de sugerencias",tryThese:"Prueba una de estas",more:"Más sugerencias",surprise:"Sorpréndeme",yourSong:"Tu canción es…",tryAnother:"Probar otra",choose:"Usar en mi solicitud",close:"Cerrar Plan B"},
  fr:{open:"Aidez-moi à choisir",title:"Besoin d'une chanson ?",language:"Langue des suggestions",tryThese:"Essayez l'une de celles-ci",more:"Autres suggestions",surprise:"Surprenez-moi",yourSong:"Votre chanson est…",tryAnother:"Une autre",choose:"Utiliser dans ma demande",close:"Fermer Plan B"},
  it:{open:"Aiutami a scegliere",title:"Cerchi una canzone?",language:"Lingua dei suggerimenti",tryThese:"Prova una di queste",more:"Altri suggerimenti",surprise:"Sorprendimi",yourSong:"La tua canzone è…",tryAnother:"Provane un'altra",choose:"Usa nella mia richiesta",close:"Chiudi Plan B"},
  de:{open:"Hilf mir bei der Auswahl",title:"Brauchst du einen Song?",language:"Sprache der Vorschläge",tryThese:"Probier einen davon",more:"Weitere Vorschläge",surprise:"Überrasch mich",yourSong:"Dein Song ist…",tryAnother:"Noch einmal",choose:"Für meinen Wunsch verwenden",close:"Plan B schließen"},
  ru:{open:"Помогите выбрать",title:"Нужна песня?",language:"Язык рекомендаций",tryThese:"Попробуйте одну из этих",more:"Ещё варианты",surprise:"Удивите меня",yourSong:"Ваша песня…",tryAnother:"Ещё раз",choose:"Добавить в заявку",close:"Закрыть Plan B"},
  pt:{open:"Ajude-me a escolher",title:"Precisa de uma música?",language:"Idioma das sugestões",tryThese:"Experimente uma destas",more:"Mais sugestões",surprise:"Surpreenda-me",yourSong:"A sua música é…",tryAnother:"Tentar outra",choose:"Usar no meu pedido",close:"Fechar Plan B"},
  hi:{open:"चुनने में मदद करें",title:"गाना चुनना है?",language:"सुझाव की भाषा",tryThese:"इनमें से कोई आज़माएँ",more:"और सुझाव",surprise:"मुझे चौंकाएँ",yourSong:"आपका गाना है…",tryAnother:"कोई और",choose:"मेरे रिक्वेस्ट में लें",close:"Plan B बंद करें"}
});

export function normalizeGuestLanguage(value, fallback = "en") {
  const candidate = String(value || "").trim().toLowerCase();
  const direct = GUEST_LANGUAGES.find((language) => [language.code,language.songCode,language.englishName,language.nativeName]
    .some((name)=>String(name).toLowerCase()===candidate));
  return direct?.code || fallback;
}

export function guestLanguageFromSong(value, fallback = "en") {
  return normalizeGuestLanguage(value, fallback);
}

export function deterministicFunnyMessage(language, context, seed = "guest-star") {
  const code = normalizeGuestLanguage(language);
  const catalog = FUNNY_MESSAGES[code] || FUNNY_MESSAGES.en;
  const messages = catalog[context] || catalog.requestIdle;
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return messages[hash % messages.length];
}
