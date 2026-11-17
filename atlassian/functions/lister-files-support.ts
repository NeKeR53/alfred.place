import { aucunCompte } from "../lib/comptes-api";
import { filesDuService, premierService } from "../lib/support-api";

/** Files d’attente d’un centre de services, avec le nombre de demandes de chacune. */
export default async function ({ instance, service }: { instance?: string; service?: string }) {
  if (await aucunCompte("jira")) return { service: null, files: [] };
  const centre = service || (await premierService(instance));
  if (!centre) return { service: null, files: [] };
  const files = await filesDuService(centre, instance);
  return {
    service: centre,
    files: files.map((file) => ({
      id: String(file.id),
      nom: file.name ?? `File ${file.id}`,
      nombre: typeof file.issueCount === "number" ? file.issueCount : null,
    })),
  };
}
