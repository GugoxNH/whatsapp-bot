import { setSesion, getSesion } from "../../lib/sesion.js";
import { posthog } from '../../lib/posthog';

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

    const matchedFlagPayload = await posthog.getFeatureFlagPayload('dynamic-endpoints', 'bot-id')

    let sesion = await getSesion(senderNumber);
    let eventos = [];


    console.log("Numero: ", senderNumber)
    console.log("MessageID: ", messageId)

    if (!userMessage || !senderNumber || !messageId) return res.status(200).end();
    if (processedMessages.has(messageId)) return res.status(200).end();
    processedMessages.add(messageId);

    //const isMyFlagEnabledForUser = await posthog.isFeatureEnabled('dynamic-endpoints', 'bot-id')

    if (Array.isArray(matchedFlagPayload) && matchedFlagPayload.length > 0) {
      const responses = await Promise.allSettled(
        matchedFlagPayload.map(async (endpoint) => {
          try {
            const res = await fetch(endpoint.url);
            if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
            const json = await res.json();

            if (json?.status === "desactivado") {
              console.warn(`⚠️ Ignorado por status desactivado: ${endpoint.url}`);
              return null;
            }

            return json;
          } catch (error) {
            console.warn(`❌ Error al consultar: ${endpoint.url}`, error.message);
            return null;
          }
        })
      );

      // Extraer solo las respuestas válidas (que no sean null y sean arrays)
      eventos = responses
        .filter(result => result.status === "fulfilled" && Array.isArray(result.value))
        .flatMap(result => result.value);

      if (!eventos.length) {
        eventos = [{ status: "desactivado" }];
      }
    } else {
      eventos = [{ status: "desactivado" }];
    }

    /*  /
     const response = await fetch("https://mipase.pagaboletos.com/wp-json/whatsapp-api/v1/products");
     const eventos = await response.json(); */

    // 2. Convertir eventos a texto amigable
    let eventosTexto = "No hay eventos disponibles";
    let evento_select = "";

    // Verifica si eventos tiene datos válidos (que no sea solo el objeto de desactivado)
    const eventosValidos = Array.isArray(eventos) && eventos.length && !eventos[0]?.status;

    if (eventosValidos) {
      // Convertir eventos a texto amigable
      eventosTexto = eventos.map((e, i) => {
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

      // Mostrar evento seleccionado si hay sesión válida
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
    }

    // 3. Crear contexto completo para IA
    const contexto = `Tu trabajo es ayudar a los usuarios a encontrar eventos disponibles y guiarlos con información útil.
Aquí está la lista completa de eventos disponibles con todos los detalles:
${eventosTexto}

${evento_select}

Reglas:
- Si recibes un número, pasa a tus acciones y has lo que se te dice ahi, no te inventes nada, e ignora la siguiente regla.
- Solo al recibir un saludo, responde con la palabra "hola".

Acciones:
- Si te escribo el número "1" muestrame la lista de los precios y las zonas del evento seleccionado, agrega los siguientes emojis segun la area (💎) DIAMANTE, (🔒) VIP, (👑) DORADA, (💙) AZUL, (💛) AMARILLA, (❤️) ROJA. Agrega el texto "Más cargos por servicio" después de cada precio.
- Si te escribo el número "2" muestrame el nombre de el evento en una linea y la fecha del evento en otra linea y el lugar en otra, usa el emoji "📅" para la fecha y el emoji "📍" para el lugar.

Solo responde al saludo y a esos dos números, cualquier otra cosa solo responde "Lo siento, no entendí tu pregunta."
`;

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
    //const eventosLista = eventos.map(e => `- ${e.title}`).join("\n");
    //const lista = `🎟️ *Eventos disponibles:*\n${eventosLista}`;

    //console.log("Respuesta IA: ", replyText);
    // console.log("Mensaje user: ", userMessage);

    const mensajeSaludo = `👋 ¡Hola! Gracias por contactar a Soporte Boletos.  
Estamos aquí para ayudarte con cualquier duda sobre tu compra, boletos, fechas o disponibilidad.  
Por favor indícanos tu número de orden o el evento de tu interés.
¿Cómo podemos ayudarte? Elige una opción:

1️⃣ Ver precios y zonas  
2️⃣ Consultar fecha del evento  
3️⃣ Ver disponibilidad  
4️⃣ No recibí mis boletos   
5️⃣ Enviar identificación   
6️⃣ Validar pago o correo   
7️⃣ Comprar boletos
8️⃣ Por que no pasa mi pago
9️⃣ Hablar con un asesor`;

    const contactoPayload = {
      messaging_product: "whatsapp",
      to: senderNumber,
      type: "contacts",
      contacts: [
        {
          name: {
            formatted_name: "Soporte Especializado Boletos",
            first_name: "Soporte Especializado Boletos",
            last_name: ""
          },
          org: {
            company: "Soporte Especializado Boletos",
            title: "Soporte Especializado Boletos"
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
    const saludoDetectado_user = /(hola|informacion|menú|menu|Menu|saludos)/i.test(userMessage);
    //Primer mensaje de la la lista
    if (saludoDetectado && saludoDetectado_user) {
      await enviarMensaje(senderNumber, mensajeSaludo);
      return res.status(200).end();
    }

    // Función para normalizar texto (puedes moverla a un archivo utils si quieres reutilizarla)
    /*     function normalizarTexto(str) {
          return str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^ñ\w\s]/gi, "")
            .trim();
        } */

    function construirPromptParaEvento(userMessage, eventos) {
      //const listaArtistas = eventos.map((e, i) => `${i + 1}. ${e.title.split(" - ")[0]}`).join("\n");
      const listaArtistas = eventos.map((e, i) => `${i}. ${e.title}`).join("\n");

      return `
El usuario escribió: "${userMessage}"

Instrucciones: Si el usuario envía un número que está en la lista del 1 al 10 (incluyendo ambos), entonces simplemente responde "no" y no proceses ninguna otra instrucción. Si el mensaje se refiere a un artista o evento según la lista proporcionada, responde con el índice correspondiente (empezando desde 0). Si hay coincidencias múltiples, devuélvelos separados por comas. Si no hay coincidencias claras, simplemente responde "no".

Lista de números a ignorar: "1", "2", "3", "4", "5", "6", "7", "8", "9", "10".

LISTA DE ARTISTAS:
${listaArtistas}

Si no hay coincidencia clara, responde solamente con: "no".
Ejemplos de respuestas válidas: 
- 3
- 5,8
- no
`;
    }

    const prompt = construirPromptParaEvento(userMessage, eventos);
    console.log(prompt)

    const respuestaIA = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const data = await respuestaIA.json();
    const contenidoIA = data.choices?.[0]?.message?.content?.trim();


    console.log("Seleccion IA", contenidoIA);

    const indicesTexto = contenidoIA.split(",").map(i => parseInt(i.trim())).filter(n => !isNaN(n));

    console.log("index", indicesTexto);

    if (indicesTexto.length === 1) {
      // 🎯 Solo un evento detectado
      const eventoIndex = indicesTexto[0];
      await setSesion(senderNumber, { eventoIndex });
      sesion = await getSesion(senderNumber);

      await enviarMensaje(senderNumber, `Elegiste el evento *${eventos[eventoIndex].title}* ¿Cómo podemos ayudarte? Elige una opción:
1️⃣ Ver precios y zonas  
2️⃣ Consultar fecha del evento  
3️⃣ Ver disponibilidad  
4️⃣ No recibí mis boletos   
5️⃣ Enviar identificación   
6️⃣ Validar pago o correo   
7️⃣ Comprar boletos
8️⃣ Por que no pasa mi pago
9️⃣ Hablar con un asesor
🔟 Elegir otro evento`);
      return res.status(200).end();
    }

    if (indicesTexto.length > 1) {
      // 🎯 Múltiples eventos detectados
      const opcionesTexto = indicesTexto.map((i, idx) => `${idx + 1}. ${eventos[i].title}`).join("\n");

      await enviarMensaje(senderNumber, `🎤 El artista tiene varios eventos. Por favor selecciona uno escribiendo el número correspondiente:\n${opcionesTexto}`);

      await setSesion(senderNumber, {
        posiblesEventos: indicesTexto,
      });
      return res.status(200).end();
    }

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
1️⃣ Ver precios y zonas  
2️⃣ Consultar fecha del evento  
3️⃣ Ver disponibilidad  
4️⃣ No recibí mis boletos   
5️⃣ Enviar identificación   
6️⃣ Validar pago o correo   
7️⃣ Comprar boletos
8️⃣ Por que no pasa mi pago
9️⃣ Hablar con un asesor
🔟 Elegir otro evento`;
      await enviarMensaje(senderNumber, mes);
      return res.status(200).end();
    }



    /* 
        // Detectar eventos coincidentes con el mensaje del usuario
        let eventosDetectados = [];
    
        const mensajeUsuarioNormalizado = normalizarTexto(userMessage);
        eventos.forEach((evento, index) => {
          const tituloArtista = evento.title.split(" - ")[0] || evento.title;
          const tituloNormalizado = normalizarTexto(tituloArtista);
          if (
            tituloNormalizado.includes(mensajeUsuarioNormalizado) ||
            mensajeUsuarioNormalizado.includes(tituloNormalizado)
          ) {
            eventosDetectados.push({ index, titulo: evento.title });
          }
        });
    
        if (eventosDetectados.length === 1) {
          const eventoIndex = eventosDetectados[0].index;
          await setSesion(senderNumber, { eventoIndex });
          sesion = await getSesion(senderNumber);
          const mes = `Elegiste el evento ${eventos[eventoIndex].title} ¿Cómo podemos ayudarte? Elige una opción:
    1️⃣ Ver precios y zonas  
    2️⃣ Consultar fecha del evento  
    3️⃣ Ver disponibilidad  
    4️⃣ No recibí mis boletos   
    5️⃣ Enviar identificación   
    6️⃣ Validar pago o correo   
    7️⃣ Comprar boletos
    8️⃣ Elegir un nuevo evento`;
          await enviarMensaje(senderNumber, mes);
    
          // console.log("🎯 Evento único detectado:", eventos[eventoIndex].title);
        } else if (eventosDetectados.length > 1) {
          const opciones = eventosDetectados
            .map((e, i) => `${i + 1}. ${eventos[e.index].title}`)
            .join("\n");
    
          await enviarMensaje(senderNumber, `🎤 El artista tiene varios eventos. Por favor selecciona uno escribiendo el número correspondiente:\n${opciones}`);
    
          await setSesion(senderNumber, {
            posiblesEventos: eventosDetectados.map(e => e.index),
          });
          return res.status(200).end();
        } */

    // Lógica para cuando el usuario contesta con un número y hay posiblesEventos



    const opcion = userMessage.trim();
    let mess_opt = "";

    if (/^(4|5|6|8|9)$/.test(opcion)) {
      switch (opcion) {
        case "4":
          mess_opt = `📩 No recibí mi correo con los boletos
Lamentamos el inconveniente 😔
Por favor compártenos el número de orden y el correo con el que realizaste la compra al siguiente contacto para validar el envío.

Mientras tanto, revisa tu bandeja de spam o no deseados. A veces los boletos llegan ahí.`;
          break;
        case "5"://cambiar correo
          mess_opt = `🪪 Problemas para mandar identificación
Si estás teniendo problemas para enviar tu identificación, puedes intentar lo siguiente:

1. Asegúrate de que la imagen esté clara y legible.  
2. Envía la foto directamente al contacto que se te mandará a continuación.  
3. Asegúrate de indicar tu número de pedido y correo al enviar tu foto

Recuerda que solicitar la identificación es un método de seguridad para proteger tu compra.  
Esto nos ayuda a verificar que el titular de la tarjeta es quien realizó la compra.`;
          break;
        case "6":
          mess_opt = `Para validar el pago de tu boleto o validar tu correo, por favor manda mensaje al siguiente contacto:`;
          break;
        case "8":
          mess_opt = `Si tu pago fue rechazado, te recomendamos lo siguiente:
1.	Verifica que ingresaste correctamente la fecha de vencimiento y el código de seguridad (CVV).
2.	Asegúrate de contar con fondos suficientes y de estar utilizando tu tarjeta digital, si es requerida por tu banco.
3.	Revisa tu app bancaria o tus mensajes SMS, ya que en muchos casos tu banco envía un código de verificación o una alerta de seguridad que debes autorizar para completar la compra.
4.	Evita intentar la compra repetidamente, ya que esto puede provocar el bloqueo temporal de tu tarjeta. En ese caso, comunícate directamente con tu banco y solicita que autoricen el cargo de forma manual.`;
          break;
      }
      await enviarMensaje(senderNumber, mess_opt);

      if(opcion != "8")
      await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(contactoPayload)
      });
      await enviarMensaje(senderNumber, "Si quieres más información de las opciones, manda otro número");

      return res.status(200).end();
    } else if (/^(1|2|3|7|10)$/.test(opcion)) {

      const eventosValidos = Array.isArray(eventos) && eventos.length && !eventos[0]?.status;
      if (!eventosValidos) {
        await enviarMensaje(senderNumber, 'Por el momento no hay eventos disponibles, por favor intenta con otra opción');
        return res.status(200).end();
      }

      if (sesion?.eventoIndex === undefined) {
        await enviarMensaje(senderNumber, 'Necesitas escribir el nombre del evento y la ciudad en la cual se llevara acabo para obtener esta información');
        return res.status(200).end();
      }
      const evento = eventos[sesion.eventoIndex];
      console.log("✅ Evento desde Redis:", evento.title);
      if (/^1$/.test(opcion)) {
        mess_opt = `Los precios y zonas disponibles para *${evento.title}* son:
${replyText}

Para adquirir culquier boleto puedes hacerlo desde el siguiente enlace:
${evento.link}`;
        await enviarMensaje(senderNumber, mess_opt);
        await enviarMensaje(senderNumber, "Si quieres más información de las opciones, manda otro número");
        return res.status(200).end();
      } else if (/^2$/.test(opcion)) {
        await enviarMensaje(senderNumber, replyText);
        await enviarMensaje(senderNumber, "Si quieres más información de las opciones, manda otro número");
        return res.status(200).end();
      } else if (/^3$/.test(opcion)) {
        mess_opt = `✅El evento de ${evento.title} aún se encuentra disponible, asegurate de darte prisa para conseguir tus boletos
🔗 Enlace para comprar boletos:
${evento.link}`;
        await enviarMensaje(senderNumber, "⌛Comprobando disponibilidad...");
        await sleep(3000);
        await enviarMensaje(senderNumber, mess_opt);
        await enviarMensaje(senderNumber, "Si quieres más información de las opciones, manda otro número");
        return res.status(200).end();
      } else if (/^7$/.test(opcion)) {
        mess_opt = `🔗 Enlace para comprar boletos
🎫 Puedes comprar tus boletos para *${evento.title}* en el siguiente enlace:  
👉 ${evento.link}

Te recomendamos hacerlo lo antes posible, ya que los boletos están sujetos a disponibilidad.`;
        await enviarMensaje(senderNumber, mess_opt);
        await enviarMensaje(senderNumber, "Si quieres más información de las opciones, manda otro número");
        return res.status(200).end();
      } else if (/^10$/.test(opcion)) {
        await setSesion(senderNumber, {}); // Borra la sesión
        sesion = await getSesion(senderNumber); // Reinicia vacía
        await enviarMensaje(senderNumber, mensajeSaludo);
        return res.status(200).end();
      }
    } else {
      /*       await enviarMensaje(senderNumber, replyText);
            return res.status(200).end(); */
    }

    if (saludoDetectado_user) {
      await setSesion(senderNumber, {}); // Borra la sesión
      sesion = await getSesion(senderNumber); // Reinicia vacía
      await enviarMensaje(senderNumber, mensajeSaludo);
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
          body: 'No eh entendido lo que has escrito, por favor vuelve a intentarlo. Si quieres volver a ver el menú escribe "menú"',
        },
      }),
    });

    return res.status(200).end();
  }
  return res.status(405).end();
}
