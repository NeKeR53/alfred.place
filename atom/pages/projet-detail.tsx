// Panneau de la page Projet : la fiche du ticket ouvert (carte, barre du planning ou ticket à planifier) ou celle
// d’une personne des équipes (ProjectMemberCalendar de OneApp : présence, équipe, jours travaillés, absences).
import { Notice, Stack, Text } from "@alfred/kit";
import { shell, useAsync, usePageContext } from "@alfred/sdk";
import { CalendarOff, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  type Action,
  Drawer,
  type DetailSection,
  DropdownMenu,
  type FormValues,
  HtmlContent,
  List,
  useOpenForm,
} from "socle-ui";
import type { MessageProjet, SelectionProjet } from "../lib/projet";
import { addProjectDays, isProjectDay, memberDayStatus, type ProjectMember, projectToday, toggleProjectAbsenceDay } from "../lib/planning";
import { functions } from "../lib/source";
import { MonthCalendar, type MonthDayState } from "../lib/vues/calendrier";

const monthLabel = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const fullDateLabel = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const send = (message: MessageProjet) => void shell.send(message);
const texte = (values: FormValues, nom: string) => String(values[nom] ?? "").trim();
/** Vérifie une date saisie « AAAA-MM-JJ ». */
const dateValide = (valeur: string) => (isProjectDay(valeur.trim()) ? undefined : "Saisissez une date au format AAAA-MM-JJ.");

export default function ProjetDetail() {
  const selection = usePageContext()?.selection as SelectionProjet | null | undefined;
  if (!selection) return <Drawer emptyMessage="Ouvrez un ticket ou une personne de la page Projet." />;
  return selection.kind === "member" ? (
    <Personne key={selection.member.id} selection={selection} />
  ) : (
    <Ticket key={selection.source.key} selection={selection} />
  );
}

// ------------------------------------------------------------------------------------------------ Ticket
type Fiche = {
  description?: string;
  descriptionHtml?: string;
  rapporteur?: string;
  commentaires?: { id: string; auteur?: string; quand?: string | null; texte?: string; corps?: string }[];
  transitions?: { id: string; nom: string; vers: string }[];
};
function Ticket({ selection }: { selection: Extract<SelectionProjet, { kind: "ticket" }> }) {
  const { source, ticket, productName, assignee } = selection;
  const t = source.ticket;
  const openForm = useOpenForm();
  const fiche = useAsync(
    () =>
      functions
        .call<{ ticket: Fiche | null }>("atlassian/lire-ticket", { cle: t.id, ...(t.instance ? { instance: t.instance } : {}) })
        .then((reponse) => reponse.ticket),
    [t.id, t.instance],
  );
  const parJour = source.workdaySeconds ?? 28800;
  const duree = (secondes?: number) =>
    secondes === undefined ? "" : `${String(Math.round((secondes / parJour) * 10) / 10).replace(".", ",")} j`;
  const actions: Action[] = [
    {
      id: "jira",
      label: "Ouvrir dans Jira",
      icon: <ExternalLink size={16} />,
      isHidden: !t.url,
      onPress: () => shell.openExternal(t.url as string),
    },
    {
      id: "commenter",
      label: "Commenter",
      icon: <MessageSquarePlus size={16} />,
      onPress: () =>
        openForm({
          title: `Commenter ${t.id}`,
          fields: [{ name: "texte", label: "Commentaire", type: "textarea", isRequired: true }],
          submitLabel: "Ajouter",
          onSubmit: async (values) => {
            await functions.call("atlassian/commenter-ticket", {
              cle: t.id,
              texte: texte(values, "texte"),
              ...(t.instance ? { instance: t.instance } : {}),
            });
            void shell.notify({ title: "Commentaire ajouté", tone: "success" });
            fiche.reload();
          },
        }),
    },
    ...(fiche.data?.transitions ?? []).map(
      (transition): Action => ({
        id: `transition-${transition.id}`,
        label: transition.vers ? `${transition.nom} (vers ${transition.vers})` : transition.nom,
        onPress: async () => {
          await functions.call("atlassian/transitionner-ticket", {
            cle: t.id,
            transition: transition.id,
            ...(t.instance ? { instance: t.instance } : {}),
          });
          void shell.notify({ title: `${t.id} : ${transition.nom}`, tone: "success" });
          send({ kind: "changed" });
          fiche.reload();
        },
      }),
    ),
  ];
  const commentaires = fiche.data?.commentaires ?? [];
  const indisponible = source.timeTrackingUnavailable ? "Suivi du temps indisponible" : undefined;
  const sections: DetailSection[] = [
    {
      id: "ticket",
      title: "Ticket",
      fields: [
        { label: "Statut", value: t.status },
        { label: "Type", value: t.type },
        { label: "Priorité", value: t.priority },
        { label: "Responsable", value: assignee ?? (t.assigneeId ? t.assignee : "Sans responsable") },
        { label: "Estimation", value: indisponible ?? duree(t.estimateSeconds) },
        { label: "Reste à faire", value: indisponible ?? duree(t.remainingSeconds) },
        { label: "Projet", value: productName },
        { label: "Échéance", value: t.dueDate ?? "", type: "date" },
        { label: "Au tableau", value: ticket ? "Oui" : "Non : ticket disponible" },
      ],
      content: fiche.error ? <Notice tone="warning">{`La fiche Jira n’a pas pu être lue : ${fiche.error.message}`}</Notice> : undefined,
    },
    {
      id: "description",
      title: "Description",
      content: fiche.data?.descriptionHtml ? (
        <HtmlContent html={fiche.data.descriptionHtml} label={`Description de ${t.id}`} surface="theme" />
      ) : (
        <Text tone="muted">{fiche.data ? fiche.data.description || "Aucune description." : "Lecture de la fiche…"}</Text>
      ),
    },
    {
      id: "commentaires",
      title: "Commentaires",
      summary: String(commentaires.length),
      empty: "Aucun commentaire.",
      content: commentaires.length ? (
        <Stack gap="sm">
          {commentaires.map((commentaire) => (
            <Stack key={commentaire.id} gap="xs">
              <Text size="meta" tone="muted" as="span">
                {`${commentaire.auteur ?? "Quelqu’un"}${commentaire.quand ? ` · ${new Date(commentaire.quand).toLocaleString("fr-FR")}` : ""}`}
              </Text>
              <Text>{commentaire.texte ?? commentaire.corps ?? ""}</Text>
            </Stack>
          ))}
        </Stack>
      ) : undefined,
    },
  ];
  return (
    <Drawer
      header={{ title: `${t.id} · ${t.title}`, subtitle: productName, ...(t.status ? { status: { label: t.status } } : {}), actions }}
      sections={sections}
      isLoading={fiche.loading && !fiche.data}
    />
  );
}

