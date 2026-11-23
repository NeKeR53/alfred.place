. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

# Disponibilités d’une personne lues dans l’Outlook classique du poste (comme OneApp) : un caractère par demi-heure à
# partir de minuit du premier jour (0 libre, 1 provisoire, 2 occupé, 3 absent, 4 ailleurs, 5 inconnu), jamais les
# rendez-vous eux-mêmes. Outlook rend au plus 30 jours par appel : la période est lue par tranches de 28 jours.
$entree = Read-Entree
$email = ([string](Get-Valeur $entree "email" "")).Trim()
$debut = ([string](Get-Valeur $entree "debut" "")).Trim()
$jours = [int](Get-Valeur $entree "jours" 120)

if (-not ($email -match "^[\p{L}\p{N}._%+\-']+@[\p{L}\p{N}._%+\-']+$")) { throw "Saisissez l’adresse e-mail Outlook de la personne." }
if (-not ($debut -match "^\d{4}-\d{2}-\d{2}$")) { throw "La date de début des disponibilités est invalide." }
if ($jours -lt 1 -or $jours -gt 180) { throw "La période des disponibilités doit couvrir 1 à 180 jours." }

$outlook = $null
try { $outlook = New-Object -ComObject Outlook.Application } catch {
  throw "Outlook classique n’est pas installé ou ne peut pas être démarré sur ce poste. Le nouvel Outlook ne permet pas cette lecture."
}
$personne = $outlook.GetNamespace("MAPI").CreateRecipient($email)
if (-not $personne.Resolve()) { throw "Outlook ne trouve pas cette adresse dans l’annuaire de l’entreprise." }
$depart = [datetime]::ParseExact($debut, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
$texte = [System.Text.StringBuilder]::new()
try {
  for ($decalage = 0; $decalage -lt $jours; $decalage += 28) {
    $tranche = $personne.FreeBusy($depart.AddDays($decalage), 30, $true)
    $longueur = [Math]::Min([Math]::Min(28, $jours - $decalage) * 48, $tranche.Length)
    [void]$texte.Append($tranche.Substring(0, $longueur))
  }
} catch {
  throw "Outlook n’a pas pu obtenir les disponibilités de cette personne. Vérifiez qu’Outlook est connecté au serveur Exchange."
}
$statuts = ($texte.ToString() -replace "[^0-5]", "")
if ($statuts.Length -eq 0) { throw "Outlook n’a renvoyé aucune disponibilité pour cette personne : son agenda n’est pas partagé dans Exchange ou Outlook travaille hors connexion." }
if ($statuts -match "^5+$") { throw "Outlook n’a aucune disponibilité connue pour cette personne sur la période : son agenda n’est pas publié dans Exchange pour ces dates." }
Write-Sortie @{ email = $email; debut = $debut; jours = $jours; minutesParCreneau = 30; statuts = $statuts }
