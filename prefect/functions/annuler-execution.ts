import { erreurPrefect, type FlowRunPrefect, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; execution: string }) {
  if (!input.execution) throw new Error("Indiquez l’exécution à annuler.");
  const api = prefect(input.instance);
  const chemin = `/flow_runs/${encodeURIComponent(input.execution)}`;
  const lecture = await api.get<FlowRunPrefect>(chemin);
  if (!lecture.ok) throw erreurPrefect(lecture.status, "cette exécution", lecture.body);

  // Une exécution qui n’a pas démarré s’annule tout de suite ; une exécution lancée passe par « Cancelling ».
  const type = lecture.body.state?.type ?? "";
  if (["COMPLETED", "FAILED", "CANCELLED", "CRASHED"].includes(type))
    throw new Error("Cette exécution est déjà terminée.");
  const etat = ["SCHEDULED", "PAUSED"].includes(type)
    ? { type: "CANCELLED", name: "Cancelled", message: "Annulée depuis Alfred." }
    : { type: "CANCELLING", name: "Cancelling", message: "Annulation demandée depuis Alfred." };

  const reponse = await api.post<{ status?: string; details?: { reason?: string } }>(`${chemin}/set_state`, { state: etat });
  if (!reponse.ok) throw erreurPrefect(reponse.status, "l’annulation de cette exécution", reponse.body);
  if (reponse.body?.status && reponse.body.status !== "ACCEPT")
    throw new Error(`Prefect a refusé l’annulation${reponse.body.details?.reason ? ` : ${reponse.body.details.reason}` : "."}`);
  return { annulee: true, etat: etat.type };
}
