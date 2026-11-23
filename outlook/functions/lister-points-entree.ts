import { lirePoints } from "../lib/points";

/** Les points d’entrée du tri, actifs ou non. */
export default async function () {
  return { points: await lirePoints() };
}
