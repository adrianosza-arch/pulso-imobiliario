#Requires -Version 7
<#
  Importa a planilha "Indices CUB INCC IPCA.xlsx" (aba "Índices") para data/manual/planilha-indices.json.
  Lê o XML interno do .xlsx (não precisa de Excel). Usa os valores das tabelas:
    TB_CUB9    (B:H)  CUB/SC residencial médio e comercial médio (R$/m²)
    Tabela38   (J:M)  INCC-M — índice do mês (%)
    Tabela610  (O:R)  IPCA — índice do mês (%)
  Uso: pwsh -File scripts/importar-planilha.ps1 -Caminho "C:\...\Indices CUB INCC IPCA.xlsx"
#>
param([Parameter(Mandatory)][string]$Caminho)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$Root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("pulso-xlsx-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
try {
  Copy-Item -LiteralPath $Caminho (Join-Path $tmp 'p.zip')
  Expand-Archive (Join-Path $tmp 'p.zip') -DestinationPath (Join-Path $tmp 'x')
  $x = Join-Path $tmp 'x'
  [xml]$wb = Get-Content (Join-Path $x 'xl/workbook.xml') -Raw
  [xml]$rels = Get-Content (Join-Path $x 'xl/_rels/workbook.xml.rels') -Raw
  $sheet = $wb.workbook.sheets.sheet | Where-Object name -eq 'Índices'
  if (-not $sheet) { throw 'Aba "Índices" não encontrada na planilha.' }
  $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = ($rels.Relationships.Relationship | Where-Object Id -eq $rid).Target
  [xml]$ws = Get-Content (Join-Path $x ("xl/" + $target.TrimStart('/').Replace('xl/', ''))) -Raw
  $ss = @(); $ssPath = Join-Path $x 'xl/sharedStrings.xml'
  if (Test-Path $ssPath) { $ss = @(([xml](Get-Content $ssPath -Raw)).sst.si | ForEach-Object { $_.InnerText }) }
  $cells = @{}
  foreach ($r in $ws.worksheet.sheetData.row) { foreach ($c in $r.c) {
    $v = $c.v; if ($null -eq $v) { continue }
    if ($c.t -eq 's') { $v = $ss[[int]$v] }
    $cells[$c.r] = [string]$v } }

  function Month([string]$serial) { [DateTime]::new(1899, 12, 30).AddDays([double]::Parse($serial, $inv)).ToString('yyyy-MM', $inv) }
  function Read-Col([string]$dateCol, [string]$valCol, [int]$from, [int]$to, [double]$mult) {
    $out = [ordered]@{}
    for ($i = $from; $i -le $to; $i++) {
      $d = $cells["$dateCol$i"]; $v = $cells["$valCol$i"]
      if (-not $d -or -not $v) { continue }
      $n = 0.0; if (-not [double]::TryParse($v, [Globalization.NumberStyles]::Float, $inv, [ref]$n)) { continue }
      $out[(Month $d)] = [Math]::Round($n * $mult, 6)
    }
    $out.GetEnumerator() | Sort-Object Name | ForEach-Object { [pscustomobject]@{ d = $_.Name; v = $_.Value } }
  }
  # Linha 9 = cabeçalho; dados a partir da linha 10 até a última linha preenchida.
  $last = ($cells.Keys | ForEach-Object { [int]($_ -replace '^[A-Z]+', '') } | Measure-Object -Maximum).Maximum
  $series = [ordered]@{
    cub_sc_res = @(Read-Col 'B' 'C' 10 $last 1)
    cub_sc_com = @(Read-Col 'B' 'F' 10 $last 1)
    incc_m_mensal = @(Read-Col 'J' 'K' 10 $last 100)
    ipca_planilha_mensal = @(Read-Col 'O' 'P' 10 $last 100)
  }
  $hash = (Get-FileHash -LiteralPath $Caminho -Algorithm SHA256).Hash
  $tz = try { [TimeZoneInfo]::FindSystemTimeZoneById('America/Sao_Paulo') } catch { [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time') }
  $obj = [ordered]@{
    importedAt = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString("yyyy-MM-dd'T'HH:mm:ss", $inv) + '-03:00'
    file = Split-Path $Caminho -Leaf
    sha256 = $hash
    sourcesInFile = [ordered]@{ cub = @($cells['B3'], $cells['B4']); incc = $cells['J3']; ipca = $cells['O3'] }
    series = $series
  }
  $dir = Join-Path $Root 'data/manual'; New-Item -ItemType Directory -Force $dir | Out-Null
  $obj | ConvertTo-Json -Depth 6 -Compress | Set-Content (Join-Path $dir 'planilha-indices.json') -Encoding utf8NoBOM
  foreach ($k in $series.Keys) { $s = $series[$k]; "{0,-22} {1,4} obs  {2} a {3}" -f $k, $s.Count, $s[0].d, $s[-1].d }
} finally { Remove-Item -Recurse -Force $tmp }
