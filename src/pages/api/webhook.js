export default async function handler(req, res) {
  if (req.method === "GET") {
    if (req.query["hub.verify_token"] === "HolaNovato") {
      return res.status(200).send(req.query["hub.challenge"]);
    } else {
      return res.status(403).send("Error de autentificación.");
    }
  }

  if (req.method === "POST") {
    const body = req.body;

    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) {
      return res.status(200).send("No message");
    }

    const message = body.entry[0].changes[0].value.messages[0];
    const phoneNumber = message.from;
    const text = message.text?.body?.toLowerCase() || "";

    // Obtener eventos desde tu API externa
    const response = await fetch("https://smarticket.pagaboletos.com/wp-json/whatsapp-api/v1/products");
    const events = await response.json();

    let reply = "";

    if (text.includes("lista") || text.includes("eventos")) {
      reply = "🎶 *Eventos disponibles:*\n\n" + events.map((e, i) => `${i + 1}. ${e.title}`).join("\n");
      reply += `\n\n📝 Puedes pedir más información escribiendo por ejemplo: *evento 2* o *quiero info del evento de Pesado*`;
    } else if (text.match(/^evento\s*\d+/)) {
      const match = text.match(/^evento\s*(\d+)/);
      const index = parseInt(match[1]) - 1;
      const event = events[index];
      if (event) {
        reply = formatEventDetails(event);
      } else {
        reply = "❌ No encontré ese número de evento.";
      }
    } else {
      const matchedEvent = events.find(e =>
        text.includes(e.title.toLowerCase().split(" - ")[0].trim())
      );

      if (matchedEvent) {
        reply = formatEventDetails(matchedEvent);
      } else {
        reply = "👋 ¡Hola! Soy el asistente virtual de *PREDING*. Puedo ayudarte a conocer los eventos musicales disponibles en San Luis Potosí.\n\n✉️ Puedes escribirme:\n- *Lista de eventos*\n- *Evento 1*\n- *Información de Junior H*\n\n¿Con qué te gustaría comenzar?";
      }
    }

    await sendWhatsAppMessage(phoneNumber, reply);
    return res.status(200).send("OK");
  }

  return res.status(405).send("Método no permitido.");
}

// Enviar respuesta por WhatsApp (ajusta con tu token correcto)
async function sendWhatsAppMessage(to, message) {
  const token = process.env.WHATSAPP_TOKEN;

  await fetch("https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: message },
    }),
  });
}

// Formatea los detalles del evento
function formatEventDetails(event) {
  let msg = `🎟️ *${event.title}*\n\n`;
  msg += `🔗 [Página del evento](${event.link})\n\n`;
  msg += `💰 *Precios disponibles:*\n`;

  event.variations.forEach(v => {
    msg += `- ${v.attributes["attribute_zonas"]}\n`;
  });

  msg += `\n¿Necesitas ayuda para comprar tus boletos o tienes otra duda?`;
  return msg;
}