// ------------------------------------------------------------------------------------------------ Personne
const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const JOURS_COMPLETS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
/** Lundi d’abord, dimanche en dernier. */
const ORDRE_JOURS = [1, 2, 3, 4, 5, 6, 0];

function Personne({ selection }: { selection: Extract<SelectionProjet, { kind: "member" }> }) {
  const { member, teams, saving } = selection;
  const openForm = useOpenForm();
  const save = (patch: Partial<ProjectMember>) => send({ kind: "member-patch", id: member.id, patch });
  const [month, setMonth] = useState(() => `${projectToday().slice(0, 7)}-01`);
  const email = member.outlookEmail?.trim();
  const equipe = teams.find((item) => item.id === member.teamId)?.name ?? "";

  const stateOf = (date: string): MonthDayState => {
    const status = memberDayStatus(member, date);
    return status === "absence" ? "marked" : status === "non-working" ? "non-working" : status === "outside-presence" ? "outside" : "available";
  };

  const modifierPresence = () =>
    openForm({
      title: `Présence de ${member.name}`,
      fields: [
        { name: "from", label: "Présence à partir du", placeholder: "AAAA-MM-JJ", isRequired: true, validate: dateValide },
        {
          name: "to",
          label: "Jusqu’au",
          placeholder: "AAAA-MM-JJ",
          validate: (valeur, values) => {
            const fin = valeur.trim();
            if (!fin) return undefined;
            if (!isProjectDay(fin)) return "Saisissez une date au format AAAA-MM-JJ.";
            return fin < texte(values, "from") ? "La fin de présence doit être postérieure ou égale au début." : undefined;
          },
        },
        { name: "teamId", label: "Équipe", type: "select", isRequired: true, options: teams.map((item) => ({ id: item.id, label: item.name })) },
      ],
      initialValues: { from: member.from, to: member.to ?? "", teamId: member.teamId },
      submitLabel: "Enregistrer",
      onSubmit: (values) => {
        const fin = texte(values, "to");
        save({ from: texte(values, "from"), to: fin || undefined, teamId: texte(values, "teamId") });
      },
    });

  const ajouterAbsence = () =>
    openForm({
      title: `Absence de ${member.name}`,
      fields: [
        { name: "from", label: "Absent du", placeholder: "AAAA-MM-JJ", isRequired: true, validate: dateValide },
        {
          name: "to",
          label: "Au",
          placeholder: "AAAA-MM-JJ",
          isRequired: true,
          validate: (valeur, values) => {
            const fin = valeur.trim();
            if (!isProjectDay(fin)) return "Saisissez une date au format AAAA-MM-JJ.";
            if (fin < texte(values, "from")) return "La fin de l’absence doit être postérieure ou égale au début.";
            if (member.absences.some((absence) => absence.from === texte(values, "from") && absence.to === fin))
              return "Cette absence est déjà déclarée.";
            return undefined;
          },
        },
      ],
      submitLabel: "Ajouter l’absence",
      onSubmit: (values) => save({ absences: [...member.absences, { from: texte(values, "from"), to: texte(values, "to") }] }),
    });

  const sections: DetailSection[] = [
    {
      id: "presence",
      title: "Présence",
      actions: [{ id: "modifier", label: "Modifier la présence", icon: <Pencil size={16} />, isDisabled: saving, onPress: () => modifierPresence() }],
      fields: [
        { label: "À partir du", value: member.from, type: "date" },
        { label: "Jusqu’au", value: member.to ?? "", type: "date" },
        { label: "Équipe", value: equipe },
        { label: "Identifiant", value: member.keycloakUsername ?? "Non renseigné" },
        { label: "E-mail", value: member.outlookEmail ?? "Non renseigné" },
      ],
    },
    {
      id: "jours",
      title: "Jours travaillés",
      // Les jours se lisent en texte ; ils se cochent dans le menu de la ligne, enregistrés à chaque choix.
      fields: [
        {
          id: "jours",
          label: "Jours",
          value: ORDRE_JOURS.filter((day) => member.weekdays.includes(day)).map((day) => JOURS[day]).join(", "),
          action: {
            type: "icon",
            icon: <ChevronDown size={16} />,
            label: "Changer les jours travaillés",
            menu: (
              <DropdownMenu.Section
                title="Jours travaillés"
                selectionMode="multiple"
                selectedKeys={member.weekdays.map(String)}
                onSelectionChange={(cles) => {
                  const weekdays = [...cles].map(Number).sort((a, b) => a - b);
                  if (!weekdays.length) {
                    void shell.notify({ title: "Gardez au moins un jour travaillé", tone: "info" });
                    return;
                  }
                  save({ weekdays });
                }}
              >
                {ORDRE_JOURS.map((day) => (
                  <DropdownMenu.Item key={day} id={String(day)} label={JOURS_COMPLETS[day]} isDisabled={saving} />
                ))}
              </DropdownMenu.Section>
            ),
          },
        },
      ],
    },
    {
      id: "absences",
      title: `Absences · ${monthLabel(month)}`,
      actions: [
        {
          id: "precedent",
          label: "Mois précédent",
          icon: <ChevronLeft size={16} />,
          onPress: () => setMonth(`${addProjectDays(month, -1).slice(0, 7)}-01`),
        },
        {
          id: "suivant",
          label: "Mois suivant",
          icon: <ChevronRight size={16} />,
          onPress: () => setMonth(`${addProjectDays(month, 32).slice(0, 7)}-01`),
        },
        { id: "ajouter", label: "Ajouter une absence", icon: <CalendarPlus size={16} />, isDisabled: saving, onPress: () => ajouterAbsence() },
        {
          id: "importer",
          label: "Importer les absences",
          icon: <Download size={16} />,
          isDisabled: !email || saving,
          onPress: () => send({ kind: "member-import", id: member.id }),
        },
      ],
      content: (
        <Stack gap="sm">
          <Text tone="muted" size="meta">
            {email
              ? "Cliquez un jour pour le basculer. L’import lit les disponibilités dans l’Outlook de ce poste avec l’e-mail Keycloak : les jours « Absent » sur plus de la moitié des heures de travail deviennent des absences."
              : "Cliquez un jour pour le basculer. Aucun e-mail Keycloak pour cette personne : ajoutez-la depuis Keycloak pour importer ses absences."}
          </Text>
          <MonthCalendar
            legend={`Absences de ${member.name} en ${monthLabel(month)}`}
            month={month}
            state={stateOf}
            disabled={saving}
            dayLabel={(date, state) =>
              `${fullDateLabel(date)} : ${state === "marked" ? "absent" : state === "non-working" ? "jour non travaillé" : state === "outside" ? "hors période de présence" : "présent"}`
            }
            onToggle={(date) => save({ absences: toggleProjectAbsenceDay(member.absences, date) })}
          />
          {member.absences.length ? (
            <List
              label={`Absences déclarées de ${member.name}`}
              selectionMode="none"
              leading="icon"
              items={member.absences.map((absence) => ({
                id: `${absence.from}|${absence.to}`,
                title: `${dateLabel(absence.from)} → ${dateLabel(absence.to)}`,
                visual: <CalendarOff size={16} />,
              }))}
              itemActions={(item) => [
                {
                  icon: <Trash2 size={16} />,
                  label: `Retirer l’absence du ${item.id.replace("|", " au ")}`,
                  onPress: () => save({ absences: member.absences.filter((absence) => `${absence.from}|${absence.to}` !== item.id) }),
                },
              ]}
            />
          ) : (
            <Text tone="muted">Aucune absence déclarée.</Text>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Drawer
      header={{
        title: member.name,
        subtitle: "Comptes et disponibilités",
        actions: [
          {
            id: "supprimer",
            label: "Supprimer cette personne",
            danger: true,
            isDisabled: saving,
            confirm: {
              title: `Supprimer ${member.name} du projet ?`,
              message:
                "Ses absences et son affectation aux équipes du projet sont supprimées. Les tickets conservent leur affectation chez le fournisseur.",
              confirmLabel: "Supprimer",
            },
            onPress: () => send({ kind: "member-remove", id: member.id }),
          },
        ],
      }}
      sections={sections}
    />
  );
}
