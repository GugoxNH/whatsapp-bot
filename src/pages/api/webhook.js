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

    // 1. Obtener eventos de la API
    const eventsRes = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
    const eventos = await eventsRes.json();

    // 2. Preparar lista compacta
    const resumenEventos = eventos.map((e, i) => `${i + 1}. ${e.title}`).join("\n");

    // 3. Ver si el usuario pidió la lista
    const pideLista = /lista|eventos|todos/i.test(userMessage);

    // 4. Buscar si menciona algún evento específico
    const eventoMencionado = eventos.find(e =>
      userMessage.toLowerCase().includes(
        e.title.toLowerCase().split(" ")[0] // toma primera palabra del título
      )
    );

    let contexto = `Eres un asistente virtual de Preding, una empresa que vende boletos para eventos musicales.\n\n`;

    if (pideLista) {
      contexto += `Aquí tienes la lista completa de eventos disponibles:\n${resumenEventos}\n\nResponde en español de manera clara y amable.`;
    } else if (eventoMencionado) {
      const zonas = eventoMencionado.variations
        .map(v => `- ${v.attributes["attribute_zonas"]} (${v.regular_price} MXN)`)
        .join("\n");

      contexto += `Detalles del evento "${eventoMencionado.title}":\n${zonas}\n\nLink para compra: ${eventoMencionado.link}\n\nResponde de forma clara y en español.`;
    } else {
      contexto += `El usuario preguntó: "${userMessage}". Si no sabes la respuesta, indícale que puedes mostrarle la lista de eventos disponibles o que consulte con un asesor.`;
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
            content: contexto
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
