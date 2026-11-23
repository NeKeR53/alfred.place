import { db, shell } from "@alfred/sdk";
import { analyserBuild, recompterNonLus } from "../lib/rapport";
import { lireEtats, lireToutesCartes, nomCourt } from "../lib/tableau";

/** Seuls les échecs récents sont analysés d’eux-mêmes : les plus anciens restent à la demande. */
const FENETRE = 24 * 3600_000;
/** Une analyse restée « en cours » plus longtemps a été interrompue : elle est reprise. */
const INTERROMPUE = 15 * 60_000;
const PAR_PASSAGE = 2;

interface Candidat {
  instance: string;
  job: string;
  build: number;
  finiLe: string;
}

export default async function () {
  const cartes = await lireToutesCartes();
  if (cartes.length === 0) return { analyses: 0, echouees: 0, enAttente: 0, nonLus: await recompterNonLus() };

  const etats = await lireEtats(cartes);
  const maintenant = Date.now();
  const candidats: Candidat[] = [];
  for (const [cle, etat] of etats) {
    const termine = etat.dernierTermine;
    if (!etat.existe || !termine || termine.resultat !== "FAILURE" || !termine.debut) continue;
    const fin = new Date(termine.debut).getTime() + (termine.duree ?? 0);
    if (maintenant - fin > FENETRE) continue;
    candidats.push({ instance: cle.split("\u0000")[0], job: etat.chemin, build: termine.numero, finiLe: new Date(fin).toISOString() });
  }

  const connus = await db.query<{ instance: string; job: string; build: number; statut: string; cree_le: string }>(
    "SELECT instance, job, build, statut, cree_le FROM jenkins_analyses WHERE cree_le >= datetime('now', '-3 days')",
  );
  const aFaire = candidats.filter((c) => {
    const connu = connus.find((r) => r.instance === c.instance && r.job === c.job && r.build === c.build);
    if (!connu) return true;
    return connu.statut === "en_cours" && maintenant - new Date(`${connu.cree_le.replace(" ", "T")}Z`).getTime() > INTERROMPUE;
  });

  const lot = aFaire.slice(0, PAR_PASSAGE);
  const resultats = await Promise.allSettled(lot.map((c) => analyserBuild(c)));
  let echouees = 0;
  for (const [index, resultat] of resultats.entries()) {
    const { job, build } = lot[index];
    const nom = nomCourt(job);
    if (resultat.status === "fulfilled") {
      await shell.notify({
        title: `Le job ${nom} a échoué`,
        description: resultat.value.cause ?? `Le build ${build} a échoué.`,
        tone: "error",
      });
    } else {
      echouees++;
      await shell.notify({
        title: `Le job ${nom} a échoué`,
        description: `Le build ${build} a échoué, mais je n’ai pas pu analyser son log.`,
        tone: "error",
      });
    }
  }

  return {
    analyses: lot.length - echouees,
    echouees,
    enAttente: aFaire.length - lot.length,
    nonLus: await recompterNonLus(),
  };
}
