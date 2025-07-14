const processedMessages = new Set();
setInterval(() => processedMessages.clear(), 1000 * 60 * 5);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const MODEL_NAME = process.env.MODEL_NAME || "deepseek/deepseek-r1-0528-qwen3-8b";

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }

  if (req.method === 'POST') {
    const body = req.body;
    const messageObj = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const userMessage = messageObj?.text?.body;
    const senderNumber = messageObj?.from;
    const messageId = messageObj?.id;

    if (!userMessage || !senderNumber || !messageId) return res.status(200).end();
    if (processedMessages.has(messageId)) return res.status(200).end();
    processedMessages.add(messageId);

    // Consulta eventos disponibles
    const eventsRes = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
    const eventos = await eventsRes.json();

    // 1. Compactar lista de títulos
    const resumenEventos = eventos.map(e => `- ${e.title}`).join("\n");

    // 2. Buscar si el usuario menciona un evento
    const eventoMencionado = eventos.find(e => userMessage.toLowerCase().includes(e.title.toLowerCase().slice(0, 15)));

    let contextoAdicional = "";
    if (eventoMencionado) {
      const zonas = eventoMencionado.variations.map(v => `- ${v.attributes["attribute_zonas"]} (${v.regular_price} MXN)`).join("\n");
      contextoAdicional = `\n\nDetalles del evento *${eventoMencionado.title}*:\n${zonas}\n\n🔗 ${eventoMencionado.link}`;
    }

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: `Eres un asistente virtual de la empresa Preding, especializada en venta de boletos para eventos musicales.\n\nEstos son los eventos disponibles actualmente:\n${resumenEventos}\n${contextoAdicional}\n\n
            Cuando te saluden responde hamablemente y usa emojis cuando sea útil, explica que estas para resolver dudas e informar sobre los eventos disponibles.
            Si te piden información de los eventos, dale una lista con el nombre de los eventos (El compo "title"), y ofrece la opción de dar más informacion de un evento en particular, al preguntarte de ese evento, da toda la información que poseas de el.            
            `
          },
          {
            role: "user",
            content: userMessage,
          }
        ]
      })
    });

    const aiJson = await aiResponse.json();
    const replyText = aiJson.choices?.[0]?.message?.content || "Lo siento, no entendí tu pregunta.";

    await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: senderNumber,
        type: "text",
        text: {
          preview_url: false,
          body: replyText,
        },
      })
    });

    return res.status(200).end();
  }

  res.status(405).end();
} 
