import { setSesion, getSesion } from "../../lib/sesion.js"; // o "../lib/..." según tu estructura
import stringSimilarity from "string-similarity";



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

    let sesion = await getSesion(senderNumber);


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

    let evento_select = "";
    if (sesion?.eventoIndex !== undefined) {
      const evento_aux = eventos[sesion.eventoIndex];
      const zonas = evento_aux.variations
        .map(v => `- ${v.attributes["attribute_zonas"]} (${v.regular_price} MXN)`)
        .join("\n");

      evento_select = `Este es el evento que seleccione:
Título: ${evento_aux.title}
Link: ${evento_aux.link}
Zonas:
${zonas}
`;
    }

    console.log("evento_select: ", evento_select);


    // 3. Crear contexto completo para IA
    const contexto = `Tu trabajo es ayudar a los usuarios a encontrar eventos disponibles y guiarlos con información útil.
Aquí está la lista completa de eventos disponibles con todos los detalles:
${eventosTexto}

${evento_select}

Reglas:
- Si recibes un número, pasa a tus acciones y has lo que se te dice ahi, no te inventes nada, e ignora la siguiente regla.
- Solo al recibir un saludo, responde con la palabra "hola".


Acciones:
- Si te escribo el número "1" muestrame la lista de los precios y las zonas del evento seleccionado, agrega un emoji al inicio de cada elemento referente al nombre de la zona.
- Si te escribo el número "2" muestrame el nombre de el evento en una linea y la fecha del evento en otra linea y el lugar en otra, usa el emoji "📅" para la fecha y el emoji "📍" para el lugar.

Solo responde al saludo y a esos dos números, cualquier otra cosa solo responde "Lo siento, no entendí tu pregunta."
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

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function enviarMensaje(numero, mensaje) {
      return fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: numero,
          type: "text",
          text: {
            preview_url: false,
            body: mensaje,
          },
        }),
      });
    }



    const aiJson = await aiResponse.json();
    let replyText = aiJson.choices?.[0]?.message?.content || "Lo siento, no entendí tu pregunta.";
    const eventosLista = eventos.map(e => `- ${e.title}`).join("\n");
    const lista = `🎟️ *Eventos disponibles:*\n${eventosLista}`;

    console.log("Respuesta IA: ", replyText);
    console.log("Mensaje user: ", userMessage);

    const mensajeSaludo = `👋 ¡Hola! Gracias por contactar a Soporte Boletos.  
Estamos aquí para ayudarte con cualquier duda sobre tu compra, boletos, fechas o disponibilidad.  
Por favor indícanos tu número de orden o el evento de tu interés.`;

    const contactoPayload = {
      messaging_product: "whatsapp",
      to: senderNumber,
      type: "contacts",
      contacts: [
        {
          name: {
            formatted_name: "Soporte",
            first_name: "Boletos",
            last_name: ""
          },
          org: {
            company: "Soporte Boletos",
            title: "Soporte"
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



    const saludoDetectado = /(hola|bienvenido|gracias por escribirnos|gracias por contactar)/i.test(replyText);
    const saludoDetectado_user = /(hola|informacion|eventos|saludos)/i.test(userMessage);
    //Primer mensaje de la la lista
    if (saludoDetectado && saludoDetectado_user) {
      await enviarMensaje(senderNumber, mensajeSaludo);
      console.log("saludoDetectado: ", saludoDetectado);
      await enviarMensaje(senderNumber, lista);
      return res.status(200).end();
    }

    // Función para normalizar texto (puedes moverla a un archivo utils si quieres reutilizarla)
    function normalizarTexto(str) {
      return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^ñ\w\s]/gi, "")
        .trim();
    }



    // Detectar eventos coincidentes con el mensaje del usuario
    let eventosDetectados = [];
let mejorCoincidencia = { index: -1, puntuacion: 0 };

const mensajeUsuarioNormalizado = normalizarTexto(userMessage);

// Buscar coincidencias exactas o parciales
for (let i = 0; i < eventos.length; i++) {
  const evento = eventos[i];
  const tituloArtista = evento.title.split(" - ")[0] || evento.title;
  const tituloNormalizado = normalizarTexto(tituloArtista);

  if (
    tituloNormalizado.includes(mensajeUsuarioNormalizado) ||
    mensajeUsuarioNormalizado.includes(tituloNormalizado)
  ) {
    eventosDetectados.push({ index: i, titulo: evento.title });
  } else {
    // Comparar similitud si no fue coincidencia exacta
    const similitud = stringSimilarity.compareTwoStrings(mensajeUsuarioNormalizado, tituloNormalizado);
    if (similitud > mejorCoincidencia.puntuacion && similitud >= 0.5) {
      mejorCoincidencia = { index: i, puntuacion: similitud };
    }
  }
}

// Si no hubo coincidencias directas, usar la mejor coincidencia aproximada
if (eventosDetectados.length === 0 && mejorCoincidencia.index !== -1) {
  eventosDetectados.push({ index: mejorCoincidencia.index, titulo: eventos[mejorCoincidencia.index].title });
}

if (eventosDetectados.length === 1) {
  const eventoIndex = eventosDetectados[0].index;
  await setSesion(senderNumber, { eventoIndex });
  sesion = await getSesion(senderNumber);
  console.log("🎯 Evento único detectado:", eventos[eventoIndex].title);
} else if (eventosDetectados.length > 1) {
  const opciones = eventosDetectados
    .map((e, i) => `${i + 1}. ${eventos[e.index].title}`)
    .join("\n");

  await enviarMensaje(senderNumber, `🎤 El artista tiene varios eventos. Por favor selecciona uno escribiendo el número correspondiente:\n${opciones}`);

  await setSesion(senderNumber, {
    posiblesEventos: eventosDetectados.map(e => e.index),
  });
  return res.status(200).end();
}

// Lógica para cuando el usuario contesta con un número y hay posiblesEventos
const seleccion = parseInt(userMessage.trim());

if (
  sesion?.posiblesEventos &&
  Number.isInteger(seleccion) &&
  seleccion >= 1 &&
  seleccion <= sesion.posiblesEventos.length
) {
  const eventoElegidoIndex = sesion.posiblesEventos[seleccion - 1];
  await setSesion(senderNumber, { eventoIndex: eventoElegidoIndex });
  sesion = await getSesion(senderNumber);
  console.log("🎯 Evento seleccionado desde lista:", eventos[eventoElegidoIndex].title);

  const mes = `Elegiste el evento ${eventos[eventoElegidoIndex].title} ¿Cómo podemos ayudarte? Elige una opción:
