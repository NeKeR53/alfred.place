import { states, useAlfredState } from "@alfred/sdk";
import { useMemo } from "react";

export interface DossierOutlook {
  id: string;
  nom: string;
  parent?: string;
  profondeur: number;
  nonLus?: number;
  total?: number;
}

export interface CompteOutlook {
  id: string;
  label: string;
  default?: boolean;
}

export interface EtatComptes {
  comptes: CompteOutlook[];
  pret: boolean;
  profil: { nom: string; adresse: string } | null;
}

/** Comptes Outlook du poste, suivis en direct, et si l’application répond. */
export function useComptesOutlook() {
  const comptes = useAlfredState<EtatComptes>("comptes");
  const pret = comptes.data?.pret === true;
  const indisponible = (Boolean(comptes.error) && !comptes.data) || (comptes.data !== undefined && !pret);
  return { comptes, pret, indisponible };
}

/** Dossiers d’un compte (vide : le compte par défaut), suivis seulement quand Outlook répond. */
export function useDossiersOutlook(pret: boolean, compte = "") {
  const dossiers = useAlfredState<{ boite: string; dossiers: DossierOutlook[] }>(pret ? "dossiers" : null, {
    params: { compte },
  });
  // Calculés une fois par valeur de l’état : les listes qui en dépendent ne se redessinent pas pour rien.
  const { liste, noms, options } = useMemo(() => {
    const liste = dossiers.data?.dossiers ?? [];
    const noms: Record<string, string> = {};
    for (const dossier of liste) noms[dossier.id] = dossier.nom;
    const options = liste.map((dossier) => ({
      id: dossier.id,
      label: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
    }));
    return { liste, noms, options };
  }, [dossiers.data]);
  return { dossiers, liste, noms, options, boite: dossiers.data?.boite ?? "" };
}

/** Contenu d’une pièce jointe, lu par l’état partagé « piece-jointe » (lu une fois, puis gardé). */
export async function lirePieceJointe(message: string, piece: string): Promise<string | null> {
  const options = { params: { message, piece } };
  let lecture = await states.get("piece-jointe", options);
  if (lecture.empty) {
    await lecture.refresh();
    lecture = await states.get("piece-jointe", options);
  }
  const valeur = lecture.value as { piece?: { dataUrl?: string | null } | null } | undefined;
  return valeur?.piece?.dataUrl ?? null;
}
