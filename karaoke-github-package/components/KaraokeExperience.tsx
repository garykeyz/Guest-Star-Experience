"use client";

import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Headphones,
  MessageCircleMore,
  Mic2,
  Music2,
  RotateCcw,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
type L = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt";
type K = "name" | "song" | "artist" | "comment";
type T = {
  title: string;
  sub: string;
  desc: string;
  f: Record<K, [string, string]>;
  err: string;
  send: string;
  sending: string;
  ok: string;
  stage: string;
  again: string;
  steps: string[];
};
const REQUEST_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";
const languages: [L, string, string][] = [
  ["es", "🇪🇸", "Español"],
  ["en", "🇺🇸", "English"],
  ["fr", "🇫🇷", "Français"],
  ["it", "🇮🇹", "Italiano"],
  ["de", "🇩🇪", "Deutsch"],
  ["ru", "🇷🇺", "Русский"],
  ["pt", "🇵🇹", "Português"],
];
const tx: Record<L, T> = {
  es: {
    title: "NOCHE DE KARAOKE",
    sub: "¿Listo para cantar?",
    desc: "Pide tu canción favorita y prepárate para brillar en el escenario.",
    f: {
      name: ["Tu nombre", "¿Cómo te llamas?"],
      song: ["Título de la canción", "¿Qué quieres cantar?"],
      artist: ["Artista", "¿Quién la interpreta?"],
      comment: ["Comentario", "Dedicatoria o nota opcional..."],
    },
    err: "Completa este campo para continuar.",
    send: "Enviar solicitud",
    sending: "Enviando...",
    ok: "¡Tu canción ha sido enviada!",
    stage: "¡Prepárate para subir al escenario!",
    again: "Pedir otra canción",
    steps: ["Completa el formulario", "Espera tu turno", "¡Canta y disfruta!"],
  },
  en: {
    title: "KARAOKE NIGHT",
    sub: "Ready to Sing?",
    desc: "Request your favorite song and get ready to shine on stage.",
    f: {
      name: ["Your Name", "What should we call you?"],
      song: ["Song Title", "What would you like to sing?"],
      artist: ["Artist", "Who performs it?"],
      comment: ["Comment", "Optional dedication or note..."],
    },
    err: "Please complete this field to continue.",
    send: "Submit Request",
    sending: "Sending...",
    ok: "Your song request has been sent!",
    stage: "Get ready to take the stage!",
    again: "Submit another song",
    steps: ["Fill the form", "Wait for your turn", "Sing and enjoy!"],
  },
  fr: {
    title: "SOIRÉE KARAOKÉ",
    sub: "Prêt à chanter ?",
    desc: "Demandez votre chanson préférée et préparez-vous à briller sur scène.",
    f: {
      name: ["Votre nom", "Comment vous appelez-vous ?"],
      song: ["Titre de la chanson", "Que souhaitez-vous chanter ?"],
      artist: ["Artiste", "Qui l’interprète ?"],
      comment: ["Commentaire", "Dédicace facultative..."],
    },
    err: "Veuillez remplir ce champ.",
    send: "Envoyer la demande",
    sending: "Envoi...",
    ok: "Votre demande a été envoyée !",
    stage: "Préparez-vous à monter sur scène !",
    again: "Demander une autre chanson",
    steps: [
      "Remplissez le formulaire",
      "Attendez votre tour",
      "Chantez et amusez-vous !",
    ],
  },
  it: {
    title: "SERATA KARAOKE",
    sub: "Pronto a cantare?",
    desc: "Richiedi la tua canzone preferita e preparati a brillare sul palco.",
    f: {
      name: ["Il tuo nome", "Come ti chiami?"],
      song: ["Titolo della canzone", "Cosa vuoi cantare?"],
      artist: ["Artista", "Chi la interpreta?"],
      comment: ["Commento", "Dedica facoltativa..."],
    },
    err: "Completa questo campo.",
    send: "Invia richiesta",
    sending: "Invio...",
    ok: "La tua richiesta è stata inviata!",
    stage: "Preparati a salire sul palco!",
    again: "Richiedi un’altra canzone",
    steps: ["Compila il modulo", "Aspetta il tuo turno", "Canta e divertiti!"],
  },
  de: {
    title: "KARAOKE-NACHT",
    sub: "Bereit zum Singen?",
    desc: "Wünsche dir deinen Lieblingssong und mach dich bereit, auf der Bühne zu glänzen.",
    f: {
      name: ["Dein Name", "Wie heißt du?"],
      song: ["Songtitel", "Was möchtest du singen?"],
      artist: ["Künstler", "Von wem ist der Song?"],
      comment: ["Kommentar", "Optionale Widmung..."],
    },
    err: "Bitte fülle dieses Feld aus.",
    send: "Anfrage senden",
    sending: "Wird gesendet...",
    ok: "Dein Songwunsch wurde gesendet!",
    stage: "Mach dich bereit für die Bühne!",
    again: "Weiteren Song wünschen",
    steps: [
      "Formular ausfüllen",
      "Warte auf deinen Auftritt",
      "Singen und genießen!",
    ],
  },
  ru: {
    title: "ВЕЧЕР КАРАОКЕ",
    sub: "Готовы петь?",
    desc: "Закажите любимую песню и приготовьтесь блистать на сцене.",
    f: {
      name: ["Ваше имя", "Как вас зовут?"],
      song: ["Название песни", "Что вы хотите спеть?"],
      artist: ["Исполнитель", "Кто исполняет песню?"],
      comment: ["Комментарий", "Необязательное посвящение..."],
    },
    err: "Заполните это поле.",
    send: "Отправить заявку",
    sending: "Отправка...",
    ok: "Ваша заявка отправлена!",
    stage: "Приготовьтесь выйти на сцену!",
    again: "Заказать другую песню",
    steps: [
      "Заполните форму",
      "Дождитесь своей очереди",
      "Пойте и наслаждайтесь!",
    ],
  },
  pt: {
    title: "NOITE DE KARAOKÊ",
    sub: "Pronto para cantar?",
    desc: "Peça sua música favorita e prepare-se para brilhar no palco.",
    f: {
      name: ["Seu nome", "Como você se chama?"],
      song: ["Título da música", "O que você quer cantar?"],
      artist: ["Artista", "Quem interpreta?"],
      comment: ["Comentário", "Dedicatória opcional..."],
    },
    err: "Preencha este campo.",
    send: "Enviar pedido",
    sending: "Enviando...",
    ok: "Seu pedido de música foi enviado!",
    stage: "Prepare-se para subir ao palco!",
    again: "Pedir outra música",
    steps: ["Preencha o formulário", "Espere sua vez", "Cante e aproveite!"],
  },
};
const icon = {
  name: UserRound,
  song: Music2,
  artist: Mic2,
  comment: MessageCircleMore,
};
function Field({
  k,
  v,
  text,
  touched,
  set,
  blur,
}: {
  k: K;
  v: string;
  text: T;
  touched: boolean;
  set: (v: string) => void;
  blur: () => void;
}) {
  const I = icon[k],
    req = k !== "comment",
    bad = req && touched && !v.trim();
  return (
    <div className="field">
      <label htmlFor={k}>
        {text.f[k][0]} {req && <b>*</b>}
      </label>
      <div className={"input " + (bad ? "bad" : "")}>
        <I size={20} />
        {k === "comment" ? (
          <textarea
            id={k}
            rows={3}
            value={v}
            placeholder={text.f[k][1]}
            onChange={(e) => set(e.target.value)}
            onBlur={blur}
          />
        ) : (
          <input
            id={k}
            required
            value={v}
            placeholder={text.f[k][1]}
            onChange={(e) => set(e.target.value)}
            onBlur={blur}
          />
        )}
      </div>
      <AnimatePresence>
        {bad && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
          >
            {text.err}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
export default function KaraokeExperience() {
  const [lang, setLang] = useState<L>("en"),
    [open, setOpen] = useState(false),
    [v, setV] = useState<Record<K, string>>({
      name: "",
      song: "",
      artist: "",
      comment: "",
    }),
    [touch, setTouch] = useState<Partial<Record<K, boolean>>>({}),
    [load, setLoad] = useState(false),
    [done, setDone] = useState(false);
  const text = tx[lang],
    complete = !!(v.name.trim() && v.song.trim() && v.artist.trim()),
    active = languages.find((x) => x[0] === lang)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouch({ name: true, song: true, artist: true });
    if (!complete) return;
    setLoad(true);
    try {
      await fetch(REQUEST_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          name: v.name.trim(),
          song: v.song.trim(),
          artist: v.artist.trim(),
          comment: v.comment.trim(),
          language: active[2],
        }),
      });
      setDone(true);
    } finally {
      setLoad(false);
    }
  };
  const reset = () => {
    setV({ name: "", song: "", artist: "", comment: "" });
    setTouch({});
    setDone(false);
  };
  return (
    <main className="page">
      <div className="ambient" aria-hidden="true">
        <i className="orb pink" />
        <i className="orb blue" />
        {["♪", "♫", "✦", "♬"].map((n, i) => (
          <motion.span
            className={"note n" + i}
            key={i}
            animate={{ y: [0, -18, 0], rotate: [-7, 7, -7] }}
            transition={{ duration: 4 + i, repeat: Infinity }}
          >
            {n}
          </motion.span>
        ))}
        <Headphones className="ghost headphones" />
        <Mic2 className="ghost microphone" />
      </div>
      <div className="brand">✦ GUEST STAR EXPERIENCE</div>
      <div className="selector">
        <button
          type="button"
          aria-label="Select language"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {active[1]} <span>{active[2]}</span>
          <ChevronDown size={16} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              className="menu"
              role="listbox"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {languages.map((x) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={x[0] === lang}
                  key={x[0]}
                  onClick={() => {
                    setLang(x[0]);
                    setOpen(false);
                  }}
                >
                  {x[1]} <span>{x[2]}</span>
                  {x[0] === lang && <Check size={15} />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
      >
        <AnimatePresence mode="wait">
          {!done ? (
            <motion.div key="form" exit={{ opacity: 0, y: -12 }}>
              <header>
                <div className="badge">
                  <Mic2 size={31} />
                </div>
                <p className="eyebrow">
                  <Sparkles size={14} /> LIVE EXPERIENCE
                </p>
                <h1>{text.title}</h1>
                <h2>{text.sub}</h2>
                <p className="desc">{text.desc}</p>
              </header>
              <form onSubmit={submit} noValidate>
                {(["name", "song", "artist", "comment"] as K[]).map((k) => (
                  <Field
                    key={k}
                    k={k}
                    v={v[k]}
                    text={text}
                    touched={!!touch[k]}
                    blur={() => setTouch((s) => ({ ...s, [k]: true }))}
                    set={(x) => setV((s) => ({ ...s, [k]: x }))}
                  />
                ))}
                <button
                  className="submit"
                  disabled={!complete || load}
                  aria-busy={load}
                >
                  {load ? (
                    <>
                      <i className="loader" />
                      {text.sending}
                    </>
                  ) : (
                    <>
                      <Mic2 size={21} />
                      {text.send}
                      <Send className="send" size={17} />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.section
              className="success"
              key="success"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              aria-live="polite"
            >
              <div className="confetti">
                {Array.from({ length: 18 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
              <motion.div
                className="successMic"
                animate={{ y: [0, -10, 0], rotate: [-5, 5, -5] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Mic2 size={55} />
              </motion.div>
              <span className="check">
                <Check size={31} />
              </span>
              <p className="eyebrow">
                <Sparkles size={14} /> ENCORE
              </p>
              <h2>🎉 {text.ok}</h2>
              <p>{text.stage}</p>
              <button
                className="submit secondary"
                type="button"
                onClick={reset}
              >
                <RotateCcw size={19} />
                {text.again}
              </button>
            </motion.section>
          )}
        </AnimatePresence>
      </motion.div>
      <footer>
        {text.steps.map((x, i) => (
          <div className="stepWrap" key={x}>
            <div className="step">
              {i === 0 ? (
                <MessageCircleMore />
              ) : i === 1 ? (
                <Music2 />
              ) : (
                <Mic2 />
              )}
              <span>{x}</span>
            </div>
            {i < 2 && <ArrowRight className="arrow" size={16} />}
          </div>
        ))}
      </footer>
    </main>
  );
}
