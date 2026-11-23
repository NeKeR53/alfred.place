import { bitbucketClient, cheminEncode, erreurBitbucket, resoudrePr, liste } from "../lib/bitbucket-api";

interface Ligne { line?: string }
interface Segment { type?: "ADDED" | "REMOVED" | "CONTEXT"; lines?: Ligne[] }
interface Bloc { sourceLine?: number; destinationLine?: number; segments?: Segment[] }
interface Diff { hunks?: Bloc[]; binary?: boolean; truncated?: boolean }

/** Différences d’un fichier dans une pull request Bitbucket, au format unifié (+ ajouté, - retiré). */
export default async function (entree: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  chemin: string;
}) {
  const cible = resoudrePr(entree);
  if (!entree.chemin?.trim()) throw new Error("Précisez le fichier.");
  const reponse = await bitbucketClient(entree.instance).get<{ diffs?: Diff[] }>(
    `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}/diff/${cheminEncode(entree.chemin)}`,
    { contextLines: 3, whitespace: "ignore-all" },
  );
  if (!reponse.ok) erreurBitbucket(reponse);
  const diff = liste<Diff>(reponse.body?.diffs)[0];
  if (!diff) return { texte: "", ajouts: 0, retraits: 0, binaire: false, tronque: false };
  if (diff.binary) return { texte: "", ajouts: 0, retraits: 0, binaire: true, tronque: false };

  let ajouts = 0;
  let retraits = 0;
  const lignes: string[] = [];
  for (const bloc of liste<NonNullable<typeof diff.hunks>[number]>(diff.hunks)) {
    lignes.push(`@@ -${bloc.sourceLine ?? 0} +${bloc.destinationLine ?? 0} @@`);
    for (const segment of liste<NonNullable<typeof bloc.segments>[number]>(bloc.segments)) {
      const prefixe = segment.type === "ADDED" ? "+" : segment.type === "REMOVED" ? "-" : " ";
      for (const ligne of liste<NonNullable<typeof segment.lines>[number]>(segment.lines)) {
        if (prefixe === "+") ajouts += 1;
        if (prefixe === "-") retraits += 1;
        lignes.push(`${prefixe} ${ligne.line ?? ""}`);
      }
    }
  }
  return { texte: lignes.join("\n"), ajouts, retraits, binaire: false, tronque: diff.truncated === true };
}
