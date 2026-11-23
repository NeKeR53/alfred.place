import { classerMessages, type MessageAClasser } from "../lib/points";

/** Classe des messages dans les points d’entrée actifs (résultat gardé par message). */
export default async function ({ messages = [] }: { messages?: MessageAClasser[] }) {
  return { resultats: await classerMessages(messages.slice(0, 100)) };
}
