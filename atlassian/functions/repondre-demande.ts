import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Réponse au client, ou note interne, sur une demande de support. */
export default async function ({
  instance,
  cle,
  texte,
  interne,
}: {
  instance?: string;
  cle: string;
  texte: string;
  interne?: boolean;
}) {
  if (!cle?.trim()) throw new Error("La clé de la demande est vide.");
  if (!texte?.trim()) throw new Error("Le message est vide.");
  const visible = !interne;
  const reponse = await client("jira", { instance }).post<{ id?: string | number }>(
    `/rest/servicedeskapi/request/${encodeURIComponent(cle.trim())}/comment`,
    { body: texte.trim(), public: visible },
  );
  if (!reponse.ok) erreurAtlassian("Jira Service Management", reponse);
  return { commentaire: reponse.body?.id !== undefined ? String(reponse.body.id) : null, public: visible };
}
