import fetch from "node-fetch";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const MODEL = process.env.LLM_MODEL || "deepseek/deepseek-llm-67b-chat";

let cachedEvents = [];
let lastFetchTime = 0;

async function fetchEvents() {
  const now = Date.now();
  if (cachedEvents.length > 0 && now - lastFetchTime < 10 * 60 * 1000) {
    return cachedEvents;
  }

  const res = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
  const data = await res.json();

  cachedEvents = data.map((event, index) => ({
    index: index + 1,
    title: event.title,
    link: event.link,
    image: event.image,
    variations: event.variations,
  }));

  lastFetchTime = now;
  return cachedEvents;
}

function createSystemPrompt(events) {
  return `
Eres un asistente de WhatsApp llamado PREDING BOT que ayuda a los usuarios con información de eventos musicales en San Luis Potosí.

Estos son los eventos disponibles:

${events
  .map(
    (e) =>
      `${e.index}. ${e.title}`
  )
  .join("\n")}

Instrucciones:
- Si el usuario pregunta por "lista de eventos", "qué eventos hay", "muestrame los eventos", etc., responde enumerando todos los eventos disponibles con sus nombres exactamente como están.
- Si el usuario menciona "evento 1", "evento 2", etc., usa el número para identificar el evento correspondiente.
- Si el usuario pregunta por un evento por nombre (ej. "junior h"), haz coincidencia parcial e ignora mayúsculas/minúsculas para encontrar el evento más similar.
- Si se encuentra el evento, responde con:
  - El nombre completo.
  - El link para compra.
  - Las zonas disponibles con su precio.
- Si no hay coincidencia, indica que no se encontró información para ese evento.
- Si el usuario dice solo "hola", "buenas", "qué haces", etc., saluda y ofrece ayuda, pero **NO muestres ningún evento** hasta que lo soliciten.
- No inventes información.
`;
}

export default async function handler(req, res) {
  try {
    const body = req.body;
    const msg = body?.messages?.[0]?.text?.body;
    const number = body?.messages?.[0]?.from;

    if (!msg || !number) {
      return res.status(200).send("No message to process.");
    }

    const events = await fetchEvents();

    const messages = [
      {
        role: "system",
        content: createSystemPrompt(events),
      },
      {
        role: "user",
        content: msg,
      },
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
    });

    const reply = completion.choices[0]?.message?.content;

    console.log("✅ Respuesta enviada a WhatsApp:", reply);

    const responsePayload = {
      messaging_product: "whatsapp",
      to: number,
      text: { body: reply },
    };

    await fetch("https://graph.facebook.com/v18.0/" + process.env.PHONE_NUMBER_ID + "/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsePayload),
    });

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Error en webhook:", e.message);
    res.status(500).send("Error interno.");
  }
}
