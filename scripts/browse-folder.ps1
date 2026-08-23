Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# 置顶隐形属主窗体：确保 FolderBrowserDialog 永远浮在浏览器等前台窗口之上，
# 且获得焦点（修复"弹窗在浏览器后面看不见"缺陷 D82/Browse-Fix-1）。
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Refresh()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Mush Workspace Folder"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog($owner)
$owner.Hide()
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.SelectedPath
}
