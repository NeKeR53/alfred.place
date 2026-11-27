import { useEffect, useState } from "react";

/**
 * Largeur du cadre de la page, en pixels, suivie au redimensionnement. Un tableau à une colonne par environnement s’en
 * sert pour passer à des cases plus courtes quand la fenêtre est étroite (1024 px) : le détail reste au panneau ou au
 * menu de la ligne.
 */
export function useLargeurPage() {
  const [largeur, setLargeur] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const suivre = () => setLargeur(window.innerWidth);
    suivre();
    window.addEventListener("resize", suivre);
    return () => window.removeEventListener("resize", suivre);
  }, []);
  return largeur;
}
