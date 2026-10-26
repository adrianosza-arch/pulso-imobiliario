#Requires -Version 7
<#
  Pulso Imobiliário — coletor diário
  Etapas: coleta -> normalização -> validação -> armazenamento (bruto + histórico + revisões)
          -> alertas -> publicação (data/bundle.js lido pelo site).
  Roda sem navegador. Agendamento: GitHub Actions (.github/workflows/coleta-diaria.yml)
  ou Agendador de Tarefas do Windows (scripts/registrar-tarefa-windows.ps1).
  Uso: pwsh -File collector/collect.ps1 [-Only selic_meta,ipca_12m] [-Trigger agendado|manual]
#>
param(
  [string[]]$Only,
  [string]$Trigger = 'manual',
  [switch]$SkipContent
)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

$Root     = Split-Path $PSScriptRoot -Parent
$DataDir  = Join-Path $Root 'data'
$StoreDir = Join-Path $DataDir 'store'
$RawDir   = Join-Path $DataDir 'raw'
$CurDir   = Join-Path $DataDir 'curated'
New-Item -ItemType Directory -Force $StoreDir, $RawDir, $CurDir | Out-Null

# ---------- tempo em America/Sao_Paulo ----------
try { $tz = [TimeZoneInfo]::FindSystemTimeZoneById('America/Sao_Paulo') }
catch { $tz = [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time') }
function Now-SP { [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz) }
function Iso-SP { (Now-SP).ToString("yyyy-MM-dd'T'HH:mm:ss", $inv) + '-03:00' }
$runStart = Iso-SP
$today    = (Now-SP).Date
$runId    = (Now-SP).ToString('yyyyMMdd-HHmmss', $inv)

$catalog = (Get-Content (Join-Path $PSScriptRoot 'series.json') -Raw | ConvertFrom-Json).series

# ---------- utilidades ----------
function Read-Json($path, $default) {
  if (Test-Path $path) { return Get-Content $path -Raw | ConvertFrom-Json -DateKind String } else { return $default }
}
function Write-Json($path, $obj, [int]$depth = 12) {
  $obj | ConvertTo-Json -Depth $depth -Compress | Set-Content -Path $path -Encoding utf8NoBOM
}
function Get-Hash([string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  -join ([Security.Cryptography.SHA256]::HashData($bytes) | ForEach-Object { $_.ToString('x2') })
}
function Invoke-WithRetry([string]$url) {
  $delays = 5, 15, 45
  for ($i = 0; ; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $url -TimeoutSec 60 -Headers @{ 'User-Agent' = 'PulsoImobiliario-Coletor/1.0'; 'Accept' = 'application/json' }
      $txt = [string]$resp.Content
      # Algumas fontes devolvem página HTML de erro com status 200: tratar como falha temporária.
      if ($txt.TrimStart() -notmatch '^[\[\{]') { throw "Resposta não é JSON (início: $($txt.TrimStart().Substring(0, [Math]::Min(40, $txt.TrimStart().Length))))" }
      return $txt
    } catch {
      if ($i -ge $delays.Count) { throw "Falha após $($i+1) tentativas em $url : $($_.Exception.Message)" }
      Start-Sleep -Seconds $delays[$i]
    }
  }
}

# ---------- conectores ----------
function Get-SgsSeries($s) {
  $start = [DateTime]::ParseExact($s.start, 'yyyy-MM-dd', $inv)
  $chunk = if ($s.chunkYears) { [int]$s.chunkYears } else { 0 }
  $windows = @()
  if ($chunk -gt 0) {
    $a = $start
    while ($a -le $today) { $b = $a.AddYears($chunk).AddDays(-1); if ($b -gt $today) { $b = $today }; $windows += ,@($a, $b); $a = $b.AddDays(1) }
  } else { $windows += ,@($start, $today) }
  $rawParts = @(); $rows = @()
  foreach ($w in $windows) {
    $url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.$($s.code)/dados?formato=json&dataInicial=$($w[0].ToString('dd/MM/yyyy',$inv))&dataFinal=$($w[1].ToString('dd/MM/yyyy',$inv))"
    $txt = Invoke-WithRetry $url
    $rawParts += $txt
    $parsed = $txt | ConvertFrom-Json
    if ($parsed -isnot [array] -and -not $parsed.data) { throw "Resposta inesperada do SGS: $($txt.Substring(0,[Math]::Min(200,$txt.Length)))" }
    $rows += @($parsed)
  }
  $obs = [Collections.Generic.List[object]]::new(); $skipped = 0
  foreach ($r in $rows) {
    $d = [DateTime]::ParseExact($r.data, 'dd/MM/yyyy', $inv)
    if ($s.clipFuture -and $d -gt $today) { continue }
    $v = 0.0
    if (-not [double]::TryParse([string]$r.valor, [Globalization.NumberStyles]::Float, $inv, [ref]$v)) { $skipped++; continue }
    $key = if ($s.freq -like 'diaria*') { $d.ToString('yyyy-MM-dd', $inv) } else { $d.ToString('yyyy-MM', $inv) }
    $obs.Add([pscustomobject]@{ d = $key; v = $v })
  }
  [pscustomobject]@{ raw = ($rawParts -join "`n"); obs = $obs; skipped = $skipped }
}

function Get-SidraSeries($s) {
  $url = "https://apisidra.ibge.gov.br/values/$($s.path)/p/all"
  $txt = Invoke-WithRetry $url
  $rows = @($txt | ConvertFrom-Json)
  if ($rows.Count -lt 1) { throw 'Resposta SIDRA vazia' }
  $hdr = $rows[0]
  $pcol = ($hdr.PSObject.Properties | Where-Object { $_.Value -match '^(Mês|Trimestre|Ano) \(Código\)$' } | Select-Object -First 1)
  if (-not $pcol) { throw 'Coluna de período não encontrada na resposta SIDRA' }
  $obs = [Collections.Generic.List[object]]::new(); $skipped = 0
  foreach ($r in ($rows | Select-Object -Skip 1)) {
    $code = [string]$r.($pcol.Name)
    if ($code -lt [string]$s.periodStart) { continue }
    $v = 0.0
    if (-not [double]::TryParse([string]$r.V, [Globalization.NumberStyles]::Float, $inv, [ref]$v)) { $skipped++; continue }  # '...', '-', 'X'
    $key = switch ($s.freq) {
      'mensal'     { $code.Substring(0,4) + '-' + $code.Substring(4,2) }
      'trimestral' { $code.Substring(0,4) + '-T' + [int]$code.Substring(4,2) }
      default      { $code }
    }
    $obs.Add([pscustomobject]@{ d = $key; v = $v })
  }
  [pscustomobject]@{ raw = $txt; obs = $obs; skipped = $skipped }
}

function Get-ManualSeries($s) {
  # Séries importadas da planilha do usuário (scripts/importar-planilha.ps1), com derivações calculadas aqui.
  $file = Join-Path $DataDir 'manual/planilha-indices.json'
  if (-not (Test-Path $file)) { throw 'Planilha ainda não importada (data/manual/planilha-indices.json ausente)' }
  $txt = Get-Content $file -Raw; $j = $txt | ConvertFrom-Json
  $base = @($j.series.($s.field) | Sort-Object d)
  $map = @{}; foreach ($o in $base) { $map[$o.d] = [double]$o.v }
  $prevKey = { param($k, $n) [DateTime]::ParseExact("$k-01", 'yyyy-MM-dd', $inv).AddMonths(-$n).ToString('yyyy-MM', $inv) }
  $obs = [Collections.Generic.List[object]]::new()
  foreach ($o in $base) {
    $v = $null
    switch ($s.derive) {
      'mom'        { $p = & $prevKey $o.d 1;  if ($map.ContainsKey($p) -and $map[$p]) { $v = ($map[$o.d] / $map[$p] - 1) * 100 } }
      'yoy_level'  { $p = & $prevKey $o.d 12; if ($map.ContainsKey($p) -and $map[$p]) { $v = ($map[$o.d] / $map[$p] - 1) * 100 } }
      'acum12_rate' {
        # acumulado em 12 meses por capitalização composta: Π(1 + r/100) − 1 (nunca soma de taxas)
        $prod = 1.0; $okAll = $true
        for ($k = 0; $k -lt 12; $k++) { $p = & $prevKey $o.d $k; if (-not $map.ContainsKey($p)) { $okAll = $false; break }; $prod *= (1 + $map[$p] / 100) }
        if ($okAll) { $v = ($prod - 1) * 100 }
      }
      default { $v = $map[$o.d] }
    }
    if ($null -ne $v) { $obs.Add([pscustomobject]@{ d = $o.d; v = [Math]::Round($v, 4) }) }
  }
  [pscustomobject]@{ raw = $txt; obs = $obs; skipped = 0; importedAt = $j.importedAt }
}

# ---------- normalização / validação ----------
function Compress-Steps($obs) {
  # Mantém só os pontos em que o valor muda, mais o último dia observado.
  $out = [Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $obs.Count; $i++) {
    if ($i -eq 0 -or $obs[$i].v -ne $obs[$i-1].v -or $i -eq $obs.Count - 1) { $out.Add($obs[$i]) }
  }
  $out
}

function Test-Series($s, $obs, $prev) {
  $errs = @()
  if ($obs.Count -eq 0) { return ,@('Nenhuma observação válida retornada') }
  $sorted = @($obs | Sort-Object d)
  $dups = @($sorted | Group-Object d | Where-Object Count -gt 1)
  if ($dups.Count) { $errs += "Datas duplicadas: $(($dups | Select-Object -First 3 | ForEach-Object Name) -join ', ')" }
  foreach ($o in $sorted) {
    if ($null -ne $s.validate.min -and $o.v -lt $s.validate.min) { $errs += "Valor abaixo do limite em $($o.d): $($o.v)"; break }
    if ($null -ne $s.validate.max -and $o.v -gt $s.validate.max) { $errs += "Valor acima do limite em $($o.d): $($o.v)"; break }
  }
  if ($s.validate.maxStep) {
    for ($i = 1; $i -lt $sorted.Count; $i++) {
      if ([Math]::Abs($sorted[$i].v - $sorted[$i-1].v) -gt $s.validate.maxStep) { $errs += "Salto acima de $($s.validate.maxStep) entre $($sorted[$i-1].d) e $($sorted[$i].d)"; break }
    }
  }
  if ($prev -and $prev.observations) {
    $pc = @($prev.observations).Count
    if (-not $s.compressSteps -and $sorted.Count -lt [Math]::Floor($pc * 0.9)) { $errs += "Série encolheu de $pc para $($sorted.Count) observações" }
    $pl = (@($prev.observations) | Select-Object -Last 1).d
    if ($sorted[-1].d -lt $pl) { $errs += "Última data ($($sorted[-1].d)) anterior à já armazenada ($pl)" }
  }
  ,$errs
}

function Get-Gaps($s, $obs) {
  # Períodos esperados ausentes entre o início e o fim da série.
  if ($obs.Count -lt 2 -or $s.freq -like 'diaria*') { return @() }
  $have = @{}; foreach ($o in $obs) { $have[$o.d] = $true }
  $gaps = @()
  $first = $obs[0].d; $last = $obs[-1].d
  switch ($s.freq) {
    'mensal' {
      $a = [DateTime]::ParseExact("$first-01", 'yyyy-MM-dd', $inv); $b = [DateTime]::ParseExact("$last-01", 'yyyy-MM-dd', $inv)
      for ($x = $a; $x -le $b; $x = $x.AddMonths(1)) { $k = $x.ToString('yyyy-MM', $inv); if (-not $have[$k]) { $gaps += $k } }
    }
    'trimestral' {
      $ya = [int]$first.Substring(0,4); $qa = [int]$first.Substring(6); $yb = [int]$last.Substring(0,4); $qb = [int]$last.Substring(6)
      for ($y = $ya; $y -le $yb; $y++) { for ($q = 1; $q -le 4; $q++) {
        if (($y -eq $ya -and $q -lt $qa) -or ($y -eq $yb -and $q -gt $qb)) { continue }
        $k = "$y-T$q"; if (-not $have[$k]) { $gaps += $k } } }
    }
    'anual' { for ($y = [int]$first; $y -le [int]$last; $y++) { if (-not $have["$y"]) { $gaps += "$y" } } }
  }
  $gaps
}

function Get-RefDate($s, [string]$d) {
  # Converte a chave de período em data (início do período) para medir defasagem.
  switch ($s.freq) {
    'mensal'     { [DateTime]::ParseExact("$d-01", 'yyyy-MM-dd', $inv) }
    'trimestral' { [DateTime]::new([int]$d.Substring(0,4), ([int]$d.Substring(6) - 1) * 3 + 1, 1) }
    'anual'      { [DateTime]::new([int]$d, 1, 1) }
    default      { [DateTime]::ParseExact($d, 'yyyy-MM-dd', $inv) }
  }
}
$maxLagDays = @{ diaria_decisao = 10; mensal = 120; trimestral = 240; anual = 1200 }

# ---------- execução por série ----------
$results = @()
foreach ($s in $catalog) {
  if ($Only -and $s.id -notin $Only) { continue }
  $storePath = Join-Path $StoreDir "$($s.id).json"
  $prev = Read-Json $storePath $null
  $rec = if ($prev) { $prev } else { [pscustomobject]@{ id = $s.id; observations = @(); revisions = @(); lastSuccess = $null; lastRawHash = $null } }
  $rec | Add-Member -Force lastAttempt (Iso-SP)
  $res = [ordered]@{ id = $s.id; status = 'ok'; newObs = 0; revised = 0; message = '' }
  try {
    $got = switch ($s.connector) { 'sgs' { Get-SgsSeries $s } 'sidra' { Get-SidraSeries $s } 'manual' { Get-ManualSeries $s } }
    if ($s.connector -eq 'manual') { $rec | Add-Member -Force importedAt $got.importedAt }
    $obs = @($got.obs | Sort-Object d)
    if ($s.compressSteps) { $obs = @(Compress-Steps $obs) }
    $errs = Test-Series $s $obs $prev
    if ($errs.Count) {
      $res.status = 'rejeitado'; $res.message = ($errs -join ' | ')
      $rec | Add-Member -Force lastError ("Validação: " + $res.message)
    } else {
      # bruto: guarda apenas quando a resposta muda
      $hash = Get-Hash $got.raw
      if ($hash -ne $rec.lastRawHash) {
        $dir = Join-Path $RawDir $today.ToString('yyyy-MM-dd', $inv); New-Item -ItemType Directory -Force $dir | Out-Null
        Set-Content -Path (Join-Path $dir "$($s.id).json") -Value $got.raw -Encoding utf8NoBOM
        $rec | Add-Member -Force lastRawHash $hash
      }
      # revisões e novidades
      $old = @{}; foreach ($o in @($rec.observations)) { $old[$o.d] = [double]$o.v }
      $lastOld = (@($rec.observations) | Select-Object -Last 1).d
      $revs = [Collections.Generic.List[object]]::new(); foreach ($r in @($rec.revisions)) { $revs.Add($r) }
      foreach ($o in $obs) {
        if ($old.ContainsKey($o.d)) {
          if ([Math]::Abs($old[$o.d] - $o.v) -gt 1e-9 -and -not ($s.compressSteps -and $o.d -eq $lastOld)) {
            $revs.Add([pscustomobject]@{ run = $runId; d = $o.d; old = $old[$o.d]; new = $o.v }); $res.revised++
          }
        } elseif (-not $lastOld -or $o.d -gt $lastOld) { $res.newObs++ }
      }
      if ($revs.Count -gt 300) { $revs = $revs.GetRange($revs.Count - 300, 300) }
      $rec | Add-Member -Force observations $obs
      $rec | Add-Member -Force revisions @($revs)
      $rec | Add-Member -Force lastSuccess (Iso-SP)
      $rec | Add-Member -Force lastError $null
      $rec | Add-Member -Force skipped $got.skipped
      if ($res.newObs -eq 0 -and $res.revised -eq 0) { $res.status = 'sem_novidade' }
    }
  } catch {
    $res.status = 'falha'; $res.message = $_.Exception.Message
    $rec | Add-Member -Force lastError $res.message
  }
  Write-Json $storePath $rec
  $results += [pscustomobject]$res
  Write-Host ("{0,-28} {1,-12} novos={2} revisados={3} {4}" -f $s.id, $res.status, $res.newObs, $res.revised, $res.message)
}

# ---------- montagem do catálogo publicado ----------
$published = @()
foreach ($s in $catalog) {
  $rec = Read-Json (Join-Path $StoreDir "$($s.id).json") $null
  $obs = if ($rec) { @($rec.observations) } else { @() }
  $state = 'sem_dados'; $lagDays = $null
  if ($obs.Count) {
    $ref = Get-RefDate $s $obs[-1].d
    $lagDays = [int]($today - $ref).TotalDays
    $state = if ($lagDays -gt $maxLagDays[$s.freq] -and -not ($s.id -like 'pib_*' -and $lagDays -lt 1500)) { 'defasado' } else { 'em_dia' }
  }
  if ($rec -and $rec.lastError) { $state = if ($obs.Count) { 'falha_ultima_coleta' } else { 'falha' } }
  $published += [pscustomobject]@{
    id = $s.id; name = $s.name; short = $s.short; unit = $s.unit; kind = $s.kind; freq = $s.freq; geo = $s.geo; theme = $s.theme
    group = if ($s.group) { $s.group } elseif ($s.theme -in 'credito', 'custos') { 'setorial' } else { 'macro' }
    importedAt = $rec.importedAt
    areas = $s.areas; source = $s.source; sourceUrl = $s.sourceUrl; docUrl = $s.docUrl; titleCheck = $s.titleCheck; note = $s.note
    connector = $s.connector; code = if ($s.code) { $s.code } else { $s.path }
    state = $state; lagDays = $lagDays
    lastAttempt = $rec.lastAttempt; lastSuccess = $rec.lastSuccess; lastError = $rec.lastError
    first = if ($obs.Count) { $obs[0].d } else { $null }; last = if ($obs.Count) { $obs[-1].d } else { $null }
    count = $obs.Count; gaps = @(Get-Gaps $s $obs); skipped = $rec.skipped
    revisions = @($rec.revisions | Select-Object -Last 20)
    obs = $obs
  }
}
$byId = @{}; foreach ($p in $published) { $byId[$p.id] = $p }

# ---------- alertas (regras documentadas em Fontes e Método) ----------
function Last($id) { $o = @($byId[$id].obs); if ($o.Count) { $o[-1] } }
function At($id, $d) { @($byId[$id].obs) | Where-Object d -eq $d | Select-Object -First 1 }
function MonthsBack([string]$ym, [int]$n) { [DateTime]::ParseExact("$ym-01",'yyyy-MM-dd',$inv).AddMonths(-$n).ToString('yyyy-MM',$inv) }
$alerts = @()
function Add-Alert($rule, $level, $ref, $title, $evidence, $implication, $series) {
  $script:alerts += [pscustomobject]@{ id = "$rule|$ref"; rule = $rule; level = $level; ref = $ref; title = $title; evidence = $evidence; implication = $implication; series = $series }
}
$fmt = { param($x, $n = 2) $x.ToString("N$n", [Globalization.CultureInfo]::GetCultureInfo('pt-BR')) }

# R1 — decisão de juros recente (últimos 60 dias)
$sel = @($byId['selic_meta'].obs)
if ($sel.Count -ge 3) {
  $chg = $null
  for ($i = $sel.Count - 2; $i -ge 1; $i--) { if ($sel[$i].v -ne $sel[$i-1].v) { $chg = $i; break } }
  if ($chg) {
    $dd = [DateTime]::ParseExact($sel[$chg].d, 'yyyy-MM-dd', $inv); $delta = $sel[$chg].v - $sel[$chg-1].v
    if (($today - $dd).TotalDays -le 60) {
      $lvl = if ($delta -lt 0) { 'oportunidade' } elseif ($delta -ge 0.5) { 'critico' } else { 'atencao' }
      Add-Alert 'R1_selic' $lvl $sel[$chg].d ("Copom " + $(if ($delta -lt 0) { 'reduziu' } else { 'elevou' }) + " a meta Selic para $(& $fmt $sel[$chg].v)% a.a.") `
        "Meta Selic passou de $(& $fmt $sel[$chg-1].v)% para $(& $fmt $sel[$chg].v)% a.a. com vigência a partir de $($dd.ToString('dd/MM/yyyy',$inv)) (SGS 432)." `
        "A Selic influencia o custo de captação do SBPE e a atratividade relativa do imóvel como investimento, mas o repasse às taxas de financiamento é parcial e defasado. Acompanhar a série de taxa média do financiamento imobiliário antes de revisar premissas de viabilidade." @('selic_meta','fin_imob_taxa')
    }
  }
}
# R2 — IPCA 12m acima do teto da meta (meta 3,0% com tolerância de 1,5 p.p.)
$ip = Last 'ipca_12m'
if ($ip -and $ip.v -gt 4.5) {
  $lvl = if ($ip.v -gt 6) { 'critico' } else { 'atencao' }
  Add-Alert 'R2_ipca_teto' $lvl $ip.d "IPCA em 12 meses acima do teto da meta" `
    "IPCA acumulado em 12 meses de $(& $fmt $ip.v)% em $($ip.d), acima do limite superior de 4,5% do intervalo de tolerância da meta contínua de 3,0%." `
    "Inflação acima do teto reduz o espaço para cortes de juros e pressiona renda real das famílias. Não implica, sozinha, queda de vendas: verificar crédito, emprego e renda." @('ipca_12m','selic_meta')
}
# R3 — custo de construção (SINAPI SC) acima da inflação ao consumidor, mesmo mês de referência
$sn = Last 'sinapi_sc_12m'
if ($sn) {
  $ipSame = At 'ipca_12m' $sn.d
  if ($ipSame) {
    $gap = $sn.v - $ipSame.v
    if ($gap -ge 1.5) {
      $lvl = if ($gap -ge 3) { 'critico' } else { 'atencao' }
      Add-Alert 'R3_custo_vs_ipca' $lvl $sn.d "Custo de construção em SC sobe acima do IPCA" `
        "SINAPI-SC: $(& $fmt $sn.v)% em 12 meses até $($sn.d), contra IPCA de $(& $fmt $ipSame.v)% no mesmo período (diferença de $(& $fmt $gap) p.p.)." `
        "Pressão de custo maior que a inflação geral pode comprimir margens de empreendimentos com preço já definido. O SINAPI usa projetos-padrão de referência e não substitui o CUB/SC nem o orçamento da obra: conferir com o orçamento próprio antes de revisar a viabilidade." @('sinapi_sc_12m','ipca_12m')
    }
  }
}
# R4 — taxa do financiamento imobiliário: variação em 6 meses
$tx = Last 'fin_imob_taxa'
if ($tx) {
  $t6 = At 'fin_imob_taxa' (MonthsBack $tx.d 6)
  if ($t6) {
    $dv = $tx.v - $t6.v
    if ($dv -ge 0.5) { Add-Alert 'R4_taxa_fin' 'atencao' $tx.d "Taxa do financiamento imobiliário subiu em 6 meses" "Taxa média (PF, taxas de mercado) foi de $(& $fmt $t6.v)% para $(& $fmt $tx.v)% a.a. entre $($t6.d) e $($tx.d) (+$(& $fmt $dv) p.p.)." "Taxas maiores reduzem o valor financiável para a mesma renda. Avaliar sensibilidade do público-alvo dependente de SBPE." @('fin_imob_taxa') }
    elseif ($dv -le -0.5) { Add-Alert 'R4_taxa_fin' 'oportunidade' $tx.d "Taxa do financiamento imobiliário caiu em 6 meses" "Taxa média (PF, taxas de mercado) foi de $(& $fmt $t6.v)% para $(& $fmt $tx.v)% a.a. entre $($t6.d) e $($tx.d) ($(& $fmt $dv) p.p.)." "Taxas menores ampliam o valor financiável para a mesma renda. Confirmar se as condições dos bancos repassadores acompanham a média." @('fin_imob_taxa') }
  }
}
# R5 — inadimplência imobiliária: variação em 12 meses
$in = Last 'fin_imob_inadimplencia'
if ($in) {
  $i12 = At 'fin_imob_inadimplencia' (MonthsBack $in.d 12)
  if ($i12 -and ($in.v - $i12.v) -ge 0.3) {
    Add-Alert 'R5_inadimplencia' 'atencao' $in.d "Inadimplência do crédito imobiliário em alta" "Inadimplência (PF, total) passou de $(& $fmt $i12.v)% para $(& $fmt $in.v)% da carteira entre $($i12.d) e $($in.d)." "Aumento persistente pode levar bancos a endurecer a análise de crédito, afetando repasses na entrega das chaves." @('fin_imob_inadimplencia')
  }
}
# R6 — concessões: soma 12 meses vs 12 meses anteriores (nominal)
$cc = @($byId['fin_imob_concessoes'].obs)
if ($cc.Count -ge 24) {
  $a = ($cc[-12..-1] | Measure-Object v -Sum).Sum; $b = ($cc[-24..-13] | Measure-Object v -Sum).Sum
  $pct = ($a / $b - 1) * 100
  if ([Math]::Abs($pct) -ge 10) {
    $lvl = if ($pct -lt 0) { 'atencao' } else { 'oportunidade' }
    Add-Alert 'R6_concessoes' $lvl $cc[-1].d ("Concessões de financiamento imobiliário " + $(if ($pct -lt 0) { 'em queda' } else { 'em alta' }) + " em 12 meses") `
      "Concessões PF (total) somaram R$ $(& $fmt ($a/1000) 1) bilhões nos 12 meses até $($cc[-1].d), $(& $fmt $pct 1)% em relação aos 12 meses anteriores (valores nominais)." `
      "Volume de crédito concedido é proxy de demanda efetivada com financiamento. Por ser nominal, parte da variação reflete inflação; não separa novo de usado nem região." @('fin_imob_concessoes')
  }
}
# R7 — desocupação SC: mesmo trimestre do ano anterior
$ds = Last 'desocupacao_sc'
if ($ds) {
  $y = [int]$ds.d.Substring(0,4) - 1; $prevQ = At 'desocupacao_sc' ("$y" + $ds.d.Substring(4))
  if ($prevQ -and ($ds.v - $prevQ.v) -ge 1) {
    Add-Alert 'R7_desocupacao_sc' 'atencao' $ds.d "Desocupação em SC subiu na comparação anual" "Taxa de desocupação em SC de $(& $fmt $ds.v 1)% em $($ds.d), contra $(& $fmt $prevQ.v 1)% um ano antes." "Mercado de trabalho mais fraco reduz renda e confiança para compra. Estimativa estadual: não aplicar diretamente a Joinville ou Itapoá." @('desocupacao_sc')
  }
}
# R8 — operacional: falhas e defasagens
foreach ($p in $published) {
  if ($p.state -in 'falha', 'falha_ultima_coleta') { Add-Alert 'R8_falha' 'critico' $p.id "Falha na coleta: $($p.name)" "Última tentativa: $($p.lastAttempt). Erro: $($p.lastError). Último dado válido preservado: $($p.last)." "Os números exibidos desta série podem estar desatualizados. Verificar o conector e a fonte." @($p.id) }
  elseif ($p.state -eq 'defasado') { Add-Alert 'R8_defasagem' 'atencao' $p.id "Série defasada: $($p.name)" "Último período disponível: $($p.last) ($($p.lagDays) dias). A coleta funcionou, mas a fonte não publicou período mais recente dentro do prazo esperado." "Usar o dado com a ressalva da data de referência." @($p.id) }
}

# histórico de alertas: evita reapresentar como novo o que não mudou
$histPath = Join-Path $DataDir 'alerts-history.json'
$hist = Read-Json $histPath ([pscustomobject]@{ seen = [pscustomobject]@{} })
foreach ($al in $alerts) {
  $seen = $hist.seen.($al.id)
  if (-not $seen) { $hist.seen | Add-Member -Force $al.id $runStart; $seen = $runStart }
  $al | Add-Member -Force firstSeen $seen
  $al | Add-Member -Force isNew ($seen -eq $runStart)
}
Write-Json $histPath $hist

# ---------- notícias e vídeos (histórico acumulativo) ----------
. (Join-Path $PSScriptRoot 'content.ps1')
$newsRes = $null; $videoRes = $null
if (-not $SkipContent -and -not $Only) {
  try { $newsRes = Update-News } catch { Write-Host "Notícias: falha geral — $($_.Exception.Message)" }
  try { $videoRes = Update-Videos } catch { Write-Host "Vídeos: falha geral — $($_.Exception.Message)" }
}
$newsStore  = Read-Json (Join-Path $DataDir 'news/news.json') ([pscustomobject]@{ items = @(); sources = $null })
$videoStore = Read-Json (Join-Path $DataDir 'videos/videos.json') ([pscustomobject]@{ items = @(); channels = $null; api = $null })

# ---------- conferência: IPCA da planilha × BCB (SGS 433) ----------
$ipcaCheck = $null
$manualFile = Join-Path $DataDir 'manual/planilha-indices.json'
if (Test-Path $manualFile) {
  $mj = Get-Content $manualFile -Raw | ConvertFrom-Json
  $bm = @{}; foreach ($o in @($byId['ipca_mensal'].obs)) { $bm[$o.d] = [double]$o.v }
  $cmp = 0; $div = @(); $noPair = 0
  foreach ($o in @($mj.series.ipca_planilha_mensal)) { if ($bm.ContainsKey($o.d)) { $cmp++; if ([Math]::Abs($bm[$o.d] - [double]$o.v) -gt 0.005) { $div += [pscustomobject]@{ d = $o.d; planilha = $o.v; bcb = $bm[$o.d] } } } else { $noPair++ } }
  $ipcaCheck = [pscustomobject]@{ compared = $cmp; divergences = $div; withoutPair = $noPair; file = $mj.file; importedAt = $mj.importedAt; sha256 = $mj.sha256; sources = $mj.sourcesInFile }
}

# ---------- registro da execução ----------
$runsPath = Join-Path $DataDir 'runs.json'
$runs = [Collections.Generic.List[object]]::new(); foreach ($r in @(Read-Json $runsPath @())) { $runs.Add($r) }
$summary = [ordered]@{ ok = @($results | Where-Object status -eq 'ok').Count; sem_novidade = @($results | Where-Object status -eq 'sem_novidade').Count; rejeitado = @($results | Where-Object status -eq 'rejeitado').Count; falha = @($results | Where-Object status -eq 'falha').Count }
$content = [ordered]@{ newsAdded = $newsRes.added; newsTotal = @($newsStore.items).Count; videosAdded = $videoRes.added; videosTotal = @($videoStore.items).Count; youtubeUnits = $videoRes.api.unitsEstimated }
$runs.Add([pscustomobject]@{ id = $runId; trigger = $Trigger; host = [Environment]::MachineName; start = $runStart; end = (Iso-SP); summary = $summary; content = $content; results = $results })
if ($runs.Count -gt 500) { $runs = $runs.GetRange($runs.Count - 500, 500) }
Write-Json $runsPath @($runs)

# ---------- publicação ----------
$curated = Read-Json (Join-Path $CurDir 'curadoria.json') ([pscustomobject]@{})
$bundle = [ordered]@{
  generatedAt = Iso-SP
  schedule = [ordered]@{ time = '07:15'; timezone = 'America/Sao_Paulo' }
  series = $published
  alerts = $alerts
  runs = @($runs | Select-Object -Last 30)
  curated = $curated
  news = [ordered]@{ items = @($newsStore.items); sources = $newsStore.sources }
  videos = [ordered]@{ items = @($videoStore.items); channels = $videoStore.channels; api = $videoStore.api }
  ipcaCheck = $ipcaCheck
}
$json = $bundle | ConvertTo-Json -Depth 14 -Compress
Set-Content -Path (Join-Path $DataDir 'bundle.js') -Value ("window.PULSO = " + $json + ";") -Encoding utf8NoBOM
Write-Host "Publicado data/bundle.js — $($published.Count) séries, $($alerts.Count) alertas. Resumo: $($summary | ConvertTo-Json -Compress)"
if ($summary.falha -gt 0 -and $summary.falha -eq $results.Count) { exit 2 }
