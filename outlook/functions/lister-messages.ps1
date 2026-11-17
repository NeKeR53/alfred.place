. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree

try {
  $outlook = Get-Outlook
  $session = $outlook.Session

  $instance = Get-Valeur $entree "instance" ""
  $dossierId = Get-Valeur $entree "dossier" ""
  $dossier = Get-Dossier $session $instance $dossierId

  $nonLus = [bool](Get-Valeur $entree "nonLus" $false)
  $expediteur = [string](Get-Valeur $entree "expediteur" "")
  $recherche = [string](Get-Valeur $entree "recherche" "")
  $debut = [Math]::Max(0, [int](Get-Valeur $entree "debut" 0))
  $limite = [Math]::Min(100, [Math]::Max(1, [int](Get-Valeur $entree "limite" 40)))

  # Recherche : chaque mot doit apparaître (objet, corps, nom ou adresse), sans tenir compte des accents.
  # « de:lea » limite à un expéditeur dont le nom ou l’adresse contient « lea ».
  $mots = @()
  $expediteurContient = ""
  foreach ($morceau in ($recherche.Trim() -split "\s+")) {
    if ([string]::IsNullOrWhiteSpace($morceau)) { continue }
    if ($morceau -match "^de:(.+)$") { $expediteurContient = Sans-Accents $Matches[1]; continue }
    $mots += $morceau
  }
  $motsNormalises = @($mots | ForEach-Object { Sans-Accents $_ })
  $adresseCherchee = $expediteur.Trim().ToLowerInvariant()

  $tous = $dossier.Items
  $items = $tous
  if ($nonLus) {
    try { $items = $items.Restrict("[UnRead] = True") } catch {}
  }
  if ($mots.Count -gt 0) {
    try {
      $indexes = $items.Restrict((Filtre-Index $mots))
      if ($indexes.Count -gt 0) { $items = $indexes }
    } catch {}
  }
  $items.Sort("[ReceivedTime]", $true)

  $messages = @()
  $position = 0
  $element = $items.GetFirst()

  while ($null -ne $element) {
    if ([int]$element.Class -eq 43) {
      $garde = $true
      if ($nonLus -and -not [bool]$element.UnRead) { $garde = $false }

      if ($garde -and $adresseCherchee) {
        $adresse = (Get-AdresseExpediteur $element).ToLowerInvariant()
        if ($adresse -ne $adresseCherchee) { $garde = $false }
      }

      if ($garde -and $expediteurContient) {
        $qui = Sans-Accents ("$($element.SenderName) " + (Get-AdresseExpediteur $element))
        if (-not $qui.Contains($expediteurContient)) { $garde = $false }
      }

      if ($garde -and $motsNormalises.Count -gt 0) {
        $texte = ""
        try { $texte = Sans-Accents ("$($element.Subject) $($element.SenderName) $($element.SenderEmailAddress) $($element.Body)") } catch {}
        foreach ($m in $motsNormalises) {
          if (-not $texte.Contains($m)) { $garde = $false; break }
        }
      }

      if ($garde) {
        if ($position -ge $debut) {
          if ($messages.Count -ge ($limite + 1)) { break }
          $messages += Convertir-Message $element
        }
        $position++
      }
    }
    $element = $items.GetNext()
  }

  $suivant = $messages.Count -gt $limite
  if ($suivant) { $messages = @($messages[0..($limite - 1)]) }

  Write-Sortie @{ messages = @($messages); suivant = $suivant }
} catch {
  Write-Sortie @{ messages = @(); suivant = $false }
}
