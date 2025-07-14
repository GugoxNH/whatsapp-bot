const processedMessages = new Set();
setInterval(() => processedMessages.clear(), 1000 * 60 * 5);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const MODEL_NAME = process.env.MODEL_NAME || "deepseek/deepseek-chat";

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }

  if (req.method === "POST") {
    const body = req.body;
    const messageObj = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const userMessage = messageObj?.text?.body;
    const senderNumber = messageObj?.from;
    const messageId = messageObj?.id;

    if (!userMessage || !senderNumber || !messageId) return res.status(200).end();
    if (processedMessages.has(messageId)) return res.status(200).end();
    processedMessages.add(messageId);

    // 1. Obtener eventos
    const response = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
    const eventos = await response.json();

    // 2. Crear lista numerada
    const listaEventos = eventos
      .map((e, i) => `${i + 1}. ${e.title}`)
      .join("\n");

    // 3. Detectar si pidió la lista
    const pideLista = /lista|eventos|cartelera|ver todos/i.test(userMessage);

    // 4. Buscar por número
    const matchNumero = userMessage.match(/\b(?:evento )?(\d{1,2})\b/i);
    const index = matchNumero ? parseInt(matchNumero[1]) - 1 : -1;
    const eventoPorNumero = eventos[index];

    // 5. Buscar por coincidencia en título (por palabras clave)
    const eventoPorNombre = eventos.find((e) =>
      userMessage.toLowerCase().includes(e.title.toLowerCase().split(" ")[0])
    );

    // 6. Preparar contexto
    let contexto = `Eres un asistente virtual de Preding, una empresa que vende boletos para eventos musicales en San Luis Potosí.\n\n`;

    if (pideLista) {
      contexto += `Estos son los eventos disponibles:\n${listaEventos}\n\nResponde en español y dile al usuario que si quiere más información escriba el número del evento.`;
    } else if (eventoPorNumero || eventoPorNombre) {
      const evento = eventoPorNumero || eventoPorNombre;
      const zonas = evento.variations
        .map((v) => `- ${v.attributes["attribute_zonas"]} (${v.regular_price} MXN)`)
        .join("\n");

      contexto += `Este es el detalle del evento "${evento.title}":\n${zonas}\n\nPágina para comprar: ${evento.link}\n\nResponde de forma clara en español.`;
    } else if (/hola|buenas|ayuda|asistente|quién eres/i.test(userMessage)) {
      contexto += `Responde con un saludo cálido y una breve explicación de que puedes ayudar con información sobre los eventos musicales en Preding, y que pueden pedir la lista de eventos disponibles.`;
    } else {
      contexto += `El usuario escribió: "${userMessage}". Si no entiendes, dile amablemente que puede pedir la lista de eventos o escribir el número del evento para más detalles.`;
    }

    // 7. Enviar a OpenRouter
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: contexto },
          { role: "user", content: userMessage },
        ],
      }),
    });

    const aiJson = await aiResponse.json();
    const replyText = aiJson.choices?.[0]?.message?.content || "Lo siento, no entendí tu pregunta.";

    // 8. Enviar a WhatsApp
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
      }),
    });

    return res.status(200).end();
  }

  return res.status(405).end();
}
