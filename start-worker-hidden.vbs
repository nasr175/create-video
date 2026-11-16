Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\BeautyWorld-Playwright"
WshShell.Run """C:\Program Files\nodejs\node.exe"" ""C:\BeautyWorld-Playwright\worker.js""", 0, False
