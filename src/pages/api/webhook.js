// ✅ Webhook para Preding con extracción de intención + respuesta precisa desde API

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

    // 🔍 Paso 1: interpretar intención del usuario con IA
    const aiIntentRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
            content: `Tu tarea es identificar a qué evento y zona se refiere el usuario. Devuelve un JSON con dos campos: "evento" y "zona". Si no lo menciona, deja esos campos vacíos.`
          },
          {
            role: "user",
            content: userMessage,
          }
        ]
      })
    });

    const parsed = await aiIntentRes.json();
    const content = parsed.choices?.[0]?.message?.content;

    let eventoBuscado = "";
    let zonaBuscada = "";
    try {
      const resultado = JSON.parse(content);
      eventoBuscado = resultado.evento?.toLowerCase() || "";
      zonaBuscada = resultado.zona?.toLowerCase() || "";
    } catch (e) {
      console.warn("❌ No se pudo interpretar la intención del usuario.");
    }

    // 🎟️ Paso 2: consultar API real
    const eventos = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products")
      .then(res => res.json());

    const coincidencia = eventos.find(e =>
      eventoBuscado && e.title.toLowerCase().includes(eventoBuscado)
    );

    let respuesta = "Lo siento, no encontré información sobre ese evento.";

    if (coincidencia) {
      respuesta = `🎟️ *${coincidencia.title}*\n`;

      const zona = coincidencia.variations.find(v =>
        zonaBuscada && v.attributes["attribute_zonas"].toLowerCase().includes(zonaBuscada)
      );

      if (zona) {
        respuesta += `🔹 Zona: ${zona.attributes["attribute_zonas"]}\n💵 Precio: $${zona.regular_price} MXN\n`;
      } else {
        respuesta += `📍 Zonas disponibles:\n`;
        respuesta += coincidencia.variations.map(v => `- ${v.attributes["attribute_zonas"]}: $${v.regular_price} MXN`).join("\n");
      }

      respuesta += `\n\n🔗 Compra aquí: ${coincidencia.link}`;
    }

    // 📤 Enviar respuesta a WhatsApp
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
          body: respuesta,
        },
      })
    });

    return res.status(200).end();
  }

  res.status(405).end();
}
