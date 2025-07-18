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
    const contexto = `Tu trabajo es ayudar a los usuarios a encontrar eventos disponibles y guiarlos con información útil.
Al recibir un saludo, responde con un "hola".

Aquí está la lista completa de eventos disponibles con todos los detalles:

${eventosTexto}

Reglas:
- Si el mensaje recibido por el usuario no tiene sentido responde "Lo siento, no entendí tu pregunta. ¿Podrías repetirlo 😊?"
- Solo responde preguntas relacionadas con estos eventos y ofrece hablar con un asesor en caso de una petición diferente.
- Si el usuario quiere ver la lista, muéstrasela con los títulos numerados y el link del evento solamente, has un salto de linea entre cada evento.
- Si el usuario pregunta por un número de evento, devuélvele el link y los precios.
- Si el usuario escribe algo fuera de tema, pídele que solicite la lista o escriba el número del evento.
- No inventes datos, responde siempre con la información proporcionada aquí.
- No asumas la ubicación del usuario.0
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

    const sesiones = new Map(); // key: número de WhatsApp, value: { eventoIndex, timestamp }

    function setSesion(numero, data) {
      sesiones.set(numero, { ...data, timestamp: Date.now() });
    }

    function getSesion(numero) {
      const sesion = sesiones.get(numero);
      if (!sesion) return null;
      if (Date.now() - sesion.timestamp > 1000 * 60 * 15) {
        sesiones.delete(numero);
        return null;
      }
      return sesion;
    }
    const sesion = getSesion(senderNumber);



    // Detectar si el mensaje menciona algún evento por nombre
    const mensajeUsuarioNormalizado = userMessage
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s]/gi, ""); // quitar signos


    let eventoIndexDetectado = -1;

    eventos.forEach((evento, index) => {
      const tituloNormalizado = evento.title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, "");

      if (
        tituloNormalizado.includes(mensajeUsuarioNormalizado) ||
        mensajeUsuarioNormalizado.includes(tituloNormalizado)
      ) {
        eventoIndexDetectado = index;
      }
    });

    if (eventoIndexDetectado !== -1) {
      console.log(`🎯 Evento detectado: ${eventos[eventoIndexDetectado].title}`);
      setSesion(senderNumber, { eventoIndex: eventoIndexDetectado });
    }


    if (eventoIndexDetectado !== -1) {
      console.log(`🎯 Evento detectado por nombre: ${eventos[eventoIndexDetectado].title}`);
      setSesion(senderNumber, { eventoIndex: eventoIndexDetectado });
    }



    if (sesion?.eventoIndex !== undefined) {
      const evento = eventos[sesion.eventoIndex];
      console.log("Index del evento seleccionado " + sesion.eventoIndex);
      console.log("Evento: ", evento);

      const mes = `Elegiste el evento ${evento.title} ¿Cómo podemos ayudarte? Elige una opción:
1️⃣ Ver precios y zonas  
2️⃣ Consultar fecha del evento  
3️⃣ Ver disponibilidad  
4️⃣ No recibí mis boletos   
5️⃣ Enviar identificación   
6️⃣ ¿Por qué me piden identificación?   
7️⃣ Validar pago o correo   
8️⃣ Comprar boletos`;

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
            body: mes,
          },
        }),
      });
      // Ahora puedes usar: evento.title, evento.link, evento.image, etc.
    }




    const aiJson = await aiResponse.json();
    let replyText = aiJson.choices?.[0]?.message?.content || "Lo siento, no entendí tu pregunta.";

    const mensajeSaludo = `👋 ¡Hola! Gracias por contactar a Soporte Boletos.  
Estamos aquí para ayudarte con cualquier duda sobre tu compra, boletos, fechas o disponibilidad.  
Por favor indícanos tu número de orden o el evento de tu interés.`;

    // Verificamos si la IA devolvió un saludo inicial
    const saludoDetectado = /^hola|bienvenido|gracias por escribirnos|gracias por contactar/i.test(replyText);

    if (saludoDetectado) {
      // Agregamos lista de eventos
      const eventosLista = eventos.map(e => `- ${e.title}`).join("\n");
      const lista = `🎟️ *Eventos disponibles:*\n${eventosLista}`;

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
            body: mensajeSaludo,
          },
        }),
      });

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
            body: lista,
          },
        }),
      });

      return res.status(200).end();

    }
    /*     if (userMessage.toLowerCase().includes("2")) {
    
        } */

    if (userMessage.toLowerCase().includes("4") || userMessage.toLowerCase().includes("7") || userMessage.toLowerCase().includes("5") || userMessage.toLowerCase().includes("6")) {
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
                phone: "+5215639645766", // Número con lada internacional
                type: "Mobile",
                wa_id: "5215639645766"
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
