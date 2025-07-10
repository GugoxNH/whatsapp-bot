export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // puedes ajustar el tamaño si es necesario
    },
  },
};

export default function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "hhrXMDhkGJfe";

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }

  if (req.method === 'POST') {
    console.log("📩 Mensaje recibido:", req.body);
    return res.sendStatus(200);
  }

  res.status(405).send('Método no permitido');
}
