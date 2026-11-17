$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$WarningPreference = "SilentlyContinue"

$script:DossierModule = Split-Path -Parent $PSScriptRoot

function Read-Entree {
  $brut = [Console]::In.ReadToEnd()
  $entree = [pscustomobject]@{}
  if (-not [string]::IsNullOrWhiteSpace($brut)) {
    try { $entree = ($brut | ConvertFrom-Json) } catch {}
  }
  # Mode « données d’exemple » : la fonction rend l’exemple déclaré dans module.json, sans toucher à Outlook.
  if ($env:ALFRED_EXAMPLES -eq "1") { Repondre-Exemple $entree ([IO.Path]::GetFileNameWithoutExtension($MyInvocation.PSCommandPath)) }
  return $entree
}

# Rend l’exemple dont l’entrée est identique à l’appel, sinon celui qui partage le plus de champs fournis, sinon le premier.
function Repondre-Exemple($entree, [string]$fonction) {
  $manifeste = Get-Content -Raw -Encoding UTF8 (Join-Path $script:DossierModule "module.json") | ConvertFrom-Json
  $declaree = @($manifeste.functions | Where-Object { $_.id -eq $fonction }) | Select-Object -First 1
  $exemples = @()
  if ($declaree -and $declaree.PSObject.Properties["examples"]) { $exemples = @($declaree.examples) }
  if ($exemples.Count -eq 0) { throw "Cette fonction n’a pas encore de données d’exemple." }

  $appel = $entree | ConvertTo-Json -Depth 30 -Compress
  $choisi = $exemples[0]
  $meilleur = -1
  foreach ($exemple in $exemples) {
    $attendu = $exemple.input
    if (($attendu | ConvertTo-Json -Depth 30 -Compress) -eq $appel) { $choisi = $exemple; break }
    $score = 0
    foreach ($champ in $entree.PSObject.Properties) {
      $valeur = $attendu.PSObject.Properties[$champ.Name]
      if ($null -ne $valeur -and (($valeur.Value | ConvertTo-Json -Depth 30 -Compress) -eq ($champ.Value | ConvertTo-Json -Depth 30 -Compress))) { $score++ }
    }
    if ($score -gt $meilleur) { $meilleur = $score; $choisi = $exemple }
  }
  Write-Sortie $choisi.output
  exit 0
}

function Write-Sortie($objet) {
  $json = $objet | ConvertTo-Json -Depth 30 -Compress
  [Console]::Out.Write($json)
}

function Get-Valeur($objet, [string]$nom, $defaut = $null) {
  if ($null -eq $objet) { return $defaut }
  $propriete = $objet.PSObject.Properties[$nom]
  if ($null -eq $propriete -or $null -eq $propriete.Value) { return $defaut }
  return $propriete.Value
}

function Html-Texte([string]$texte) {
  if ([string]::IsNullOrEmpty($texte)) { return "" }
  return ([System.Net.WebUtility]::HtmlEncode($texte) -replace "`r?`n", "<br>")
}

function Get-Outlook {
  try {
    return New-Object -ComObject Outlook.Application
  } catch {
    throw "Microsoft Outlook n’est pas disponible sur cet ordinateur. Installez Outlook pour Windows, puis rouvrez Alfred."
  }
}

function Get-Compte($session, $instance) {
  $comptes = @($session.Accounts)
  if ($comptes.Count -eq 0) { return $null }
  if (-not [string]::IsNullOrWhiteSpace($instance)) {
    foreach ($compte in $comptes) {
      try {
        if ($compte.SmtpAddress -eq $instance -or $compte.UserName -eq $instance -or $compte.DisplayName -eq $instance) {
          return $compte
        }
      } catch {}
    }
  }
  foreach ($compte in $comptes) {
    try { if ($compte.DeliveryStore) { return $compte } } catch {}
  }
  return $comptes[0]
}

function Get-Store($session, $instance) {
  $compte = Get-Compte $session $instance
  if ($compte) {
    try { if ($compte.DeliveryStore) { return $compte.DeliveryStore } } catch {}
  }
  return $session.DefaultStore
}

function Get-DossierId($dossier) {
  if ($null -eq $dossier) { return "" }
  try { return "$($dossier.StoreID)|$($dossier.EntryID)" } catch { return "" }
}

function Get-DossierDepuisId($session, [string]$id) {
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  $morceaux = $id.Split("|", 2)
  if ($morceaux.Count -ne 2) { return $null }
  try { return $session.GetFolderFromID($morceaux[1], $morceaux[0]) } catch { return $null }
}

function Get-Boite($session, $instance) {
  $store = Get-Store $session $instance
  try { return $store.GetDefaultFolder(6) } catch { return $session.GetDefaultFolder(6) }
}

function Get-Dossier($session, $instance, [string]$id) {
  if (-not [string]::IsNullOrWhiteSpace($id)) {
    $trouve = Get-DossierDepuisId $session $id
    if ($trouve) { return $trouve }
  }
  return Get-Boite $session $instance
}

