import { chemin, ecrireDocument, lireDocument } from "../lib/openbao";

// Copie une clé d’un compte OpenBao vers un autre (prod vers recette…) sans que sa valeur passe par la fonction :
// la référence lue à la source est remplacée par Alfred dans l’écriture vers la destination.
export default async function ({
  source,
  destination,
  chemin: cheminSecret,
  cheminDestination,
  cle,
  ecraser,
}: {
  source: string;
  destination: string;
  chemin: string;
  cheminDestination?: string;
  cle: string;
  ecraser?: boolean;
}) {
  const depuis = chemin(cheminSecret);
  const vers = chemin(cheminDestination) || depuis;
  if (source === destination && depuis === vers) throw new Error("Choisissez un autre compte ou un autre chemin de destination.");
  const lu = await lireDocument(source, depuis);
  if (!(cle in lu.valeurs)) throw new Error(`La clé « ${cle} » n’existe pas dans « ${decodeURIComponent(depuis)} ».`);
  const cible = await lireDocument(destination, vers);
  if (cle in cible.valeurs && !ecraser)
    throw new Error(`La clé « ${cle} » existe déjà à destination : rien n’a été écrasé.`);
  const version = await ecrireDocument(destination, vers, { ...cible.valeurs, [cle]: lu.valeurs[cle] }, cible.version);
  return { destination, chemin: decodeURIComponent(vers), cle, version };
}
