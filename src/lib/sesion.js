import redis from "./redis.js";

export async function setSesion(numero, data) {
  await redis.set(`session:${numero}`, {
    ...data,
    timestamp: Date.now()
  });
}

export async function getSesion(numero) {
  const sesion = await redis.get(`session:${numero}`);
  if (!sesion) return null;

  // Expira en 15 minutos
  if (Date.now() - sesion.timestamp > 1000 * 60 * 15) {
    await redis.del(`session:${numero}`);
    return null;
  }

  return sesion;
}