function Get-Mail($session, [string]$id) {
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  $morceaux = $id.Split("|", 2)
  if ($morceaux.Count -ne 2) { return $null }
  try {
    $element = $session.GetItemFromID($morceaux[1], $morceaux[0])
    if ($element.Class -ne 43) { return $null }
    return $element
  } catch {
    return $null
  }
}

function Get-AdresseExpediteur($mail) {
  $adresse = ""
  try { $adresse = [string]$mail.SenderEmailAddress } catch {}
  try {
    if ($mail.SenderEmailType -eq "EX") {
      $adresse = [string]$mail.Sender.GetExchangeUser().PrimarySmtpAddress
    }
  } catch {}
  return $adresse
}

function Convertir-Message($mail) {
  $adresse = Get-AdresseExpediteur $mail
  $destinataires = @()
  try {
    if ($mail.To) {
      $destinataires = @($mail.To -split ";" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
  } catch {}

  $recu = $null
  try {
    $date = $mail.ReceivedTime
    if ($date.Year -lt 1900) { $date = $mail.CreationTime }
    $recu = $date.ToString("o")
  } catch {
    try { $recu = $mail.CreationTime.ToString("o") } catch {}
  }

  $extrait = ""
  try {
    $extrait = ([string]$mail.Body -replace "\s+", " ").Trim()
    if ($extrait.Length -gt 180) { $extrait = $extrait.Substring(0, 180) + "…" }
  } catch {}

  $objet = ""
  try { $objet = [string]$mail.Subject } catch {}
  if ([string]::IsNullOrWhiteSpace($objet)) { $objet = "(sans objet)" }

  $expediteur = ""
  try { $expediteur = [string]$mail.SenderName } catch {}
  if ([string]::IsNullOrWhiteSpace($expediteur)) { $expediteur = "Expéditeur inconnu" }

  $brouillon = $false
  try { $brouillon = (-not [bool]$mail.Sent) } catch {}

  $pieces = $false
  try { $pieces = ([int]$mail.Attachments.Count -gt 0) } catch {}

  $important = $false
  try { $important = ([int]$mail.Importance -eq 2) } catch {}

  return [pscustomobject]@{
    id = (Get-MailId $mail)
    objet = $objet
    expediteur = $expediteur
    expediteurAdresse = $adresse
    destinataires = @($destinataires)
    recu = $recu
    lu = (-not [bool]$mail.UnRead)
    brouillon = $brouillon
    pieces = $pieces
    extrait = $extrait
    important = $important
    dossier = (Get-DossierId $mail.Parent)
    url = $null
  }
}

function Get-MailId($mail) {
  try { return "$($mail.Parent.StoreID)|$($mail.EntryID)" } catch { return "" }
}

function Get-Dossiers($dossier, [int]$profondeur) {
  $resultat = @()
  if ($null -eq $dossier) { return $resultat }

  $nom = ""
  try { $nom = [string]$dossier.Name } catch {}
  if ([string]::IsNullOrWhiteSpace($nom)) { $nom = "Dossier sans nom" }

  $nonLus = 0
  $total = 0
  try { $nonLus = [int]$dossier.UnReadItemCount } catch {}
  try { $total = [int]$dossier.Items.Count } catch {}

  $parent = ""
  try { $parent = Get-DossierId $dossier.Parent } catch {}

  $resultat += [pscustomobject]@{
    id = (Get-DossierId $dossier)
    nom = $nom
    parent = $parent
    profondeur = $profondeur
    nonLus = $nonLus
    total = $total
  }

  if ($profondeur -lt 3) {
    try {
      foreach ($enfant in @($dossier.Folders)) {
        $resultat += Get-Dossiers $enfant ($profondeur + 1)
      }
    } catch {}
  }
  return $resultat
}

function Adresses-Texte([string]$texte) {
  if ([string]::IsNullOrWhiteSpace($texte)) { return @() }
  return @($texte -split "[,;]" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Sans-Accents([string]$texte) {
  if ([string]::IsNullOrEmpty($texte)) { return "" }
  $decompose = $texte.Normalize([Text.NormalizationForm]::FormD)
  $sortie = New-Object System.Text.StringBuilder
  foreach ($caractere in $decompose.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($caractere) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sortie.Append($caractere)
    }
  }
  return $sortie.ToString().ToLowerInvariant()
}

# Filtre DASL qui s’appuie sur l’index de recherche Windows : rapide, même sur une grosse boîte.
function Filtre-Index([string[]]$mots) {
  $parties = @()
  foreach ($mot in $mots) {
    $propre = $mot.Replace("'", "''")
    $parties += "(""urn:schemas:httpmail:subject"" ci_phrasematch '$propre' OR ""urn:schemas:httpmail:textdescription"" ci_phrasematch '$propre' OR ""urn:schemas:httpmail:fromname"" ci_phrasematch '$propre')"
  }
  return "@SQL=" + ($parties -join " AND ")
}
