import { chemin, ecrireDocument, lireDocument } from "../lib/openbao";

// Copie un secret entier vers un autre compte OpenBao, sans exposer ses valeurs ; refuse d’écraser un secret existant.
export default async function ({
  source,
  destination,
  chemin: cheminSecret,
  cheminDestination,
}: {
  source: string;
  destination: string;
  chemin: string;
  cheminDestination?: string;
}) {
  const depuis = chemin(cheminSecret);
  const vers = chemin(cheminDestination) || depuis;
  if (source === destination && depuis === vers) throw new Error("Choisissez un autre compte ou un autre chemin de destination.");
  const lu = await lireDocument(source, depuis);
  if (!lu.trouve || !Object.keys(lu.valeurs).length) throw new Error(`Le secret « ${decodeURIComponent(depuis)} » est vide ou absent.`);
  const cible = await lireDocument(destination, vers);
  if (cible.trouve) throw new Error("Le secret existe déjà à destination : rien n’a été écrasé.");
  const version = await ecrireDocument(destination, vers, lu.valeurs, 0);
  return { destination, chemin: decodeURIComponent(vers), cles: Object.keys(lu.valeurs).length, version };
}
