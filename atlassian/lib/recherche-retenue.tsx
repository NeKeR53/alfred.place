import { useState } from "react";
import { SearchInput, type SearchTag } from "socle-ui";

export function RechercheRetenue({
  label,
  recherche,
  onChange,
}: {
  label: string;
  recherche: string;
  onChange: (valeur: string) => void;
}) {
  // Le champ ne reçoit sa recherche initiale que sous forme de critère.
  const [tags, setTags] = useState<SearchTag[]>(() =>
    recherche ? [{ id: "recherche", label: recherche }] : [],
  );
  return (
    <SearchInput
      label={label}
      tagMode
      tags={tags}
      onTagsChange={(suivants) => {
        setTags(suivants);
        if (suivants.length === 0 && tags.length > 0) onChange("");
      }}
      onChange={({ text, tags: criteres }) => onChange([...criteres, text].filter(Boolean).join(" "))}
    />
  );
}
