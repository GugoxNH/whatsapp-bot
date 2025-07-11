// Cache temporal para evitar respuestas duplicadas (opcional)
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
  const MODEL_NAME = process.env.MODEL_NAME || "deepseek/deepseek-r1-0528-qwen3-8b:free";

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

    // 🧠 Solicitud al modelo
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer deepseek/deepseek-r1-0528-qwen3-8b:free`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          {
            role: "system",
            content: `
Eres un asistente de una dulcería llamada CandyShop. Solo debes responder preguntas relacionadas con los siguientes productos:

1. *Perico artesanal*: Polvo sabor limón con potente acidez. Costo: 20 pesos.
2. *Cricri*: Piedritas de chocolate perfectas para derretir. Costo: 10 pesos.
3. *Fenti*: Pastillas sabor menta que dejan un sabor delicioso todo el día. Costo: 5 pesos.

Los productos se venden únicamente por transferencia de bitcoin a la cartera "0######XXXXXX".

Si el usuario hace una pregunta que no esté relacionada con esos productos, sus precios o la forma de pago, respóndele con amabilidad que para obtener más información o hacer preguntas más específicas debe contactar con un distribuidor oficial llamado *CandyShop*, número: XXX-XXX-XX-XX.

Si el usuario se le nota interesado, trata de persuadirlo para comprar cualquier producto.

Si el usuario te pide una recomendación, responde alguno de los tres productos al azár y hazlo que se vea bastante llamativo.

No inventes información. No respondas sobre otros temas. Sé breve, claro y amable en todas tus respuestas.
            `,
          },
          { role: "user", content: userMessage },
        ],
      }),
    });

    const aiJson = await aiResponse.json();

    // Validación robusta
    if (!aiJson.choices || !aiJson.choices[0]?.message?.content) {
      console.error("❌ Error en respuesta de OpenRouter:", aiJson);
      return res.status(200).end();
    }

    const replyText = aiJson.choices[0].message.content;

    // 📤 Respuesta por WhatsApp
    const whatsappRes = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
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

    const whatsappJson = await whatsappRes.json();
    console.log("✅ Respuesta enviada a WhatsApp:", whatsappJson);

    return res.status(200).end();
  }

  res.status(405).end();
}
