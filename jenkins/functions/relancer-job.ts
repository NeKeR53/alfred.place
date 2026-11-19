import { cheminJob, enTeteCrumb, erreurJenkins, jenkins } from "../lib/jenkins-api";

interface JobParametres {
  property?: { parameterDefinitions?: { name: string; defaultParameterValue?: { value?: unknown } }[] }[];
  lastBuild?: { actions?: { parameters?: { name: string; value?: unknown }[] }[] } | null;
}

export default async function (input: { instance?: string; job: string }) {
  if (!input.job) throw new Error("Indiquez le job à relancer.");
  const client = jenkins(input.instance);
  const chemin = cheminJob(input.job);

  const lecture = await client.get<JobParametres>(`${chemin}/api/json`, {
    tree: "property[parameterDefinitions[name,defaultParameterValue[value]]],lastBuild[actions[parameters[name,value]]]",
  });
  if (!lecture.ok) throw erreurJenkins(lecture.status, "ce job");

  const definitions = (lecture.body.property ?? []).flatMap((p) => p.parameterDefinitions ?? []);
  const precedents = (lecture.body.lastBuild?.actions ?? []).flatMap((a) => a.parameters ?? []);

  // Les paramètres du dernier build, sinon les valeurs par défaut.
  const parametres: Record<string, string> = {};
  for (const definition of definitions) {
    const precedent = precedents.find((p) => p.name === definition.name);
    const valeur = precedent?.value ?? definition.defaultParameterValue?.value;
    if (valeur !== undefined && valeur !== null && typeof valeur !== "object") parametres[definition.name] = String(valeur);
  }

  const crumb = await enTeteCrumb(input.instance);
  const reponse = await client.request({
    method: "POST",
    path: definitions.length > 0 ? `${chemin}/buildWithParameters` : `${chemin}/build`,
    query: definitions.length > 0 ? parametres : undefined,
    headers: crumb,
  });
  if (!reponse.ok) throw erreurJenkins(reponse.status, "la relance de ce job");

  return {
    lance: true,
    parametres: Object.keys(parametres).length,
    file: reponse.headers.location ?? reponse.headers.Location ?? null,
  };
}
