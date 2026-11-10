' DataCore AI tester watchdog launcher. ASCII only. Runs run.mjs --watchdog without a console window.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "node """ & here & "\run.mjs"" --watchdog", 0, False
