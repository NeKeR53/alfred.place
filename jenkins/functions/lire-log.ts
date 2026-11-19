import { cheminJob, erreurJenkins, jenkins } from "../lib/jenkins-api";

const MAXIMUM = 200_000;

export default async function (input: { instance?: string; job: string; build?: number }) {
  if (!input.job) throw new Error("Indiquez le job dont lire le log.");
  const client = jenkins(input.instance);
  const base = `${cheminJob(input.job)}/${input.build ?? "lastBuild"}`;

  const infos = await client.get<{ number: number; building?: boolean; result?: string | null; url?: string }>(
    `${base}/api/json`,
    { tree: "number,building,result,url" },
  );
  if (infos.status === 404) throw new Error("Ce job n’a encore aucun build.");
  if (!infos.ok) throw erreurJenkins(infos.status, "ce build");

  const sortie = await client.request<string>({ path: `${base}/consoleText`, headers: { Accept: "text/plain" } });
  if (!sortie.ok) throw erreurJenkins(sortie.status, "le log de ce build");
  const texte = typeof sortie.body === "string" ? sortie.body : String(sortie.body ?? "");

  const tronque = texte.length > MAXIMUM;
  return {
    numero: infos.body.number,
    enCours: Boolean(infos.body.building),
    resultat: infos.body.result ?? null,
    texte: tronque ? texte.slice(texte.length - MAXIMUM) : texte,
    tronque,
    taille: texte.length,
    url: infos.body.url ?? null,
  };
}
