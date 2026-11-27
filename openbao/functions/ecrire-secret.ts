import { chemin, ecrireDocument, type Entree, lireDocument } from "../lib/openbao";

type Cle = { cle: string; valeur?: string };

// Écrit plusieurs clés d’un secret en une fois. Ajout (par défaut) : les clés données remplacent ou s’ajoutent, les
// autres sont gardées. Remplacement (`remplacer`) : le secret ne garde que les clés données ; une clé sans `valeur`
// garde sa valeur actuelle, sans passer en clair. Une seule écriture, protégée par la version lue.
export default async function ({
  instance,
  chemin: cheminSecret,
  cles,
  remplacer = false,
}: Entree & { chemin: string; cles: Cle[]; remplacer?: boolean }) {
  const propre = chemin(cheminSecret);
  if (!propre) throw new Error("Le chemin du secret est obligatoire.");
  const entrees = (cles ?? []).map(({ cle, valeur }) => ({ cle: String(cle ?? "").trim(), valeur }));
  if (!entrees.length || entrees.some(({ cle }) => !cle)) throw new Error("Chaque clé du secret est requise.");
  if (new Set(entrees.map(({ cle }) => cle)).size !== entrees.length) throw new Error("Chaque clé doit être unique dans le secret.");
  if (!remplacer && entrees.some(({ valeur }) => !valeur)) throw new Error("Chaque valeur du secret est requise.");
  const document = await lireDocument(instance, propre);
  if (remplacer && !document.trouve) throw new Error(`Le secret « ${decodeURIComponent(propre)} » est introuvable.`);
  const valeurs: Record<string, string> = remplacer ? {} : { ...document.valeurs };
  for (const { cle, valeur } of entrees) {
    if (valeur) valeurs[cle] = valeur;
    else if (cle in document.valeurs) valeurs[cle] = document.valeurs[cle];
    else throw new Error(`Saisissez une valeur pour la clé « ${cle} ».`);
  }
  const version = await ecrireDocument(instance, propre, valeurs, document.version);
  return { chemin: decodeURIComponent(propre), cles: Object.keys(valeurs).length, version };
}
