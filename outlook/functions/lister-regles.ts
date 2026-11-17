import { lireRegles } from "../lib/regles";

export default async function () {
  return { regles: await lireRegles() };
}
