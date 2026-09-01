import {
  ArrowRight,
  Check,
  ChevronDown,
  CirclePlay,
  Mic2,
  MonitorPlay,
  Music2,
  ScanLine,
  Sparkles,
  Star,
  UsersRound,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const products = [
  { number: "01", name: "Host Console", icon: MonitorPlay, tone: "cyan", text: "La estación de mando del DJ o anfitrión. Controla karaoke, cola, letras, efectos, cámara y cada pantalla desde una sola computadora." },
  { number: "02", name: "StarPrompter", icon: Mic2, tone: "violet", text: "Una pantalla limpia con letra sincronizada y cuenta regresiva para que cualquier persona se sienta segura al tomar el micrófono." },
  { number: "03", name: "StarScreen", icon: Sparkles, tone: "pink", text: "Convierte una TV, LED wall o proyector en una parte viva del espectáculo: letra, visuales, aplausómetro, video y cámara." },
  { number: "04", name: "StarCamera", icon: ScanLine, tone: "cyan", text: "Lleva la cámara del artista a la pantalla gigante para que cada participación parezca un performance de concierto." },
  { number: "05", name: "Guest App", icon: UsersRound, tone: "violet", text: "Tus invitados descubren canciones, mandan solicitudes y se preparan para su momento desde el celular. Menos filas, más show." },
];

const steps = [
  ["01", "Elige", "Los invitados escanean y buscan su canción."],
  ["02", "Sube", "El host llama al próximo Guest Star."],
  ["03", "Brilla", "Letra, visuales, cámara y energía en vivo."],
  ["04", "Recuerda", "Una noche que la gente sigue comentando."],
];

const audiences = ["Hoteles y resorts", "Bares y lounges", "Bodas y celebraciones", "Eventos corporativos", "Festivales y activaciones", "DJs y hosts profesionales"];

export default function Home() {
  return (
    <main>
      <div className="announcement"><i /> Diseñado para que cada persona se sienta la estrella de la noche.</div>
      <nav className="nav-shell" aria-label="Navegación principal">
        <a className="brand" href="#inicio" aria-label="Guest Star Experience"><span className="brand-mark"><Star size={15} fill="currentColor" /></span> GUEST STAR <b>XP</b></a>
        <div className="nav-links"><a href="#experiencia">La experiencia</a><a href="#ecosistema">El ecosistema</a><a href="#para-quien">Para quién es</a></div>
        <a className="nav-cta" href="#demo">Solicitar demo <ArrowRight size={16} /></a>
      </nav>

      <section className="hero" id="inicio">
        <div className="orb orb-one" /><div className="orb orb-two" />
        <div className="hero-copy">
          <p className="eyebrow"><span /> KARAOKE, REIMAGINADO</p>
          <h1>Tu evento.<br /><em>Su momento.</em></h1>
          <p className="hero-text">Guest Star Experience convierte una canción en un show. Es el sistema que une karaoke, pantallas, cámara y participación del público para crear noches que nadie quiere perderse.</p>
          <div className="hero-actions">
            <Button asChild className="button-primary"><a href="#demo">Quiero conocerlo <ArrowRight size={17} /></a></Button>
            <a className="watch-link" href="#experiencia"><CirclePlay size={19} /> Así funciona</a>
          </div>
          <div className="proof"><div className="faces"><i /><i /><i /><i /></div><p><b>Más que cantar.</b><br />Una experiencia que pone a todos a participar.</p></div>
        </div>

        <div className="hero-stage">
          <img src="https://gstarxp.palmbeatsproductions.chatgpt.site/gstar-hero.png" alt="Cantante en un escenario durante un evento Guest Star Experience" />
          <div className="stage-shade" />
          <span className="live"><i /> EN VIVO</span>
          <div className="song-card"><div className="cover"><Music2 size={20} /></div><p><small>AHORA EN ESCENA</small><b>La estrella eres tú</b><span>Guest Star Session</span></p><div className="bars"><i /><i /><i /><i /><i /></div></div>
          <div className="meter"><Volume2 size={15} /><span>APLAUSÓMETRO</span><b>92%</b><div><i /></div></div>
        </div>
        <a className="scroll-cue" href="#experiencia">DESCUBRE LA EXPERIENCIA <ChevronDown size={16} /></a>
      </section>

      <section className="intro" id="experiencia">
        <p className="section-tag">NO ES SOLO KARAOKE</p>
        <div className="intro-grid">
          <h2>Cuando alguien toma el micrófono, <em>todo el lugar cambia.</em></h2>
          <div><p>Guest Star le da a cada participante un escenario completo. Mientras el host dirige la energía, la tecnología se encarga de que el momento se vea, suene y se sienta enorme.</p><a href="#ecosistema">Conoce cada parte <ArrowRight size={16} /></a></div>
        </div>
        <div className="show-board">
          <header><span><i /> SHOW MODE · 22:47</span><span>MOONLIGHT SESSION</span></header>
          <div className="board-content">
            <div className="lyrics"><span>Cuando llega <b>tu canción,</b></span><strong>el escenario es tuyo.</strong><small>La letra sigue el ritmo. El público sigue tu energía.</small></div>
            <div className="mic-orb"><div /><div /><Mic2 size={38} /><b>GUEST<br />STAR</b></div>
          </div>
          <footer><span><b>03:18</b> / 03:56</span><div><i /></div><span>PRÓXIMO <b>— Sofía M.</b></span></footer>
        </div>
      </section>

      <section className="flow">
        <div className="flow-head"><div><p className="eyebrow">UNA NOCHE, EN CUATRO ACTOS</p><h2>La participación deja de ser una espera.<br /><em>Se vuelve parte del show.</em></h2></div><p>Desde la primera solicitud hasta el último aplauso, Guest Star mantiene al público conectado con lo que está pasando ahora.</p></div>
        <div className="steps">{steps.map(([number, title, text]) => <article key={number}><span>{number}</span><i /><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="ecosystem" id="ecosistema">
        <p className="section-tag">TODO CONECTADO</p>
        <div className="ecosystem-head"><h2>Una experiencia.<br /><em>Cinco formas de brillar.</em></h2><p>No se trata de llenar el venue de pantallas. Se trata de que cada pantalla tenga un propósito: guiar, emocionar, amplificar y hacer participar.</p></div>
        <div className="product-grid">
          {products.map((product) => {
            const Icon = product.icon;
            return <article className={"product " + product.tone} key={product.name}><div className="product-icon"><Icon size={22} /></div><small>{product.number} · EL ECOSISTEMA</small><h3>{product.name}</h3><p>{product.text}</p><ArrowRight className="product-arrow" size={18} /></article>;
          })}
          <article className="product product-wide">
            <div><small>UN SOLO CONTROL</small><h3>El host dirige la magia.</h3><p>Sin brincar entre programas ni perder el flow. El show completo vive en una misma consola.</p></div>
            <div className="mini-console"><header><b>GSXP</b><i /><i /><i /></header><div className="wave">{Array.from({ length: 12 }).map((_, index) => <i key={index} />)}</div><footer><div><b /><i /><i /></div><div><b /><i /><i /></div></footer></div>
          </article>
        </div>
      </section>

      <section className="control">
        <div className="console-wrap">
          <span>HOST CONSOLE <i /></span>
          <div className="console">
            <aside><b>GS</b><i /><i /><i /><i /></aside>
            <div className="console-main"><header><b>Tonight&apos;s show</b><small>Ready for the next star</small><i /></header><div className="preview"><small>STAGE PREVIEW</small><strong>YOU&apos;RE<br />THE STAR</strong><span>LIVE</span></div><div className="queue"><small>UP NEXT</small><p><b>01</b><span><strong>Maria</strong><i>Flowers · Miley Cyrus</i></span><em>03:21</em></p><p><b>02</b><span><strong>Kevin</strong><i>Despechá · Rosalía</i></span><em>02:37</em></p></div></div>
            <div className="mixer"><small>MASTER</small><div><i /></div><b>+2.5</b><span><i /><i /><i /><i /><i /></span></div>
          </div>
        </div>
        <div className="control-copy"><p className="eyebrow">CONTROL SIN COMPLICACIONES</p><h2>Todo lo que pasa en el show, <em>bajo tu control.</em></h2><p>Guest Star reúne el playback, la lista de participantes, las capas visuales, el teleprompter y las pantallas externas. Tú decides qué se muestra, cuándo y cómo.</p><ul><li><Check size={17} /> Gestiona la cola de invitados sin perder el ritmo.</li><li><Check size={17} /> Envía contenido distinto a cada pantalla.</li><li><Check size={17} /> Haz que cámara, letra y visuales entren justo a tiempo.</li></ul></div>
      </section>

      <section className="audience" id="para-quien">
        <div><p className="eyebrow">HECHO PARA MOMENTOS CON GENTE</p><h2>Donde hay público, hay una estrella esperando.</h2></div>
        <div className="audience-list">{audiences.map((item, index) => <p key={item}><span>0{index + 1}</span><b>{item}</b><ArrowRight size={19} /></p>)}</div>
      </section>

      <section className="cta" id="demo">
        <div className="cta-ring" /><div className="cta-mark"><Star size={26} fill="currentColor" /></div>
        <p className="eyebrow">EL PRÓXIMO SHOW EMPIEZA AQUÍ</p>
        <h2>Haz que tu público<br /><em>quiera subir al escenario.</em></h2>
        <p>Guest Star Experience está creado para convertir interacción en emoción — y una noche cualquiera en la que todos quieren repetir.</p>
        <a className="cta-button" href="https://wa.me/18297494229?text=Hola%2C%20quiero%20conocer%20Guest%20Star%20Experience.">Habla con Guest Star por WhatsApp <ArrowRight size={18} /></a>
        <a className="relative z-[1] mt-3 text-xs text-zinc-300 underline decoration-zinc-500 underline-offset-4" href="mailto:gueststarexperience@hotmail.com?subject=Quiero%20conocer%20Guest%20Star%20Experience">gueststarexperience@hotmail.com</a>
      </section>

      <footer className="site-footer"><a className="brand" href="#inicio"><span className="brand-mark"><Star size={14} fill="currentColor" /></span> GUEST STAR <b>XP</b></a><p>La gente no recuerda una playlist. Recuerda cómo se sintió.</p><span>© 2026 Guest Star Experience</span></footer>
    </main>
  );
}