1⃣ Ver precios y zonas  
2⃣ Consultar fecha del evento  
3⃣ Ver disponibilidad  
4⃣ No recibí mis boletos   
5⃣ Enviar identificación   
6⃣ ¿Por qué me piden identificación?   
7⃣ Validar pago o correo   
8⃣ Comprar boletos
9⃣ Regresar a la lista de eventos`;
  await enviarMensaje(senderNumber, mes);
  return res.status(200).end();
}



    if (sesion?.eventoIndex !== undefined) {
      const evento = eventos[sesion.eventoIndex];
      console.log("Index del evento seleccionado " + sesion.eventoIndex);
      console.log("Evento: ", evento);
      console.log("✅ Evento desde Redis:", evento.title);
      const mes = `Elegiste el evento ${evento.title} ¿Cómo podemos ayudarte? Elige una opción:
1️⃣ Ver precios y zonas  
2️⃣ Consultar fecha del evento  
3️⃣ Ver disponibilidad  
4️⃣ No recibí mis boletos   
5️⃣ Enviar identificación   
6️⃣ ¿Por qué me piden identificación?   
7️⃣ Validar pago o correo   
8️⃣ Comprar boletos
9️⃣ Regresar a la lista de eventos`;

      const opcion = userMessage.trim();
      let mess_opt = "";

      if (/^(4|5|7)$/.test(opcion)) {
        switch (opcion) {
          case "4":
            mess_opt = `📩 No recibí mi correo con los boletos
Lamentamos el inconveniente :( 
Por favor compártenos el número de orden y el correo con el que realizaste la compra al siguiente contacto para validar el envío.

Mientras tanto, revisa tu bandeja de spam o no deseados. A veces los boletos llegan ahí.`;
            break;
          case "5"://cambiar correo
            mess_opt = `🪪 Problemas para mandar identificación
Si estás teniendo problemas para enviar tu identificación, puedes intentar lo siguiente:

1. Asegúrate de que la imagen esté clara y legible.  
2. Envía la foto directamente al contacto que se te mandará a continuación.  
3. También puedes mandarla por correo a: soporte@test.com

Recuerda que solicitar la identificación es un método de seguridad para proteger tu compra.  
Esto nos ayuda a verificar que el titular de la tarjeta es quien realizó la compra.`;
            break;
          case "7":
            mess_opt = `Para validar el pago de tu boleto o validar tu correo, por favor manda mensaje al siguiente contacto:`;
            break;
        }

        await enviarMensaje(senderNumber, mess_opt);

        await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${META_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(contactoPayload)
        });

        return res.status(200).end();
      } else if (/^1$/.test(opcion)) {
        mess_opt = `Los precios y zonas disponibles para *${evento.title}* son:
${replyText}`;
        await enviarMensaje(senderNumber, mess_opt);
        return res.status(200).end();
      } else if (/^2$/.test(opcion)) {
        await enviarMensaje(senderNumber, replyText);
        return res.status(200).end();
      } else if (/^3$/.test(opcion)) {
        mess_opt = `✅El evento de ${evento.title} aún se encuentra disponible, asegurate de darte prisa para conseguir tus boletos
🔗 Enlace para comprar boletos:
${evento.link}`;
        await enviarMensaje(senderNumber, "⌛Comprobando disponibilidad...");
        await sleep(3000);
        await enviarMensaje(senderNumber, mess_opt);
        return res.status(200).end();
      } else if (/^6$/.test(opcion)) {
        mess_opt = `❓ ¿Por qué me piden identificación?
La solicitud de identificación es una medida de seguridad para proteger tanto al comprador como al organizador del evento.  
Nos permite verificar que el titular de la tarjeta con la que se hizo el pago es quien realizó la compra, evitando fraudes o cargos no autorizados.`;
        await enviarMensaje(senderNumber, mess_opt);
        return res.status(200).end();
      } else if (/^8$/.test(opcion)) {
        mess_opt = `🔗 Enlace para comprar boletos
🎫 Puedes comprar tus boletos para *${evento.title}* en el siguiente enlace:  
👉 ${evento.link}

Te recomendamos hacerlo lo antes posible, ya que los boletos están sujetos a disponibilidad.`;
        await enviarMensaje(senderNumber, mess_opt);
        return res.status(200).end();
      } else if (/^9$/.test(opcion)) {
        await setSesion(senderNumber, {}); // Borra la sesión
        sesion = await getSesion(senderNumber); // Reinicia vacía
        await enviarMensaje(senderNumber, mensajeSaludo);
        await enviarMensaje(senderNumber, lista);
        return res.status(200).end();
      } else {
        await enviarMensaje(senderNumber, mes);
      }
      return res.status(200).end();
    }

    /* 
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
    
        return res.status(200).end(); */
  }
  return res.status(405).end();
}
