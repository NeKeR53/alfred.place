import { functions } from "@alfred/sdk";
import { comptes, nouveaux, prevenir } from "../lib/releve";

interface Ticket {
  cle: string;
  titre: string;
  type?: string;
  priorite?: string;
  misAJour?: string | null;
}

/** Juge la criticité des tickets ouverts et prévient quand un ticket devient critique. */
export default async function ({ notifier = true }: { notifier?: boolean }) {
  let critiques = 0;
  let arrives = 0;
  for (const compte of await comptes("jira")) {
    const { tickets } = await functions.call<{ tickets: Ticket[] }>("lister-tickets", {
      instance: compte.id,
      vue: "ouverts",
      tri: "maj",
      debut: 0,
      limite: 50,
    });
    const { resultats } = await functions.call<{ resultats: Array<{ cle: string; niveau: string; aVerifier: boolean }> }>(
      "evaluer-criticite",
      { instance: compte.id, tickets },
    );
    const lesCritiques = tickets.filter((t) => resultats.some((r) => r.cle === t.cle && r.niveau === "critique"));
    critiques += lesCritiques.length;
    const recus = await nouveaux("jira-critiques", compte.id, lesCritiques);
    arrives += recus.length;
    if (notifier) {
      await prevenir(recus, {
        un: (t) => `Ticket critique : ${t.cle}`,
        plusieurs: (n) => `${n} tickets sont devenus critiques`,
      });
    }
  }
  return { critiques, nouveaux: arrives };
}
