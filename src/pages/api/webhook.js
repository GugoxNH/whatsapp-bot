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

    console.log("Numero: ", senderNumber)
    console.log("MessageID: ", messageId)

    if (!userMessage || !senderNumber || !messageId) return res.status(200).end();
    if (processedMessages.has(messageId)) return res.status(200).end();
    processedMessages.add(messageId);

    // 1. Obtener todos los eventos desde la API
    const response = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
    const eventos = await response.json();

    // 2. Convertir eventos a texto amigable
    const eventosTexto = eventos.map((e, i) => {
      const zonas = e.variations
        .map(v => `- ${v.attributes["attribute_zonas"]} (${v.regular_price} MXN)`)
        .join("\n");

      return `Evento ${i + 1}:
Título: ${e.title}
Link: ${e.link}
Zonas:
${zonas}
`;
    }).join("\n");

    // 3. Crear contexto completo para IA
    const contexto = `
Eres un asistente de la boletera *Preding*. Tu trabajo es ayudar a los usuarios a encontrar eventos disponibles y guiarlos con información útil.
Al recibir un saludo, saluda de vuelta y ofrece el siguiente menú:
 "1. 🎫Lista de eventos disponibles 
  2. 💼Hablar con un asesor"

Aquí está la lista completa de eventos disponibles con todos los detalles:

${eventosTexto}

Reglas:
- Solo responde preguntas relacionadas con estos eventos y ofrece hablar con un asesor en caso de una petición diferente.
- Si el usuario quiere ver la lista, muéstrasela con los títulos numerados y el link del evento, has un salto de linea entre cada evento.
- Si el usuario pregunta por un número de evento, devuélvele el link y los precios.
- Si el usuario escribe algo fuera de tema, pídele que solicite la lista o escriba el número del evento.
- No inventes datos, responde siempre con la información proporcionada aquí.
- No asumas la ubicación del usuario.
- Si el usuario pide información muy especifica o algo con el que no puedas ayudarlo, sugiere que pida ayuda a un "asesor" y que le proporcionaras el número.
- Sé amable y breve.
`;

    // 4. Llamada a OpenRouter
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

    console.log("Res: ", replyText)

    if (replyText.toLowerCase().includes("asexcdsbciuwvcdsisor")) {
      const contactoPayload = {
        messaging_product: "whatsapp",
        to: senderNumber,
        type: "contacts",
        contacts: [
          {
            name: {
              formatted_name: "Raúl",
              first_name: "Acosta",
              last_name: ""
            },
            org: {
              company: "Preding",
              title: "Asesor de ventas"
            },
            phones: [
              {
                phone: "+5214111541592", // Número con lada internacional
                type: "Mobile",
                wa_id: "5214111541592"
              }
            ]
          }
        ]
      };

      await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(contactoPayload)
      });

      return res.status(200).end();
    }



    // 5. Enviar respuesta por WhatsApp
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
