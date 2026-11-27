import { Notice, Row, Stack, Text } from "@alfred/kit";
import { Code, List, ProgressBar, Badge } from "socle-ui";
import { CATEGORIES, CERTITUDES, type Rapport } from "./rapport";

/** Un bloc titré du rapport. */
function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Text weight="strong">{titre}</Text>
      {children}
    </Stack>
  );
}

/** Contenu d’un rapport d’échec : la cause d’abord, puis le déroulé, les pistes et les lignes du log en cause. */
export function RapportEchec({ rapport }: { rapport: Rapport }) {
  if (rapport.statut === "en_cours") return <ProgressBar label="J’analyse le log de ce build : le rapport sera prêt dans quelques secondes." />;
  if (rapport.statut === "erreur")
    return <Notice tone="warning">{`L’analyse du log n’a pas abouti : ${rapport.erreur ?? "raison inconnue"}.`}</Notice>;

  const certitude = CERTITUDES[rapport.certitude ?? ""] ?? CERTITUDES.faible;
  return (
    <Stack gap="lg">
      <Bloc titre="Pourquoi le build a échoué">
        <Text>{rapport.cause}</Text>
        <Row gap="xs">
          <Badge tone={certitude.tone}>{certitude.label}</Badge>
          <Badge tone="neutral">{CATEGORIES[rapport.categorie ?? ""] ?? "Autre"}</Badge>
        </Row>
      </Bloc>
      <Bloc titre="Ce qui s’est passé">
        <Text>{rapport.resume}</Text>
      </Bloc>
      {rapport.pistes.length > 0 ? (
        <Bloc titre="Pistes de correction">
          <List
            label="Pistes de correction"
            selectionMode="none"
            items={rapport.pistes.map((piste, index) => ({ id: String(index), title: piste }))}
          />
        </Bloc>
      ) : null}
      {rapport.lignes.length > 0 ? (
        <Bloc titre="Lignes du log en cause">
          <Code block label="Lignes du log en cause">
            {rapport.lignes.join("\n")}
          </Code>
        </Bloc>
      ) : null}
    </Stack>
  );
}
