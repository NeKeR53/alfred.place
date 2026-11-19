import { client } from "@alfred/sdk";

export default async function () {
  try {
    const comptes = await client("prefect").instances();
    return { comptes: comptes.map((compte) => ({ id: compte.id, label: compte.label, default: compte.default })) };
  } catch {
    // Aucun compte relié : la page propose de configurer le module.
    return { comptes: [] };
  }
}
