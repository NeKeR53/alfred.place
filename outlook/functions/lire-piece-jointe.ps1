. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$messageId = [string](Get-Valeur $entree "message" "")
$pieceId = [string](Get-Valeur $entree "piece" "")

if ([string]::IsNullOrWhiteSpace($messageId) -or [string]::IsNullOrWhiteSpace($pieceId)) {
  Write-Sortie @{ piece = $null }
  exit 0
}

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $messageId
  if ($null -eq $mail) {
    Write-Sortie @{ piece = $null }
    exit 0
  }

  [int]$index = 0
  if (-not [int]::TryParse($pieceId, [ref]$index)) {
    Write-Sortie @{ piece = $null }
    exit 0
  }
  if ($index -lt 1 -or $index -gt [int]$mail.Attachments.Count) {
    Write-Sortie @{ piece = $null }
    exit 0
  }

  $piece = $mail.Attachments.Item($index)
  $type = "application/octet-stream"
  try { $type = [string]$piece.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x370E001E") } catch {}
  if ([string]::IsNullOrWhiteSpace($type)) { $type = "application/octet-stream" }

  $nom = ""
  try { $nom = [string]$piece.FileName } catch {}
  if ([string]::IsNullOrWhiteSpace($nom)) { $nom = "Pièce jointe" }

  $taille = 0
  try { $taille = [int]$piece.Size } catch {}

  $dataUrl = $null
  if ($taille -le 10MB) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
      $piece.SaveAsFile($tmp)
      $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($tmp))
      $dataUrl = "data:$type;base64,$base64"
    } catch {
      $dataUrl = $null
    } finally {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Sortie @{
    piece = [pscustomobject]@{
      id = [string]$index
      nom = $nom
      type = $type
      taille = $taille
      dataUrl = $dataUrl
    }
  }
} catch {
  Write-Sortie @{ piece = $null }
}
