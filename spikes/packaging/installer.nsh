; SPI-05 only: bypass electron-builder's Windows PowerShell 5.1 check.
; The controller pins the actual pwsh 7+ executable before building this PoC.
; Fail closed instead of terminating any matching application.
!macro customCheckAppRunning
  nsExec::ExecToStack /TIMEOUT=30000 `"$%AUTOVISION_SPI05_PWSH%" -NoLogo -NoProfile -NonInteractive -Command "try { $$ErrorActionPreference = 'Stop'; if ($$PSVersionTable.PSEdition -ne 'Core' -or $$PSVersionTable.PSVersion.Major -lt 7) { exit 2 }; $$items = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Where-Object { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' }); if ($$items.Count -ne 0) { exit 1 }; exit 0 } catch { exit 2 }"`
  Pop $0
  Pop $1
  StrCmp $0 "0" spi05_not_running
    SetErrorLevel 2
    Quit
  spi05_not_running:
!macroend