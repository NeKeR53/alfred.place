import { badge } from "@alfred/sdk";
import { compterEnCours, lireEtats, lireToutesCartes } from "../lib/tableau";

export default async function () {
  const cartes = await lireToutesCartes();
  const etats = cartes.length > 0 ? await lireEtats(cartes) : new Map();
  const enCours = compterEnCours(etats);
  await badge.set(enCours, { page: "tableau-de-bord" });
  return { enCours, suivis: etats.size };
}
