import { client } from "@alfred/sdk";

/**
 * Vrai quand le service n’a encore aucun compte relié : les fonctions de
 * lecture rendent alors une réponse vide, et les pages proposent de le configurer.
 */
export async function aucunCompte(service: "jira" | "bitbucket" | "confluence"): Promise<boolean> {
  try {
    const comptes = await client(service).instances();
    return comptes.length === 0;
  } catch {
    return true;
  }
}
