import { badge, db, functions, shell } from "@alfred/sdk";

export interface Compte {
  id: string;
  label: string;
}

export interface Element {
  cle: string;
  titre: string;
}

/** Comptes reliés d’un service (Jira, Bitbucket ou Confluence). */
export async function comptes(service: "jira" | "bitbucket" | "confluence"): Promise<Compte[]> {
  const { comptes } = await functions.call<{ comptes: Compte[] }>(`comptes-${service}`);
  return comptes;
}

/**
 * Retient les éléments présents et rend ceux qui ne l’étaient pas au relevé précédent.
 * Le tout premier relevé d’un compte ne rend rien : on ne signale pas ce qui existait déjà.
 */
export async function nouveaux(suivi: string, instance: string, elements: Element[]): Promise<Element[]> {
  const marque = `releve.${suivi}.${instance}`;
  const [deja] = await db.query<{ valeur: string }>("SELECT valeur FROM atlassian_reglages WHERE cle = ?", [marque]);
  const connus = new Set(
    (await db.query<{ cle: string }>("SELECT cle FROM atlassian_vus WHERE service = ? AND instance = ?", [suivi, instance])).map(
      (ligne) => ligne.cle,
    ),
  );
  const presents = new Set(elements.map((element) => element.cle));
  for (const element of elements) {
    if (!connus.has(element.cle)) {
      await db.execute("INSERT OR IGNORE INTO atlassian_vus (service, instance, cle) VALUES (?, ?, ?)", [suivi, instance, element.cle]);
    }
  }
  // Un élément qui sort de la liste pourra être signalé de nouveau s’il y revient.
  for (const cle of connus) {
    if (!presents.has(cle)) {
      await db.execute("DELETE FROM atlassian_vus WHERE service = ? AND instance = ? AND cle = ?", [suivi, instance, cle]);
    }
  }
  await db.execute(
    "INSERT INTO atlassian_reglages (cle, valeur) VALUES (?, datetime('now')) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
    [marque],
  );
  return deja ? elements.filter((element) => !connus.has(element.cle)) : [];
}

/** Une notification pour un élément, une seule pour plusieurs. */
export async function prevenir(
  elements: Element[],
  textes: { un: (element: Element) => string; plusieurs: (nombre: number) => string; detail?: (element: Element) => string },
) {
  if (elements.length === 0) return;
  const premier = elements[0];
  const detail = textes.detail ?? ((element: Element) => element.titre);
  await shell.notify({
    title: elements.length === 1 ? textes.un(premier) : textes.plusieurs(elements.length),
    description:
      elements.length === 1
        ? detail(premier)
        : elements
            .slice(0, 3)
            .map((element) => `${element.cle} : ${element.titre}`)
            .join("\n"),
    tone: "info",
  });
}

/**
 * Relève chaque compte, additionne les compteurs et met à jour la pastille de la page.
 * Un compte en erreur ne bloque pas les autres ; si tous échouent, l’erreur remonte.
 */
export async function releverComptes(
  liste: Compte[],
  page: string,
  relever: (compte: Compte) => Promise<number>,
): Promise<{ total: number; erreurs: string[] }> {
  let total = 0;
  const erreurs: string[] = [];
  for (const compte of liste) {
    try {
      total += await relever(compte);
    } catch (erreur) {
      erreurs.push(`${compte.label} : ${(erreur as Error).message}`);
    }
  }
  if (liste.length > 0 && erreurs.length === liste.length) throw new Error(erreurs.join(" ; "));
  if (erreurs.length === 0) await badge.set(total, { page });
  return { total, erreurs };
}
