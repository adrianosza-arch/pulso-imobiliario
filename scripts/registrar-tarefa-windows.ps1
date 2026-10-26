#Requires -Version 7
# Registra a coleta diária no Agendador de Tarefas do Windows (07h15, horário local).
# Roda sem navegador aberto, mas exige o computador ligado; com -StartWhenAvailable, uma execução perdida
# acontece assim que o computador voltar. Para remover: Unregister-ScheduledTask -TaskName 'PulsoImobiliario-Coleta'
param([string]$Hora = '07:15')
$Root = Split-Path $PSScriptRoot -Parent
$pwsh = (Get-Command pwsh).Source
$action  = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -File `"$Root\collector\collect.ps1`" -Trigger agendado" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At $Hora
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'PulsoImobiliario-Coleta' -Action $action -Trigger $trigger -Settings $settings -Description 'Coleta diária do Pulso Imobiliário (BCB/SGS e IBGE/SIDRA)' -Force | Out-Null
"Tarefa 'PulsoImobiliario-Coleta' registrada para $Hora diariamente."
